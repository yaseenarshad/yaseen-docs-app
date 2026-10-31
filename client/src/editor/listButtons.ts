/**
 * The toolbar's list buttons and T (YAZ-3806 T3, T4): one rule, Google Docs style.
 *
 * A LINE is a visible textblock the selection covers (`coveredLines`, `eachVisibleTextblock`): an item line (the
 * first block of a list item) has the item's kind — `checklist` (its `checked` is a boolean), `numberedList` or
 * `bulletList`; any other line in the page or a quote is `text` (a paragraph) or `other` (a heading, a code block).
 * An item's later block is in a list but has no marker: `other`, so nothing lights, and a click first makes it an
 * item of its own (a split; checker 4C). The zoomed bullet's later blocks are the page inside the zoom: `text`.
 *
 *  - A button LIGHTS when every line is its kind (`allLinesAre`). T lights for plain paragraphs outside a list.
 *  - Not lit, a click makes each line its own item of that kind (`toggleListKind`): a line outside a list is
 *    wrapped (a heading becomes `* ## x`); an item changes kind, its list split around it when bullet ↔ numbered —
 *    a numbered part after the split keeps its numbers (checker 4B); a list that ends up beside one of the same kind
 *    joins it. Lines side by side change as one RUN: one wrap per line and one list round them, or one markup per
 *    item and one split each side, so a click over 1,000 lines is about one step per line (checker 4D).
 *  - Lit, a click takes each line out of EVERY list level (`liftOut`): its children stay a list right below it, and
 *    the siblings after it follow in that list. Its heading stays a heading; T also makes it a paragraph.
 *  - Inside a zoom, a line leaves the lists only down to the zoomed bullet, so it stays in view (a block of that
 *    bullet); the zoomed bullet's own line does not leave its list, which would end the zoom.
 *  - Hidden lines (fold, zoom) keep their kind. A click is one transaction, so one ⌘Z.
 *
 * Every change is a lift, a wrap, a split, a join or a markup change — never a replace of the lines — so the fold
 * and zoom positions, and the selection, ride the mapping.
 *
 * `listButtons` re-registers Milkdown's `turnIntoTextCommand` (T, ⌘⌥0, and the slash menu's Text row through
 * `slashMenu.ts`) and `wrapInBulletListCommand` (⌘⌥8) under their own keys, as `visibleFormatting.ts` does for the
 * marks. Register it AFTER `visibleFormatting`: this rule already keeps to the visible lines.
 *
 * A line in a table cell is no line here, so T does not light in a cell (it never changed one: a cell holds
 * paragraphs only).
 */
import { commandsCtx, EditorViewReady } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { turnIntoTextCommand, wrapInBulletListCommand } from '@milkdown/kit/preset/commonmark'
import { Fragment, NodeRange, type Node as ProseNode, type NodeType, type ResolvedPos, type Schema, Slice } from '@milkdown/kit/prose/model'
import type { Command, EditorState, Transaction } from '@milkdown/kit/prose/state'
import { canJoin, liftTarget, ReplaceAroundStep } from '@milkdown/kit/prose/transform'
import { coveredLines, eachVisibleTextblock } from './lineSelection'
import { getZoomedItemPos } from './outline/zoom'

export const LIST_KINDS = ['checklist', 'bulletList', 'numberedList'] as const
export type ListKind = (typeof LIST_KINDS)[number]
type LineKind = ListKind | 'text' | 'other'

interface Line {
  /** The textblock's position. */
  readonly pos: number
  readonly kind: LineKind
}

/** The containers whose blocks are lines outside a list: the page, a quote, and an item after its first block. */
const CONTAINERS: ReadonlySet<string> = new Set(['doc', 'blockquote', 'list_item'])

const kindOfItem = (item: ProseNode, list: ProseNode): ListKind =>
  typeof item.attrs.checked === 'boolean' ? 'checklist' : list.type.name === 'ordered_list' ? 'numberedList' : 'bulletList'

/** The lines of a state, cached: the toolbar asks once per button on each update. */
const linesByState = new WeakMap<EditorState, readonly Line[]>()
const selectedLines = (state: EditorState): readonly Line[] => {
  const cached = linesByState.get(state)
  if (cached !== undefined) return cached
  const { from, to } = coveredLines(state)
  // An item's kind needs its list, which the visible walk does not hand over: one plain walk records it first.
  const items = new Map<number, ListKind>()
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === 'list_item' && parent !== null) items.set(pos, kindOfItem(node, parent))
    return !node.isTextblock
  })
  const zoomed = getZoomedItemPos(state)
  const lines: Line[] = []
  eachVisibleTextblock(state, from, to, (block, pos, parent, index) => {
    if (parent.type.name === 'list_item' && index === 0) lines.push({ pos, kind: items.get(pos - 1)! })
    else if (!CONTAINERS.has(parent.type.name)) return
    else if (parent.type.name === 'list_item' && (zoomed === null || state.doc.resolve(pos).before() !== zoomed)) lines.push({ pos, kind: 'other' })
    else lines.push({ pos, kind: block.type.name === 'paragraph' ? 'text' : 'other' })
  })
  linesByState.set(state, lines)
  return lines
}

/** Lit: EVERY line of the selection is `kind` (T asks for `text`). */
export const allLinesAre = (state: EditorState, kind: ListKind | 'text'): boolean => {
  const lines = selectedLines(state)
  return lines.length > 0 && lines.every((line) => line.kind === kind)
}

interface Types {
  item: NodeType
  bullet: NodeType
  ordered: NodeType
  paragraph: NodeType
}
const typesOf = (schema: Schema): Types => ({
  item: schema.nodes.list_item,
  bullet: schema.nodes.bullet_list,
  ordered: schema.nodes.ordered_list,
  paragraph: schema.nodes.paragraph,
})

/** Join the list at `listPos` with a list of the same type right after it, then right before it. */
const joinNeighbours = (tr: Transaction, listPos: number): void => {
  const list = tr.doc.nodeAt(listPos)!
  const after = listPos + list.nodeSize
  if (canJoin(tr.doc, after) && tr.doc.resolve(after).nodeAfter?.type === list.type) tr.join(after)
  if (canJoin(tr.doc, listPos) && tr.doc.resolve(listPos).nodeBefore?.type === list.type) tr.join(listPos)
}

/**
 * A part of `list` (no items yet) that starts with its item `index`. A numbered part starts at the number that item
 * shows (its `label`, which Milkdown keeps in step), so the lines after a split keep their numbers on disk (checker
 * 4B, 4F); a bullet list's attributes are copied as they are.
 */
const partFrom = (list: ProseNode, index: number): ProseNode => {
  if (!('order' in list.attrs)) return list.type.create(list.attrs)
  const shown = Number.parseInt(String(list.child(index).attrs.label), 10)
  return list.type.create({ ...list.attrs, order: Number.isNaN(shown) ? (list.attrs.order as number) + index : shown })
}

/** The item attributes of `kind`; a checklist line keeps its tick. */
const itemAttrs = (kind: ListKind, item: ProseNode | null) => ({
  ...item?.attrs,
  checked: kind !== 'checklist' ? null : typeof item?.attrs.checked === 'boolean' ? item.attrs.checked : false,
  listType: kind === 'numberedList' ? 'ordered' : 'bullet',
  label: kind === 'numberedList' ? '1.' : '•',
  ...(item === null ? { spread: false } : {}),
})

/** Is the line at `$pos` an item line (its item's first block)? */
const isItemLine = ($pos: ResolvedPos, types: Types): boolean => $pos.parent.type === types.item && $pos.index() === 0

/**
 * An item's later block becomes the first block of an item of its own, right after (a split of the item; checker
 * 4C), so the list rule can act on it. The zoomed bullet's own blocks stay: they are the page inside the zoom.
 * Returns where the line is now.
 */
const ownItem = (tr: Transaction, types: Types, pos: number, zoomed: number | null): number => {
  const $pos = tr.doc.resolve(pos)
  if ($pos.parent.type !== types.item || $pos.index() === 0 || $pos.before() === zoomed) return pos
  // A new line: no tick of the item it came from (checker 4G).
  tr.split(pos, 1, [{ type: types.item, attrs: { ...$pos.parent.attrs, checked: null } }])
  return pos + 2
}

/**
 * The lines in runs, each run the lines side by side in one parent: blocks outside a list, or item lines of one
 * list. Read off the state: a run's start is where the state has it, as long as the runs go last to first.
 */
const runsOf = (state: EditorState, types: Types, lines: readonly Line[]): number[][] => {
  const runs: number[][] = []
  let last: { start: number; index: number; item: boolean } | null = null
  for (const { pos } of lines) {
    const $pos = state.doc.resolve(pos)
    const item = isItemLine($pos, types)
    const here = { start: item ? $pos.start(-1) : $pos.start(), index: item ? $pos.index(-1) : $pos.index(), item }
    // An item's later block goes alone: `ownItem` splits it first.
    const later = !item && $pos.parent.type === types.item
    if (last !== null && !later && last.item === item && last.start === here.start && here.index === last.index + 1) runs[runs.length - 1].push(pos)
    else runs.push([pos])
    last = later ? null : here
  }
  return runs
}

/** Make each line of `run` (positions, in order) its own item of `kind`. */
const setKind = (tr: Transaction, types: Types, run: readonly number[], kind: ListKind, zoomed: number | null): void => {
  const listType = kind === 'numberedList' ? types.ordered : types.bullet
  const first = run.length === 1 ? ownItem(tr, types, run[0], zoomed) : run[0]
  const $first = tr.doc.resolve(first)
  if (!isItemLine($first, types)) {
    // Lines outside a list: one list and one item round the whole run, then the item split before each line, last
    // first (a list item may not stand in the page, so the items cannot come first).
    if (!$first.parent.canReplaceWith($first.index(), $first.index() + run.length, listType)) return
    const lastPos = run[run.length - 1]
    const end = lastPos + tr.doc.nodeAt(lastPos)!.nodeSize
    tr.wrap(new NodeRange($first, tr.doc.resolve(end), $first.depth), [{ type: listType, attrs: { spread: false } }, { type: types.item, attrs: itemAttrs(kind, null) }])
    for (let i = run.length - 1; i > 0; i--) tr.split(run[i] + 2, 1)
    joinNeighbours(tr, first)
    return
  }
  // Item lines of one list: each item's markup, then — bullet ↔ numbered — the run gets a list of its own.
  const lines = run.length === 1 ? [first] : run
  for (const pos of lines) tr.setNodeMarkup(pos - 1, undefined, itemAttrs(kind, tr.doc.nodeAt(pos - 1)))
  const list = $first.node(-1)
  if (list.type === listType) return
  const from = $first.index(-1)
  const to = from + lines.length
  const lastItem = lines[lines.length - 1] - 1
  const firstItem = first - 1
  // The numbered part after the run keeps its numbers (checker 4B).
  if (to < list.childCount) tr.split(lastItem + tr.doc.nodeAt(lastItem)!.nodeSize, 1, [{ type: list.type, attrs: partFrom(list, to).attrs }])
  let listPos = $first.before(-1)
  if (from > 0) {
    tr.split(firstItem, 1)
    listPos = firstItem + 1
  }
  tr.setNodeMarkup(listPos, listType, listType === types.ordered ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread })
  joinNeighbours(tr, listPos)
}

/*
 * The two lifts of `prosemirror-schema-list`'s `liftListItem`, on a transaction already in progress (the module
 * exports only the command, which starts its own). Unchanged apart from that, the early returns, and the list part
 * after the lifted item, which keeps its numbers (`partFrom`, checker 4F).
 */

/** Lift the items of `range` one level, into the list around their list; the siblings after them become their children. */
const liftToOuterList = (tr: Transaction, itemType: NodeType, range: NodeRange): void => {
  const end = range.end
  const endOfList = range.$to.end(range.depth)
  if (end < endOfList) {
    tr.step(new ReplaceAroundStep(end - 1, endOfList, end, endOfList, new Slice(Fragment.from(itemType.create(null, partFrom(range.parent, range.endIndex))), 1, 0), 1, true))
    range = new NodeRange(tr.doc.resolve(range.$from.pos), tr.doc.resolve(endOfList), range.depth)
  }
  const target = liftTarget(range)
  if (target == null) return
  tr.lift(range, target)
  const $after = tr.doc.resolve(tr.mapping.map(end, -1) - 1)
  if (canJoin(tr.doc, $after.pos) && $after.nodeBefore!.type === $after.nodeAfter!.type) tr.join($after.pos)
}

/** Take the one item of `range` out of its list: its blocks join the list's parent, the list closed around them. */
const liftOutOfList = (tr: Transaction, range: NodeRange): void => {
  const list = range.parent
  const $start = tr.doc.resolve(range.start)
  const item = $start.nodeAfter!
  const atStart = range.startIndex === 0
  const atEnd = range.endIndex === list.childCount
  const parent = $start.node(-1)
  const indexBefore = $start.index(-1)
  if (!parent.canReplace(indexBefore + (atStart ? 0 : 1), indexBefore + 1, item.content.append(atEnd ? Fragment.empty : Fragment.from(list)))) return
  const start = $start.pos
  const end = start + item.nodeSize
  tr.step(
    new ReplaceAroundStep(
      start - (atStart ? 1 : 0),
      end + (atEnd ? 1 : 0),
      start + 1,
      end - 1,
      new Slice(
        (atStart ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))).append(atEnd ? Fragment.empty : Fragment.from(partFrom(list, range.endIndex))),
        atStart ? 0 : 1,
        atEnd ? 0 : 1,
      ),
      atStart ? 0 : 1,
    ),
  )
}

/** Take the line at `pos` out of every list level (down to the zoomed bullet). Returns where the line is now. */
const liftOut = (tr: Transaction, types: Types, pos: number, zoomed: number | null): number => {
  // A position inside the line: a lift moves the tokens around the line, never its content.
  let inside = pos + 1
  for (;;) {
    const $line = tr.doc.resolve(inside - 1)
    const item = $line.parent
    if (item.type !== types.item || $line.index() !== 0) return inside - 1
    const itemPos = $line.before()
    // The zoomed bullet itself stays: lifting it would end the zoom.
    if (itemPos === zoomed) return inside - 1
    const $item = tr.doc.resolve(itemPos)
    const range = new NodeRange($item, tr.doc.resolve(itemPos + item.nodeSize), $item.depth)
    const steps = tr.steps.length
    const outer = $item.node(-1)
    if (outer.type === types.item && $item.before(-1) !== zoomed) liftToOuterList(tr, types.item, range)
    else liftOutOfList(tr, range)
    if (tr.steps.length === steps) return inside - 1
    inside = tr.mapping.slice(steps).map(inside)
  }
}

/**
 * A command that changes the selection's lines in ONE transaction, last to first: a change moves only what comes
 * after its own start, so each line is still where the state had it, and no position is mapped through the steps
 * before it (that mapping made a click over 1,000 lines quadratic). Declines with no line.
 */
const onLines =
  (change: (tr: Transaction, types: Types, lines: readonly Line[], zoomed: number | null, state: EditorState) => void): Command =>
  (state, dispatch) => {
    const lines = selectedLines(state)
    if (lines.length === 0) return false
    if (dispatch === undefined) return true
    const tr = state.tr
    change(tr, typesOf(state.schema), lines, getZoomedItemPos(state), state)
    dispatch(tr.scrollIntoView())
    return true
  }

/** Take each line out of every list level, an item's later block made an item first; `after` gets each line where it is then. */
const liftEach = (tr: Transaction, types: Types, lines: readonly Line[], zoomed: number | null, after?: (pos: number) => void): void => {
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = liftOut(tr, types, ownItem(tr, types, lines[i].pos, zoomed), zoomed)
    after?.(at)
  }
}

/** A list button (T3): lit → every line leaves its lists; not lit → every line becomes an item of `kind`. */
export const toggleListKind = (kind: ListKind): Command => (state, dispatch, view) =>
  onLines((tr, types, lines, zoomed) => {
    if (allLinesAre(state, kind)) return liftEach(tr, types, lines, zoomed)
    const runs = runsOf(state, types, lines)
    for (let i = runs.length - 1; i >= 0; i--) setKind(tr, types, runs[i], kind, zoomed)
  })(state, dispatch, view)

/** T and ⌘⌥0 (T4): every line out of every list level, then a paragraph. */
export const turnIntoText: Command = onLines((tr, types, lines, zoomed) =>
  liftEach(tr, types, lines, zoomed, (at) => {
    const block = tr.doc.nodeAt(at)!
    if (block.type !== types.paragraph) tr.setBlockType(at, at + block.nodeSize, types.paragraph)
  }),
)

/** Register with `editor.use(listButtons)`, after `visibleFormatting`. */
export const listButtons: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(EditorViewReady)
  const commands = ctx.get(commandsCtx)
  commands.create(turnIntoTextCommand.key, () => turnIntoText)
  commands.create(wrapInBulletListCommand.key, () => toggleListKind('bulletList'))
}
