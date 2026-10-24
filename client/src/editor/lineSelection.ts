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
 *  - `coveredLines` / `onCoveredLines` — the selection minus the zero-width touch on the line
 *    after or before, for commands that act on the lines under it: Tab, Shift-Tab, Mod-] / Mod-[,
 *    Mod-Enter (YAZ-3003).
 *  - `eachVisibleTextblock` / `visibleRanges` / `onVisibleLines` — formatting and `Mod-Enter` over
 *    a range that spans hidden lines act on the visible lines only (YAZ-3209, its own CONTRACTS row
 *    after this one); `visibleFormatting.ts` routes Milkdown's format commands through them.
 *
 * Priority 100 (Crepe's keymaps are 50), like `outline/hotkeys.ts`; registered before
 * `outlinerKeymap` in `createCrepe.ts`.
 */
import type { Mark, MarkType, Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, NodeSelection, Plugin, PluginKey, Selection, SelectionRange, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { liftTarget } from '@milkdown/kit/prose/transform'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { collapsedHeadingsHiding, collapsedSectionBlocks } from './outline/headingFolding'
import { isListItem, LIST_NODE_NAMES } from './outline/listNodes'
import { collapsedItemsHiding, isOutlineItemCollapsed } from './outline/outlineFolding'
import { getZoomedItemPos } from './outline/zoom'

/** Priority above Crepe's list/table/base keymaps (default 50). */
const PRIORITY = 100

type Edge = 'start' | 'end'

/** Which edge of its textblock `$head` sits on; an empty block answers the edge the press prefers — ⇧↓ start, ⇧↑ end (D2). */
const edgeAt = ($head: ResolvedPos, dir: 1 | -1): Edge | null => {
  const atStart = $head.parentOffset === 0
  const atEnd = $head.parentOffset === $head.parent.content.size
  if (atStart && atEnd) return dir > 0 ? 'start' : 'end'
  if (atStart) return 'start'
  if (atEnd) return 'end'
  return null
}

/**
 * Is the textblock around `$pos` hidden from view (D6)? Asks the three plugins that hide
 * things, through their own state: outside the zoomed item's subtree (`getZoomedItemPos` — the
 * zoom decorations hide every block off the root → item path, the ancestors' own text included),
 * inside a collapsed bullet's nested list (`collapsedItemsHiding`), or inside a collapsed heading's
 * section (`collapsedHeadingsHiding`). All three answer from plugin state, which is what their
 * `display: none` decorations are computed from — no DOM, no re-derived fold logic. A folded
 * ANCESTOR of the zoomed item hides nothing: the zoom shows it expanded (zoom.css), so only a fold
 * at or below the zoomed item counts (YAZ-3209 bug 1B1).
 */
const isHiddenTextblock = (state: EditorState, $pos: ResolvedPos): boolean => {
  const pos = $pos.pos
  const zoomed = getZoomedItemPos(state)
  if (zoomed !== null) {
    const item = state.doc.nodeAt(zoomed)
    if (item !== null && !(pos > zoomed && pos < zoomed + item.nodeSize)) return true
  }
  const folds = collapsedItemsHiding(state, pos)
  return (zoomed === null ? folds.length > 0 : folds.some((itemPos) => itemPos >= zoomed)) || collapsedHeadingsHiding(state, pos).length > 0
}

/**
 * A position inside the nearest VISIBLE textblock in `dir` from `$head`'s block; `'leaf'` when a
 * leaf block (`hr`) comes first — a line of its own that this keymap cannot select (D2); null at
 * a document / zoom edge. `findFrom` without textOnly lands INSIDE the next textblock (D1) or,
 * for a block atom, on a `NodeSelection` of it; hidden textblocks are stepped over.
 */
const nextVisibleTextblock = (state: EditorState, $head: ResolvedPos, dir: 1 | -1): ResolvedPos | 'leaf' | null => {
  let from = dir > 0 ? $head.after() : $head.before()
  for (;;) {
    const found = Selection.findFrom(state.doc.resolve(from), dir, false)
    if (found === null) return null
    if (found instanceof NodeSelection) return 'leaf'
    const $n = found.$from
    if (!isHiddenTextblock(state, $n)) return $n
    from = dir > 0 ? $n.after() : $n.before()
  }
}

/**
 * The selection without its zero-width touch (YAZ-3003). A whole-line range ends at offset 0
 * of the line after (⇧↓ from a start) or starts at the end of the line before (⇧↑ from an
 * end). ⌫ needs that (D2, D3), but no text of that line is selected. Commands that act on
 * "the lines under the selection" read this instead: Tab, Shift-Tab, Mod-] / Mod-[, Mod-Enter.
 * The end is trimmed first; the start only while the range still spans two textblocks.
 * Hidden lines are stepped over (D6). Returns the selection itself when nothing is trimmed.
 */
export const coveredLines = (state: EditorState): Selection => {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return sel
  let { $from, $to } = sel
  if ($to.parentOffset === 0 && !$to.sameParent($from)) {
    const $prev = nextVisibleTextblock(state, $to, -1)
    if ($prev !== null && $prev !== 'leaf' && $prev.end() >= $from.pos) $to = state.doc.resolve($prev.end())
  }
  if ($from.parentOffset === $from.parent.content.size && !$from.sameParent($to)) {
    const $next = nextVisibleTextblock(state, $from, 1)
    if ($next !== null && $next !== 'leaf' && $next.start() <= $to.pos) $from = state.doc.resolve($next.start())
  }
  return $from.pos === sel.from && $to.pos === sel.to ? sel : new TextSelection($from, $to)
}

/**
 * Run `cmd` with `sel` in place of the user's selection, then put the user's own selection back,
 * mapped — whatever its kind (text, node, all). The next ⇧↑ / ⇧↓ or Tab continues from the same
 * range. One transaction, so one ⌘Z.
 */
const runOn = (sel: Selection, cmd: Command): Command => (state, dispatch, view) => {
  const own = state.selection
  const swapped = state.apply(state.tr.setSelection(sel))
  const restore = (tr: Transaction) => tr.setSelection(own.map(tr.doc, tr.mapping))
  return cmd(swapped, dispatch && ((tr) => dispatch(restore(tr))), view)
}

/** Run `cmd` on `coveredLines` (YAZ-3003). */
export const onCoveredLines = (cmd: Command): Command => (state, dispatch, view) => {
  const covered = coveredLines(state)
  return covered === state.selection ? cmd(state, dispatch, view) : runOn(covered, cmd)(state, dispatch, view)
}

/**
 * Every VISIBLE textblock in `[from, to]`, in document order, with its parent and index (YAZ-3209).
 * Returns whether a hidden line sits in the range. The ONE walk that commands acting on a range of
 * lines share — formatting (`visiblePieces`) and `Mod-Enter` — so they agree on what is hidden.
 *
 * It answers `isHiddenTextblock`'s question without asking it per line: that rescans every fold
 * entry for each position, so a walk over 1,000 folded parents costs ~30 ms. Here a folded item is
 * found on the way (one Set lookup) and its nested lists are skipped whole — only those: its own
 * other blocks stay visible, as the fold shows them (bug 1B2), and a folded ancestor of the zoomed
 * item hides nothing, as zoom.css shows it expanded (bug 1B1). A folded heading's section is a set
 * of whole blocks, skipped by their start; the zoom is one range. Each check is O(1), so the walk
 * costs the visible lines only.
 */
export const eachVisibleTextblock = (
  state: EditorState,
  from: number,
  to: number,
  visit: (block: ProseNode, pos: number, parent: ProseNode, index: number) => void,
): boolean => {
  const zoomed = getZoomedItemPos(state)
  const zoomEnd = zoomed === null ? 0 : zoomed + (state.doc.nodeAt(zoomed)?.nodeSize ?? 0)
  const sections = collapsedSectionBlocks(state)
  // The starts of the nested lists that a folded item met on the way hides.
  const foldedLists = new Set<number>()
  let hidden = false
  const textblock = (block: ProseNode, pos: number, parent: ProseNode, index: number): void => {
    if (zoomed !== null && !(pos > zoomed && pos < zoomEnd)) hidden = true
    else visit(block, pos, parent, index)
  }
  state.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (sections.has(pos) || foldedLists.has(pos) || (zoomed !== null && (pos + node.nodeSize <= zoomed || pos >= zoomEnd))) {
      hidden = true
      return false
    }
    if (node.isTextblock) {
      textblock(node, pos, parent!, index)
      return false
    }
    if (isListItem(node) && isOutlineItemCollapsed(state, pos)) {
      node.forEach((child, offset) => {
        const start = pos + 1 + offset
        const holdsZoom = zoomed !== null && zoomed > start && zoomed < start + child.nodeSize
        if (LIST_NODE_NAMES.has(child.type.name) && !holdsZoom) foldedLists.add(start)
      })
    }
    return true
  })
  return hidden
}

/** A visible piece of a selection: plain numbers, resolved only when a command runs (`VisibleLines`). */
export interface Piece {
  readonly from: number
  readonly to: number
}

/** A piece with its textblock and the block's content start, so a mark check stays inside the block. */
interface BlockPiece extends Piece {
  readonly block: ProseNode
  readonly start: number
}

/**
 * The selection cut to its VISIBLE lines (YAZ-3209): one piece per visible textblock it covers,
 * clipped to the selection. A zero-width piece is kept only for an empty line strictly inside the
 * range, so the touch on the line after (⇧↓) or before (⇧↑) stays out. Any one-range selection
 * counts — text, node (the block handle), all (⌘A); a cell selection has its own ranges and is left
 * alone. Null when nothing is hidden inside, or a text selection stays in one textblock: callers
 * keep the plain selection. Cached per state, because the toolbar asks once per button on each
 * update. The pieces are numbers: `doc.resolve` scans a list's children, so resolving each piece
 * would make a 1,000-item selection quadratic.
 */
const piecesByState = new WeakMap<EditorState, readonly BlockPiece[] | null>()
const visiblePieces = (state: EditorState): readonly BlockPiece[] | null => {
  if (piecesByState.has(state)) return piecesByState.get(state)!
  const sel = state.selection
  const { from, to } = sel
  let pieces: BlockPiece[] | null = null
  if (!sel.empty && sel.ranges.length === 1 && !(sel instanceof TextSelection && sel.$from.sameParent(sel.$to))) {
    const found: BlockPiece[] = []
    const hidden = eachVisibleTextblock(state, from, to, (block, pos) => {
      const start = Math.max(from, pos + 1)
      const end = Math.min(to, pos + 1 + block.content.size)
      if (start < end || (block.content.size === 0 && pos + 1 > from && pos + 1 < to)) found.push({ from: start, to: end, block, start: pos + 1 })
    })
    if (hidden) pieces = found
  }
  piecesByState.set(state, pieces)
  return pieces
}

/** The ranges a format acts on: the visible pieces when the selection spans hidden lines, else the selection's own. */
export const visibleRanges = (state: EditorState): readonly Piece[] =>
  visiblePieces(state) ?? state.selection.ranges.map((range) => ({ from: range.$from.pos, to: range.$to.pos }))

/**
 * Whether a VISIBLE part of the selection carries `mark` — the toolbar's lit state (YAZ-3209 D4).
 * Each piece is checked inside its own block: `doc.rangeHasMark` per piece would walk from the top
 * of the document every time, ~14 ms for 1,000 folded H2 sections.
 */
export const visibleRangeHasMark = (state: EditorState, mark: Mark | MarkType): boolean => {
  const pieces = visiblePieces(state)
  if (pieces === null) return state.selection.ranges.some((range) => state.doc.rangeHasMark(range.$from.pos, range.$to.pos, mark))
  return pieces.some(({ from, to, block, start }) => block.rangeHasMark(from - start, to - start, mark))
}

/**
 * A TextSelection whose `ranges` are the visible pieces, which `toggleMark` and `setBlockType` walk.
 * Its own anchor and head are the first piece's start and the last piece's end. Lives only inside
 * `onVisibleLines`.
 */
class VisibleLines extends TextSelection {
  constructor(state: EditorState, pieces: readonly Piece[]) {
    const { doc } = state
    super(doc.resolve(pieces[0].from), doc.resolve(pieces[pieces.length - 1].to))
    ;(this as { ranges: readonly SelectionRange[] }).ranges = pieces.map(({ from, to }) => new SelectionRange(doc.resolve(from), doc.resolve(to)))
  }
}

/**
 * Run a `toggleMark` / `setBlockType` command on the visible lines only (YAZ-3209). No hidden line
 * inside: `cmd` as is. Nothing visible selected (end of a folded line to the start of the next):
 * declines, so the key falls through and nothing changes.
 */
export const onVisibleLines = (cmd: Command): Command => (state, dispatch, view) => {
  const pieces = visiblePieces(state)
  if (pieces === null) return cmd(state, dispatch, view)
  if (pieces.length === 0) return false
  return runOn(new VisibleLines(state, pieces), cmd)(state, dispatch, view)
}

/** Move the selection head to its own line's near edge, or one whole VISIBLE textblock in `dir` from an edge; anchor untouched (D2). */
const extendByLine = (dir: 1 | -1): Command => (state, dispatch) => {
  const sel = state.selection
  if (!(sel instanceof TextSelection)) return false
  const { $head, anchor, head } = sel
  const { doc } = state
  const edge = edgeAt($head, dir)
  // D5: the way back retraces the way out. A press towards the anchor never crosses it and
  // always reaches it — even when no neighbour line exists in that direction (first/last line).
  const toward = dir > 0 ? anchor > head : anchor < head
  let newHead: number
  if (edge === null) {
    // Mid-line: the rest of THIS line first — ⇧↓ to its end, ⇧↑ to its start (D2).
    newHead = dir > 0 ? $head.end() : $head.start()
  } else {
    const $n = nextVisibleTextblock(state, $head, dir)
    if ($n === null || $n === 'leaf') {
      if (!toward) {
        // Document or zoom edge: consumed, unchanged — never hand native a step into hidden DOM
        // (D6); a leaf block in the gap: native move (D2).
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

/**
 * The shape D6's delete claims: a non-empty `TextSelection` whose ends sit in two different
 * VISIBLE textblocks with at least one hidden textblock inside `[from, to]`. Returns the
 * positions of the visible textblocks strictly between the ends, in document order; null for
 * every other shape so the ordinary delete path stays untouched.
 */
const planVisibleDelete = (state: EditorState): number[] | null => {
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
  return hidden ? between : null
}

/** Delete the textblock at `$tb` as a NODE, together with every wrapper it was the only child of (never the doc). */
const deleteBlockAndEmptyWrappers = (tr: Transaction, $tb: ResolvedPos): void => {
  let depth = $tb.depth
  while (depth > 1 && $tb.node(depth - 1).childCount === 1) depth--
  tr.delete($tb.before(depth), $tb.after(depth))
}

/**
 * D6's deletion, in REVERSE document order so earlier positions stay valid: the last block, the
 * visible blocks `between`, then the first. `joins` (first block cut mid-text): the last block goes
 * as a node and its tail after `to` joins the first block's head (marks preserved). Otherwise the
 * first block is selected from its start and goes as a node; the last block only loses its prefix
 * up to `to` (or goes whole when `to` is its end). Hidden blocks are never in `between`, never
 * touched. Returns the caret: `from` in the join case, else the mapped cut with the nearest text
 * position.
 */
const applyVisibleDelete = (tr: Transaction, sel: Selection, between: number[]): Selection => {
  const { from, to, $from, $to } = sel
  const joins = from > $from.start()
  if (joins || to === $to.end()) deleteBlockAndEmptyWrappers(tr, $to)
  else tr.delete($to.start(), to)
  for (const pos of [...between].reverse()) deleteBlockAndEmptyWrappers(tr, tr.doc.resolve(pos + 1))
  if (joins) {
    tr.replaceWith(from, $from.end(), $to.parent.content.cut(to - $to.start()))
    return TextSelection.create(tr.doc, from)
  }
  deleteBlockAndEmptyWrappers(tr, $from)
  return Selection.near(tr.doc.resolve(tr.mapping.map(from)), 1)
}

/**
 * `⌫` / `Delete` over a selection spanning hidden lines: remove only the visible pieces (D6) and
 * leave the caret at the cut. False when the selection is not that shape.
 */
export const deleteVisible: Command = (state, dispatch) => {
  const between = planVisibleDelete(state)
  if (between === null) return false
  if (dispatch) {
    const tr = state.tr
    tr.setSelection(applyVisibleDelete(tr, state.selection, between))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/**
 * `Enter` over a selection spanning hidden lines (D7): remove the visible pieces, then press Enter
 * AGAIN on the view so the ordinary Enter — the outliner's (a parent keeps its kids), Crepe's list
 * split, or the base split — runs on the caret this left behind. Re-dispatching is deliberate: the
 * keymap hands every handler of one key the SAME pre-delete state, so merely declining would let the
 * outliner see a non-empty selection and Crepe's split move the kids under the new item. On the
 * second pass this handler finds no hidden line inside the (now empty) selection and declines. The
 * re-press is a synthetic KeyboardEvent through `handleKeyDown` — the path a real key takes, with
 * no keymap plumbing. A dry run (no dispatch) never re-presses.
 * ⌘X stays the ordinary cut on purpose: it MOVES the whole range, hidden kids included, and paste
 * brings them back — nothing is destroyed.
 */
const enterVisible: Command = (state, dispatch, view) => {
  if (!deleteVisible(state, dispatch)) return false
  if (!dispatch || !view) return true
  const again = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handle) => handle(view, again)) ?? true
}

/** Keymap plugin; register with `editor.use(lineKeymap)`. */
export const lineKeymap = $shortcut(() => ({
  ExtendLineDown: { key: 'Shift-ArrowDown', priority: PRIORITY, onRun: () => extendByLine(1) },
  ExtendLineUp: { key: 'Shift-ArrowUp', priority: PRIORITY, onRun: () => extendByLine(-1) },
  // D6 / D7. The outliner's Backspace/Enter (next in chain) decline non-empty selections (`caretInFirstBlock`).
  DeleteVisibleBack: { key: 'Backspace', priority: PRIORITY, onRun: () => deleteVisible },
  DeleteVisibleForward: { key: 'Delete', priority: PRIORITY, onRun: () => deleteVisible },
  EnterVisible: { key: 'Enter', priority: PRIORITY, onRun: () => enterVisible },
}))

const visibleTypeOverKey = new PluginKey('mdapp-visible-type-over')

/** Typing over a selection that spans hidden lines: D6's deletion, then the text at the cut. Register with `editor.use(visibleTypeOver)`. */
export const visibleTypeOver = $prose(
  () =>
    new Plugin({
      key: visibleTypeOverKey,
      props: {
        handleTextInput: (view, _from, _to, text) => deleteVisible(view.state, (tr) => view.dispatch(tr.insertText(text))),
      },
    }),
)

/** The nested list a list_item holds as its FIRST child — an item with no textblock of its own (D3's invalid resting state) — or null. */
const headlessList = (node: ProseNode): ProseNode | null => {
  const first = node.firstChild
  return isListItem(node) && first !== null && LIST_NODE_NAMES.has(first.type.name) ? first : null
}

/**
 * Replace the headless item at `pos` with its children, one level up (D3). `tr.lift` of the nested
 * list's items out through the item removes both wrappers when the list is the item's only child,
 * and maps positions INSIDE the lifted items exactly (the caret stays on its line); anything the
 * item held AFTER the list is split off as a following item, so nothing is lost. The item is
 * re-read from `tr.doc` because an earlier lift (a headless item nested inside this one) may have
 * reshaped it. `liftTarget` cannot fail for `list_item > list > list_item`: the outer list takes
 * list_items.
 */
const liftHeadlessItem = (tr: Transaction, pos: number): void => {
  const item = tr.doc.nodeAt(pos)
  const list = item === null ? null : headlessList(item)
  if (list === null) return
  // Just inside the nested list: before its first item, after its last.
  const range = tr.doc.resolve(pos + 2).blockRange(tr.doc.resolve(pos + list.nodeSize))!
  tr.lift(range, liftTarget(range)!)
}

const liftHeadlessItemsKey = new PluginKey('mdapp-lift-headless-items')

/** Normaliser; register with `editor.use(liftHeadlessItems)`. */
export const liftHeadlessItems = $prose(
  () =>
    new Plugin({
      key: liftHeadlessItemsKey,
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null
        // Every headless item, deepest / last first so each lift leaves the remaining positions valid.
        const positions: number[] = []
        state.doc.descendants((node, pos) => {
          if (headlessList(node) !== null) positions.push(pos)
          return true
        })
        if (positions.length === 0) return null
        const tr = state.tr
        for (const pos of positions.reverse()) liftHeadlessItem(tr, pos)
        return tr.docChanged ? tr : null
      },
    }),
)
