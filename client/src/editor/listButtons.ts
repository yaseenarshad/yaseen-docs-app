/**
 * The toolbar's list buttons and T (YAZ-3806 T3, T4): one rule, Google Docs style.
 *
 * A LINE is a visible textblock the selection covers (`coveredLines`, `eachVisibleTextblock`): an item line (the
 * first block of a list item) has the item's kind — `checklist` (its `checked` is a boolean), `numberedList` or
 * `bulletList`; any other line in the page, a quote or an item's later blocks is `text` (a paragraph) or `other` (a
 * heading, a code block).
 *
 *  - A button LIGHTS when every line is its kind (`allLinesAre`). T lights for plain paragraphs outside a list.
 *  - Not lit, a click makes each line its own item of that kind (`toggleListKind`): a line outside a list is
 *    wrapped (a heading becomes `* ## x`); an item changes kind, its list split around it when bullet ↔ numbered;
 *    a list that ends up beside one of the same kind joins it.
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
import { Fragment, NodeRange, type Node as ProseNode, type NodeType, type Schema, Slice } from '@milkdown/kit/prose/model'
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
  const lines: Line[] = []
  eachVisibleTextblock(state, from, to, (block, pos, parent, index) => {
    if (parent.type.name === 'list_item' && index === 0) lines.push({ pos, kind: items.get(pos - 1)! })
    else if (CONTAINERS.has(parent.type.name)) lines.push({ pos, kind: block.type.name === 'paragraph' ? 'text' : 'other' })
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

/** The item attributes of `kind`; a checklist line keeps its tick. */
const itemAttrs = (kind: ListKind, item: ProseNode | null) => ({
  ...item?.attrs,
  checked: kind !== 'checklist' ? null : typeof item?.attrs.checked === 'boolean' ? item.attrs.checked : false,
  listType: kind === 'numberedList' ? 'ordered' : 'bullet',
  label: kind === 'numberedList' ? '1.' : '•',
  ...(item === null ? { spread: false } : {}),
})

/** Make the line at `pos` its own item of `kind`. */
const setKind = (tr: Transaction, types: Types, pos: number, kind: ListKind): void => {
  const $pos = tr.doc.resolve(pos)
  const listType = kind === 'numberedList' ? types.ordered : types.bullet
  const container = $pos.parent
  if (container.type !== types.item || $pos.index() !== 0) {
    // A line outside a list: wrap it in a list of one item.
    const range = new NodeRange($pos, tr.doc.resolve(pos + tr.doc.nodeAt(pos)!.nodeSize), $pos.depth)
    if (!range.parent.canReplaceWith(range.startIndex, range.endIndex, listType)) return
    tr.wrap(range, [{ type: listType, attrs: { spread: false } }, { type: types.item, attrs: itemAttrs(kind, null) }])
    joinNeighbours(tr, pos)
    return
  }
  const itemPos = $pos.before()
  tr.setNodeMarkup(itemPos, undefined, itemAttrs(kind, container))
  const list = $pos.node(-1)
  if (list.type === listType) return
  // Bullet ↔ numbered: the item gets a list of its own (the list split after it, then before it), joined to a
  // neighbour of its new type.
  const index = $pos.index(-1)
  if (index < list.childCount - 1) tr.split(itemPos + container.nodeSize, 1)
  let listPos = $pos.before(-1)
  if (index > 0) {
    tr.split(itemPos, 1)
    listPos = itemPos + 1
  }
  tr.setNodeMarkup(listPos, listType, listType === types.ordered ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread })
  joinNeighbours(tr, listPos)
}

/*
 * The two lifts of `prosemirror-schema-list`'s `liftListItem`, on a transaction already in progress (the module
 * exports only the command, which starts its own). Unchanged apart from that and the early returns.
 */

/** Lift the items of `range` one level, into the list around their list; the siblings after them become their children. */
const liftToOuterList = (tr: Transaction, itemType: NodeType, range: NodeRange): void => {
  const end = range.end
  const endOfList = range.$to.end(range.depth)
  if (end < endOfList) {
    tr.step(new ReplaceAroundStep(end - 1, endOfList, end, endOfList, new Slice(Fragment.from(itemType.create(null, range.parent.copy())), 1, 0), 1, true))
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
        (atStart ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))).append(atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))),
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
 * A command that changes each line of the selection in ONE transaction. The lines go LAST to first: a change moves
 * only what comes after its line's start, so each line is still where the state had it, and no position is mapped
 * through the steps before it (that mapping made a click over 1,000 lines quadratic). Declines with no line.
 */
const eachLine =
  (change: (tr: Transaction, types: Types, pos: number, zoomed: number | null) => void): Command =>
  (state, dispatch) => {
    const lines = selectedLines(state)
    if (lines.length === 0) return false
    if (dispatch === undefined) return true
    const types = typesOf(state.schema)
    const zoomed = getZoomedItemPos(state)
    const tr = state.tr
    for (let i = lines.length - 1; i >= 0; i--) change(tr, types, lines[i].pos, zoomed)
    dispatch(tr.scrollIntoView())
    return true
  }

/** A list button (T3): lit → every line leaves its lists; not lit → every line becomes an item of `kind`. */
export const toggleListKind = (kind: ListKind): Command => (state, dispatch, view) =>
  eachLine(
    allLinesAre(state, kind)
      ? (tr, types, pos, zoomed) => void liftOut(tr, types, pos, zoomed)
      : (tr, types, pos) => setKind(tr, types, pos, kind),
  )(state, dispatch, view)

/** T and ⌘⌥0 (T4): every line out of every list level, then a paragraph. */
export const turnIntoText: Command = eachLine((tr, types, pos, zoomed) => {
  const at = liftOut(tr, types, pos, zoomed)
  const block = tr.doc.nodeAt(at)!
  if (block.type !== types.paragraph) tr.setBlockType(at, at + block.nodeSize, types.paragraph)
})

/** Register with `editor.use(listButtons)`, after `visibleFormatting`. */
export const listButtons: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(EditorViewReady)
  const commands = ctx.get(commandsCtx)
  commands.create(turnIntoTextCommand.key, () => turnIntoText)
  commands.create(wrapInBulletListCommand.key, () => toggleListKind('bulletList'))
}
