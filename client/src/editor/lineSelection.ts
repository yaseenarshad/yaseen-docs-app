/**
 * Whole-line selection (YAZ-1734). The full rule lives in docs/CONTRACTS.md, Keyboard table,
 * `Shift-ArrowUp` / `Shift-ArrowDown` row — this header is only the map.
 *
 * Why: the editor bound nothing on ⇧↑ / ⇧↓, so the browser moved the head by PIXEL column and,
 * from a block edge, landed mid-text on a neighbour that is indented differently, is a heading,
 * or wraps — ⌫ then took a ragged chunk of two lines.
 *
 *  - `lineKeymap` — ⇧↓ / ⇧↑ (`extendByLine`): a line is the textblock (D1); only the head moves,
 *    edge → same edge of the next VISIBLE textblock, mid-line → own edge first (D2); never past
 *    the anchor (D5); hidden lines skipped (D6). ⌫ / Delete / Enter over a range that spans
 *    hidden lines: `deleteVisible` / `enterVisible` remove only the visible pieces (D6, D7).
 *  - `visibleTypeOver` — the same for typing (`handleTextInput`).
 *  - `liftHeadlessItems` — a list_item whose first child is a list yields its kids one level up,
 *    whatever produced it (D3).
 *  - `isHiddenTextblock` — the fold / heading-fold / zoom plugins' own STATE, never the DOM.
 *
 * Priority 100 (Crepe's keymaps are 50), like `outline/hotkeys.ts`; registered before
 * `outlinerKeymap` in `createCrepe.ts`.
 */
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { liftTarget } from '@milkdown/kit/prose/transform'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { collapsedHeadingsHiding } from './outline/headingFolding'
import { isListItem, LIST_NODE_NAMES } from './outline/listNodes'
import { collapsedItemsHiding } from './outline/outlineFolding'
import { getZoomedItemPos } from './outline/zoom'

/** Priority above Crepe's list/table/base keymaps (default 50). */
const PRIORITY = 100

type Edge = 'start' | 'end'

/** Which edge of its textblock `$head` sits on; an empty block answers `prefer` (D2). */
const edgeAt = ($head: ResolvedPos, prefer: Edge): Edge | null => {
  const atStart = $head.parentOffset === 0
  const atEnd = $head.parentOffset === $head.parent.content.size
  if (atStart && atEnd) return prefer
  if (atStart) return 'start'
  if (atEnd) return 'end'
  return null
}

/** True when a leaf block (`hr`) lies in `[from, to)` — a line the head must not skip over (D2). */
const leafBlockBetween = (doc: ProseNode, from: number, to: number): boolean => {
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (found) return false
    if (node.isBlock && node.isLeaf) found = true
    return !found
  })
  return found
}

/**
 * Is the textblock around `$pos` hidden from view (rule B)? Asks the three plugins that hide
 * things, through their own state: outside the zoomed item's subtree (`getZoomedItemPos` — the
 * zoom decorations hide every block off the root → item path, the ancestors' own text included),
 * inside a collapsed bullet's nested list (`collapsedItemsHiding`), or inside a collapsed heading's
 * section (`collapsedHeadingsHiding`). All three answer from plugin state, which is what their
 * `display: none` decorations are computed from — no DOM, no re-derived fold logic.
 */
const isHiddenTextblock = (state: EditorState, $pos: ResolvedPos): boolean => {
  const pos = $pos.pos
  const zoomed = getZoomedItemPos(state)
  if (zoomed !== null) {
    const item = state.doc.nodeAt(zoomed)
    if (item !== null && !(pos > zoomed && pos < zoomed + item.nodeSize)) return true
  }
  return collapsedItemsHiding(state, pos).length > 0 || collapsedHeadingsHiding(state, pos).length > 0
}

/** A position inside the nearest VISIBLE textblock in `dir` from `$head`'s block, or null (document / zoom edge). */
const nextVisibleTextblock = (state: EditorState, $head: ResolvedPos, dir: 1 | -1): ResolvedPos | null => {
  let from = dir > 0 ? $head.after() : $head.before()
  for (;;) {
    // `findFrom` with textOnly lands INSIDE the next textblock (D1); hidden ones are stepped over.
    const found = Selection.findFrom(state.doc.resolve(from), dir, true)
    if (found === null) return null
    const $n = found.$from
    if (!isHiddenTextblock(state, $n)) return $n
    from = dir > 0 ? $n.after() : $n.before()
  }
}

/** Move the selection head to its own line's near edge, or one whole VISIBLE textblock in `dir` from an edge; anchor untouched (D2). */
const extendByLine = (dir: 1 | -1): Command => (state, dispatch) => {
  const sel = state.selection
  if (!(sel instanceof TextSelection)) return false
  const { $head, anchor, head } = sel
  const { doc } = state
  // Empty block: ⇧↓ prefers the start edge, ⇧↑ the end (D2).
  const edge = edgeAt($head, dir > 0 ? 'start' : 'end')
  // Rule A: the way back retraces the way out. A press towards the anchor never crosses it and
  // always reaches it — even when no neighbour line exists in that direction (first/last line).
  const toward = dir > 0 ? anchor > head : anchor < head
  let newHead: number
  if (edge === null) {
    // Mid-line: the rest of THIS line first — ⇧↓ to its end, ⇧↑ to its start (D2, demo amendment).
    newHead = dir > 0 ? $head.end() : $head.start()
  } else {
    const $n = nextVisibleTextblock(state, $head, dir)
    // A leaf block anywhere in the gap is a line of its own that this keymap cannot select (D2).
    const gap: [number, number] | null = $n === null ? null : dir > 0 ? [$head.after(), $n.before()] : [$n.after(), $head.before()]
    const blocked = gap !== null && leafBlockBetween(doc, gap[0], gap[1])
    if ($n === null || blocked) {
      if (!toward) {
        // Document or zoom edge: consumed, unchanged — never hand native a step into hidden DOM
        // (rule B); a leaf block in the gap: native move (D2).
        return $n === null
      }
      newHead = anchor
    } else {
      newHead = edge === 'start' ? $n.start() : $n.end()
    }
  }
  if (toward && (dir > 0 ? newHead > anchor : newHead < anchor)) newHead = anchor
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(doc, anchor, newHead)).scrollIntoView())
  return true
}

/** What `deleteVisible` will do to a selection spanning hidden lines (rule C); null = not our case. */
interface VisibleDeletePlan {
  from: number
  to: number
  /** Inside the first / last VISIBLE textblock — the selection ends themselves. */
  $first: ResolvedPos
  $last: ResolvedPos
  /** Positions of the visible textblocks strictly between, document order. */
  between: number[]
}

/**
 * Non-empty `TextSelection` whose ends sit in two different VISIBLE textblocks with at least one
 * hidden textblock inside `[from, to]` — the only shape rule C claims. Everything else is null so
 * the ordinary delete path stays untouched.
 */
const planVisibleDelete = (state: EditorState): VisibleDeletePlan | null => {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return null
  const { from, to, $from, $to } = sel
  if (!$from.parent.isTextblock || !$to.parent.isTextblock || $from.sameParent($to)) return null
  if (isHiddenTextblock(state, $from) || isHiddenTextblock(state, $to)) return null
  let hidden = false
  const between: number[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (isHiddenTextblock(state, state.doc.resolve(pos + 1))) hidden = true
    else if (pos !== $from.before() && pos !== $to.before()) between.push(pos)
    return false
  })
  return hidden ? { from, to, $first: $from, $last: $to, between } : null
}

/** Delete the textblock at `$tb` as a NODE, together with every wrapper it was the only child of (never the doc). */
const deleteBlockAndEmptyWrappers = (tr: Transaction, $tb: ResolvedPos): void => {
  let depth = $tb.depth
  while (depth > 1 && $tb.node(depth - 1).childCount === 1) depth--
  tr.delete($tb.before(depth), $tb.after(depth))
}

/**
 * Rule C's deletion, in REVERSE document order so earlier positions stay valid: last block, the
 * visible blocks between, then the first. `joins` (first block cut mid-text): the last block goes as
 * a node and its tail after `to` joins the first block's head (marks preserved). Otherwise the first
 * block is selected from its start and goes as a node; the last block only loses its prefix up to
 * `to` (or goes whole when `to` is its end). Hidden blocks are never in the plan, never touched.
 * Returns the caret: `from` in the join case, else the mapped cut with the nearest text position.
 */
const applyVisibleDelete = (tr: Transaction, plan: VisibleDeletePlan): Selection => {
  const { from, to, $first, $last, between } = plan
  const joins = from > $first.start()
  if (joins || to === $last.end()) deleteBlockAndEmptyWrappers(tr, $last)
  else tr.delete($last.start(), to)
  for (const pos of [...between].reverse()) deleteBlockAndEmptyWrappers(tr, tr.doc.resolve(pos + 1))
  if (joins) {
    tr.replaceWith(from, $first.end(), $last.parent.content.cut(to - $last.start()))
    return TextSelection.create(tr.doc, from)
  }
  deleteBlockAndEmptyWrappers(tr, $first)
  return Selection.near(tr.doc.resolve(tr.mapping.map(from)), 1)
}

/**
 * `⌫` / `Delete` (and typing, with `text`) over a selection spanning hidden lines: remove only the
 * visible pieces (rule C), then insert `text` at the cut. False when the selection is not that shape.
 */
export const deleteVisible = (text = ''): Command => (state, dispatch) => {
  const plan = planVisibleDelete(state)
  if (plan === null) return false
  if (dispatch) {
    const tr = state.tr
    tr.setSelection(applyVisibleDelete(tr, plan))
    if (text !== '') tr.insertText(text)
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Keymap plugin; register with `editor.use(lineKeymap)`. */
export const lineKeymap = $shortcut(() => ({
  ExtendLineDown: { key: 'Shift-ArrowDown', priority: PRIORITY, onRun: () => extendByLine(1) },
  ExtendLineUp: { key: 'Shift-ArrowUp', priority: PRIORITY, onRun: () => extendByLine(-1) },
  // Rule C. The outliner's Backspace (same priority, registered earlier) declines non-empty selections.
  DeleteVisibleBack: { key: 'Backspace', priority: PRIORITY, onRun: () => deleteVisible() },
  DeleteVisibleForward: { key: 'Delete', priority: PRIORITY, onRun: () => deleteVisible() },
  EnterVisible: { key: 'Enter', priority: PRIORITY, onRun: () => enterVisible },
}))

/**
 * `Enter` over a selection spanning hidden lines (D7): remove the visible pieces, then press Enter
 * AGAIN on the view so the ordinary Enter — the outliner's (a parent keeps its kids), Crepe's list
 * split, or the base split — runs on the caret this left behind. Re-dispatching is deliberate: the
 * keymap hands every handler of one key the SAME pre-delete state, so merely declining would let the
 * outliner see a non-empty selection and Crepe's split move the kids under the new item. On the
 * second pass this handler finds no hidden line inside the (now empty) selection and declines.
 * ⌘X stays the ordinary cut on purpose: it MOVES the whole range, hidden kids included, and paste
 * brings them back — nothing is destroyed.
 */
const enterVisible: Command = (state, dispatch, view) => {
  if (!deleteVisible()(state, dispatch)) return false
  if (view === undefined) return true
  const again = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handle) => handle(view, again)) ?? true
}

const visibleTypeOverKey = new PluginKey('mdapp-visible-type-over')

/** Typing over a selection that spans hidden lines: rule C's deletion, then the text at the cut. Register with `editor.use(visibleTypeOver)`. */
export const visibleTypeOver = $prose(
  () =>
    new Plugin({
      key: visibleTypeOverKey,
      props: {
        handleTextInput: (view, _from, _to, text) => deleteVisible(text)(view.state, view.dispatch),
      },
    }),
)

/** A list_item whose first child is a list — no textblock of its own (D3's invalid resting state). */
const isHeadlessItem = (node: ProseNode): boolean => isListItem(node) && LIST_NODE_NAMES.has(node.firstChild?.type.name ?? '')

/** Positions of every headless item in `doc`, deepest/last first so each replacement leaves the rest valid. */
const headlessItemPositions = (doc: ProseNode): number[] => {
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (isHeadlessItem(node)) positions.push(pos)
    return true
  })
  return positions.reverse()
}

/**
 * Replace the headless item at `pos` with its children, one level up (D3). `tr.lift` of the nested
 * list's items out through the item removes both wrappers when the list is the item's only child,
 * and maps positions INSIDE the lifted items exactly (the caret stays on its line); anything the
 * item held AFTER the list is split off as a following item, so nothing is lost. The outliner's
 * `replaceWith` shape (`listCommands.ts`, empty-parent Backspace) is the fallback for a schema
 * where lifting cannot cut the item.
 */
const liftHeadlessItem = (tr: Transaction, pos: number): void => {
  const item = tr.doc.nodeAt(pos)
  if (item === null || !isHeadlessItem(item)) return
  const list = item.firstChild as ProseNode
  // Just inside the nested list: before its first item, after its last.
  const $start = tr.doc.resolve(pos + 2)
  const $end = tr.doc.resolve(pos + list.nodeSize)
  const range = $start.blockRange($end)
  const target = range === null ? null : liftTarget(range)
  if (range !== null && target !== null) tr.lift(range, target)
  else tr.replaceWith(pos, pos + item.nodeSize, list.content)
}

const liftHeadlessItemsKey = new PluginKey('mdapp-lift-headless-items')

/** Normaliser; register with `editor.use(liftHeadlessItems)`. */
export const liftHeadlessItems = $prose(
  () =>
    new Plugin({
      key: liftHeadlessItemsKey,
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null
        const positions = headlessItemPositions(state.doc)
        if (positions.length === 0) return null
        const tr = state.tr
        for (const pos of positions) liftHeadlessItem(tr, pos)
        return tr.docChanged ? tr : null
      },
    }),
)
