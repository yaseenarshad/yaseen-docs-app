/**
 * Outliner keymap for bullet / ordered / task lists (GRO-2012). Obsidian-outliner / Logseq
 * feel on top of Crepe's own list keymap; only the gaps are patched here, Milkdown is not forked.
 *
 * What Crepe (commonmark `listItemKeymap` + ProseMirror schema-list) already does right and is
 * reused: Tab = sinkListItem, Shift-Tab = liftListItem (level 1 → paragraph, following siblings
 * nest under the lifted item), Enter = splitListItem in the middle or at the end of a leaf item. Tab and Shift-Tab run
 * those same commands from our bindings below (YAZ-3003). Markers/indent after any of these
 * serialise correctly (GRO-1844).
 *
 * Gaps fixed here (registered with priority 100 so they run before Crepe's 50s):
 *  - Tab inside a list item never falls through to `@milkdown/plugin-indent`, which would
 *    insert literal spaces into the text when the item cannot sink (first sibling).
 *  - Tab on the first item of a list that sits right after another list (a numbered list under a
 *    bullet, or the reverse: Markdown keeps one kind per list) moves the covered items into the
 *    last item of the list above, as `sinkListItem` does inside one list (YAZ-3727 D3). They join
 *    that item's child list and take its kind; with no child list they keep their own (D4).
 *  - Tab inside one list makes a sublist the way its siblings did (YAZ-3727 D10): into the item above's own sublist,
 *    of either kind, taking its kind; else a new sublist of the kind of the nearest sibling's sublist, above first,
 *    then below; else bullets. `sinkListItem` alone wrapped the line in its parent's kind (a number under a number)
 *    and made a second sublist beside one of the other kind.
 *  - Tab, Shift-Tab, Mod-] and Mod-[ act on the lines the selection COVERS (YAZ-3003): a keyboard
 *    line selection touches the parent or the next sibling at zero width, and that line stays put.
 *    So Shift-Tab and Mod-[ are ours now: the zoom guard first, then Crepe's own lift. A text
 *    selection over two or more lines that are not all list items consumes both keys.
 *  - Enter on an EMPTY item (no children) outdents it; at level 1 it leaves the list as a
 *    paragraph. Crepe's `liftEmptyBlock` fallback instead dropped a stray paragraph inside the
 *    parent item when the empty item was not last.
 *  - Enter keeps the line's node, so its fold, zoom and format stay (YAZ-3695 D1, D2, D8). Crepe's
 *    split kept the OLD node as the empty half, so the fold went to the empty line and an empty
 *    heading was left behind (YAZ-3702). At the START of a non-empty item an empty plain item goes
 *    above (on the zoomed item's own line: a new first child). At the END of an item that owns a
 *    nested list (GRO-2012), and in its MIDDLE (D2), the text after the caret becomes its FIRST CHILD
 *    in its own format; when the item is folded (GRO-2011) it goes AFTER the whole subtree instead, so
 *    hidden children never move. On a top-level heading: at its start an empty plain line goes above;
 *    in the middle of a FOLDED one the tail becomes a heading of the same level after the hidden section.
 *  - Backspace at the START of an item's first block, a top-level heading or a top-level paragraph, and
 *    Delete at the END of a line, join two VISIBLE lines by ONE rule (`joinLines`, YAZ-3695 D4-D7,
 *    YAZ-3780): the lower line's text goes to the end of the upper line (in the note, a bullet or a
 *    quote), whose format wins, with one space between two words; an empty line just goes; a removed
 *    bullet's children keep their place on screen; a fold the lines would move into opens, and ⌘Z
 *    closes it again (`foldReveal.ts`). Into a code block or a table, or at the top of a zoom, nothing
 *    happens; a rule next to the caret is selected; at the top of the note an empty line goes, a bullet
 *    lifts and a heading becomes text. Crepe's `joinBackward` produced stray `* * child` lists, second paragraphs and bigger
 *    headings, and joined text into hidden lines. The item above is the one above on screen, also the last item of
 *    a list that ends right above the line's own list (YAZ-3727 D5).
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { bulletListSchema, listItemSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { setBlockType } from '@milkdown/kit/prose/commands'
import { Fragment, type Node as ProseNode, type NodeType, type ResolvedPos, Slice } from '@milkdown/kit/prose/model'
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list'
import { type Command, type EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { canJoin, ReplaceAroundStep } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { deleteBlockAndEmptyWrappers, emptyWrapperDepth, liftHeadlessItem, nextVisibleTextblock, onCoveredLines } from '../lineSelection'
import { rowShortcuts } from '../noteKeys'
import { type Folds, openFolds, recordOpenedFolds } from './foldReveal'
import { headingLevel, isHeadingCollapsed } from './headingFolding'
import { findNestedList, findNestedLists, isListItem, LIST_NODE_NAMES } from './listNodes'
import { isOutlineItemCollapsed } from './outlineFolding'
import { blockEscapingLift, getZoomedItemPos } from './zoom'

/** Priority above Crepe's list/indent/base keymaps (default 50). */
const PRIORITY = 100

/** Both selection ends sit in a textblock that is a direct child of a list_item. */
const selectionInListItems = (state: EditorState, itemType: NodeType): boolean => {
  const { $from, $to } = state.selection
  return $from.depth >= 2 && $from.node(-1).type === itemType && $to.depth >= 2 && $to.node(-1).type === itemType
}

/** Caret (empty selection) inside the FIRST block of a list_item, or null. */
const caretInFirstBlock = (state: EditorState, itemType: NodeType): ResolvedPos | null => {
  const { $from, empty } = state.selection
  if (!empty || $from.depth < 2 || $from.node(-1).type !== itemType || $from.index(-1) !== 0) return null
  return $from
}

/** A text selection over two or more lines (YAZ-3003): Tab / Shift-Tab consume it there instead of typing spaces or moving focus. */
const spansLines = (state: EditorState): boolean => {
  const sel = state.selection
  return sel instanceof TextSelection && !sel.$from.sameParent(sel.$to)
}

/**
 * Tab where `sinkListItem` cannot: the covered items start their list, and another list sits right above it (YAZ-3727
 * D3). They move into that list's last item; the items after them stay where they are, as a list of their own. One step,
 * so folds, zoom and the selection map through and ⌘Z undoes it at once.
 */
const sinkIntoListAbove = (itemType: NodeType): Command => (state, dispatch) => {
  const { $from, $to } = state.selection
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === itemType)
  if (!range || range.startIndex !== 0) return false
  const listPos = range.start - 1
  const above = state.doc.resolve(listPos).nodeBefore
  if (!above || !LIST_NODE_NAMES.has(above.type.name)) return false
  if (!dispatch) return true
  const tr = state.tr
  if (range.endIndex < range.parent.childCount) tr.split(range.end)
  const list = tr.doc.nodeAt(listPos)!
  const target = above.lastChild!
  const joinsChildList = target.lastChild !== null && LIST_NODE_NAMES.has(target.lastChild.type.name)
  // Move the list, kept whole, to the end of the item above: `sinkListItem`'s own step.
  const slice = new Slice(Fragment.from(above.type.create(null, itemType.create())), 2, 0)
  tr.step(new ReplaceAroundStep(listPos - 2, listPos + list.nodeSize, listPos, listPos + list.nodeSize, slice, 0, true))
  // D4: the item's child list and the moved list become one; the first list's kind wins.
  if (joinsChildList) tr.join(listPos - 2)
  dispatch(tr.scrollIntoView())
  return true
}

/** The kind of the nearest sublist among the items of `list` before `start`, nearest first, then from `end` on; null when none has one. */
const siblingSublistKind = (list: ProseNode, start: number, end: number): NodeType | null => {
  const kindOf = (index: number): NodeType | null => findNestedLists(list.child(index)).at(-1)?.list.type ?? null
  for (let index = start - 1; index >= 0; index--) {
    const kind = kindOf(index)
    if (kind) return kind
  }
  for (let index = end; index < list.childCount; index++) {
    const kind = kindOf(index)
    if (kind) return kind
  }
  return null
}

/**
 * Tab inside one list (YAZ-3727 D10): `sinkListItem`, then the sublist the lines went into is set as their siblings'
 * sublists are. In the same transaction, so ⌘Z undoes it at once. False when the lines cannot sink in their list.
 */
const sinkInList = (itemType: NodeType, bulletType: NodeType): Command => (state, dispatch) => {
  const { $from, $to } = state.selection
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === itemType)
  if (!range || range.startIndex === 0) return false
  if (!dispatch) return sinkListItem(itemType)(state)
  let sunk: Transaction | null = null
  if (!sinkListItem(itemType)(state, (tr) => { sunk = tr })) return false
  const tr = sunk as unknown as Transaction
  const above = range.parent.child(range.startIndex - 1)
  const ownSublist = above.lastChild !== null && LIST_NODE_NAMES.has(above.lastChild.type.name)
  // The lines' list now: the parent of the item that holds the caret's line.
  const $line = tr.doc.resolve(tr.mapping.map($from.pos))
  const listPos = $line.before($line.depth - 2)
  const list = $line.node($line.depth - 2)
  const $list = tr.doc.resolve(listPos)
  if (ownSublist) {
    // `sinkListItem` joins a sublist of its own kind only; one of the other kind is joined here, and its kind wins.
    if ($list.nodeBefore && LIST_NODE_NAMES.has($list.nodeBefore.type.name) && canJoin(tr.doc, listPos)) tr.join(listPos)
  } else {
    const kind = siblingSublistKind(range.parent, range.startIndex, range.endIndex) ?? bulletType
    const index = $list.index()
    if (kind !== list.type && $list.parent.canReplaceWith(index, index + 1, kind)) {
      tr.setNodeMarkup(listPos, kind, kind.spec.attrs && 'spread' in kind.spec.attrs ? { spread: list.attrs.spread } : null)
    }
  }
  dispatch(tr)
  return true
}

const indentCommand = (itemType: NodeType, bulletType: NodeType): Command =>
  onCoveredLines((state, dispatch) => {
    if (!selectionInListItems(state, itemType)) return spansLines(state)
    if (!sinkInList(itemType, bulletType)(state, dispatch)) sinkIntoListAbove(itemType)(state, dispatch)
    // Handled either way: a first sibling cannot sink, and the indent plugin must not insert spaces.
    return true
  })

const outdentCommand = (itemType: NodeType): Command =>
  onCoveredLines((state, dispatch) => {
    if (!selectionInListItems(state, itemType)) return spansLines(state)
    // Handled either way: GRO-2029's zoom guard reads the covered lines too, then Crepe's lift.
    if (!blockEscapingLift(state)) liftListItem(itemType)(state, dispatch)
    return true
  })

/** A new item with `template`'s attrs holding `block`; a task starts unchecked. */
const newItem = (itemType: NodeType, template: ProseNode, block: ProseNode): ProseNode =>
  itemType.create({ ...template.attrs, checked: template.attrs.checked == null ? null : false }, block)

const enterCommand = (itemType: NodeType, paragraphType: NodeType): Command => (state, dispatch) => {
  const $from = caretInFirstBlock(state, itemType)
  if (!$from) return false
  const item = $from.node(-1)
  const block = $from.parent

  if (block.content.size === 0 && item.childCount === 1) return liftListItem(itemType)(state, dispatch)

  const itemPos = $from.before(-1)
  const zoomRoot = getZoomedItemPos(state) === itemPos
  const nested = findNestedList(item)
  if ($from.parentOffset === 0 && block.content.size > 0) {
    // D1: an empty plain item ABOVE, so the text keeps its node. The zoomed item has no line above in view: a new first child.
    if (zoomRoot && !nested) return true
    if (dispatch) {
      const at = zoomRoot ? itemPos + 1 + nested!.offset + 1 : itemPos
      dispatch(state.tr.insert(at, newItem(itemType, zoomRoot ? nested!.list.firstChild! : item, paragraphType.create())).scrollIntoView())
    }
    return true
  }

  // The middle or the end of a leaf: Crepe's split.
  if (!nested) return false
  if (!dispatch) return true

  // The text after the caret (an empty paragraph at the end) keeps its line's format (D2).
  const collapsed = isOutlineItemCollapsed(state, itemPos) && !zoomRoot
  const template = collapsed ? item : (nested.list.firstChild ?? item)
  const atEnd = $from.parentOffset === block.content.size
  const tail = atEnd ? paragraphType.create() : block.type.create(block.attrs, block.content.cut($from.parentOffset))
  const tr = state.tr.delete($from.pos, $from.end())
  const insertAt = tr.mapping.map(collapsed ? itemPos + item.nodeSize : itemPos + 1 + nested.offset + 1)
  tr.insert(insertAt, newItem(itemType, template, tail))
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 2))
  dispatch(tr.scrollIntoView())
  return true
}

/** Enter on a top-level heading keeps its fold (D8). An open heading split mid-line, and every end, stay Crepe's. */
const headingEnterCommand = (paragraphType: NodeType): Command => (state, dispatch) => {
  const { $from, empty } = state.selection
  const heading = $from.parent
  if (!empty || $from.depth !== 1 || heading.type.name !== 'heading' || heading.content.size === 0) return false
  const pos = $from.before()
  if ($from.parentOffset === 0) {
    dispatch?.(state.tr.insert(pos, paragraphType.create()).scrollIntoView())
    return true
  }
  if ($from.parentOffset === heading.content.size || !isHeadingCollapsed(state, pos)) return false
  if (!dispatch) return true

  // After the hidden section: before the next heading of the same or a higher level, or at the end of the note.
  let sectionEnd = $from.after()
  for (let index = $from.index(0) + 1; index < state.doc.childCount; index++) {
    const block = state.doc.child(index)
    const level = headingLevel(block)
    if (level !== null && level <= Number(heading.attrs.level)) break
    sectionEnd += block.nodeSize
  }
  const tr = state.tr.delete($from.pos, $from.end())
  const insertAt = tr.mapping.map(sectionEnd)
  tr.insert(insertAt, heading.type.create(heading.attrs, heading.content.cut($from.parentOffset)))
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * Per view: was the key before this one Enter (D7)? A `keydown` DOM handler runs before every keymap, so it moves `current`
 * to `previous` before the command for this key reads it. Modifier keys alone do not count. A mouse press forgets it: a
 * Backspace after a click is not "right after an Enter" (YAZ-3782).
 */
const enterBefore = new WeakMap<EditorView, { previous: boolean; current: boolean }>()
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta'])

/** The Enter tracker for D7; register with `editor.use(enterTracker)`. */
export const enterTracker = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-enter-tracker'),
      props: {
        handleDOMEvents: {
          keydown: (view, event) => {
            if (!MODIFIER_KEYS.has(event.key)) enterBefore.set(view, { previous: enterBefore.get(view)?.current ?? false, current: event.key === 'Enter' })
            return false
          },
          mousedown: (view) => {
            enterBefore.delete(view)
            return false
          },
        },
      },
    }),
)

/** A line the joins act on: a textblock straight in the note, in a list item or in a quote (YAZ-3783). */
const isLine = ($pos: ResolvedPos): boolean => $pos.depth === 1 || isListItem($pos.node(-1)) || $pos.node(-1).type.name === 'blockquote'

/** A line in a table cell: nothing joins into or out of a table (YAZ-3783). */
const inTable = ($pos: ResolvedPos): boolean => $pos.node(-1).type.spec.tableRole !== undefined

/**
 * The item just above the line's item on screen (YAZ-3727 D5): its previous sibling, or the last item of a list that
 * ends right above its own list (a bullet list then a numbered list). Null when there is neither.
 */
const previousItemPos = (doc: ProseNode, $line: ResolvedPos): number | null => {
  if ($line.index(-2) > 0) return $line.before(-1) - $line.node(-2).child($line.index(-2) - 1).nodeSize
  const listPos = $line.before(-2)
  const above = doc.resolve(listPos).nodeBefore
  return above !== null && LIST_NODE_NAMES.has(above.type.name) ? listPos - 1 - above.lastChild!.nodeSize : null
}

/** The zoomed item's own line: the top of a zoom, which nothing joins into. */
const isZoomLine = (state: EditorState, $pos: ResolvedPos): boolean =>
  $pos.depth >= 2 && $pos.index(-1) === 0 && isListItem($pos.node(-1)) && $pos.before(-1) === getZoomedItemPos(state)

/**
 * The folds that removing the line at `$line` touches, in positions BEFORE the join (D5). `open`: the previous sibling's
 * fold when the children move into it, and the line's own fold when the node that slides into its place would take it
 * over (the fold plugins map positions with assoc 1). `gone`: the line's own fold, which goes with it; ⌘Z brings it back.
 */
const lineFolds = (state: EditorState, $line: ResolvedPos): { open: Folds; gone: Folds } => {
  const open: Folds = { items: [], headings: [] }
  const gone: Folds = { items: [], headings: [] }
  const item = $line.node(-1)
  // The node whose fold is the line's: its item, or the line itself (a heading).
  const owner = isListItem(item) && $line.index(-1) === 0 ? $line.before(-1) : $line.before()
  const ownerIsHeading = $line.parent.type.name === 'heading' && owner === $line.before()
  const isCollapsed = ownerIsHeading ? isHeadingCollapsed : isOutlineItemCollapsed
  const list = ownerIsHeading ? 'headings' : 'items'
  const moves = owner !== $line.before() && item.childCount > 1
  // The node that takes the owner's place: the first child when the children move, else the node after what goes.
  const slider = moves ? owner + 1 + $line.parent.nodeSize + 1 : $line.after(emptyWrapperDepth($line))
  if (isCollapsed(state, owner)) {
    gone[list].push(owner)
    if (!isCollapsed(state, slider)) open[list].push(owner)
  }
  const prevPos = moves ? previousItemPos(state.doc, $line) : null
  if (prevPos !== null && isOutlineItemCollapsed(state, prevPos)) open.items.push(prevPos)
  return { open, gone }
}

/**
 * Remove the line at `$line` from `tr` (D5). A bullet's other blocks — its children — keep their place on screen: they
 * become the last children of the item above (`previousItemPos`), or, with none, they take its place one level left.
 * Both moves map the children's positions exactly, so their folds stay. `$line` is in `tr.doc`: the fold step (no
 * change) may come first.
 */
const removeLine = (tr: Transaction, $line: ResolvedPos): void => {
  const item = $line.node(-1)
  if (!isListItem(item) || $line.index(-1) !== 0 || item.childCount === 1) return deleteBlockAndEmptyWrappers(tr, $line)
  let owner = $line.before(-1)
  if (previousItemPos(tr.doc, $line) === null) {
    // No item above: the children take its place.
    tr.delete($line.before(), $line.after())
    liftHeadlessItem(tr, owner)
    return
  }
  if ($line.index(-2) === 0) {
    // The item above ends the list right above (YAZ-3727 D5): the items after this one keep a list of their own, then
    // the two lists become one, so the item above is its previous sibling. The upper list's kind wins (D4).
    if ($line.index(-2) + 1 < $line.node(-2).childCount) tr.split(owner + item.nodeSize)
    tr.join($line.before(-2))
    owner -= 2
  }
  // The previous sibling takes the rest of the item, then its own last list and the children's list become one.
  tr.join(owner)
  const at = owner - 1
  tr.delete(at, at + $line.parent.nodeSize)
  const before = tr.doc.resolve(at).nodeBefore
  if (before !== null && LIST_NODE_NAMES.has(before.type.name) && canJoin(tr.doc, at)) tr.join(at)
}

/** Whether removing the top-level line at `$lower` puts the block after it into the section of a heading of `level`. */
const sectionGrows = (state: EditorState, $lower: ResolvedPos, level: number): boolean => {
  const next = $lower.depth === 1 ? state.doc.nodeAt($lower.after()) : null
  const nextLevel = next === null ? null : headingLevel(next)
  return next !== null && (nextLevel === null || nextLevel > level)
}

/** An empty line that just goes, next to anything — a code block, a table, a rule (YAZ-3785): empty, not code, a line. */
const isEmptyLine = ($pos: ResolvedPos): boolean => $pos.parent.content.size === 0 && !$pos.parent.type.spec.code && isLine($pos)

/** Inside a quote: two quote lines join with no space, as on `main` (YAZ-3787). */
const inQuote = ($pos: ResolvedPos): boolean => {
  for (let depth = $pos.depth - 1; depth > 0; depth--) if ($pos.node(depth).type.name === 'blockquote') return true
  return false
}

/**
 * Start an edit that removes the line at `$line`: its fold step first (YAZ-3781), then the line. `alsoOpen` adds folds to
 * open (positions before the edit). Call `finish` after the edit's last step: it opens the folds in the final document.
 */
const startRemoval = (state: EditorState, $line: ResolvedPos, alsoOpen: Folds = { items: [], headings: [] }) => {
  const { open, gone } = lineFolds(state, $line)
  open.items.push(...alsoOpen.items)
  open.headings.push(...alsoOpen.headings)
  const tr = state.tr
  recordOpenedFolds(tr, { items: [...new Set([...open.items, ...gone.items])], headings: [...new Set([...open.headings, ...gone.headings])] })
  removeLine(tr, $line)
  const finish = () => openFolds(tr, { items: open.items.map((pos) => tr.mapping.map(pos, 1)), headings: open.headings.map((pos) => tr.mapping.map(pos, 1)) })
  return { tr, finish }
}

/**
 * THE JOIN RULE (YAZ-3695 D4-D7), for Backspace and Delete alike; `$upper` and `$lower` sit in the two lines. An empty
 * line just goes, FIRST and next to anything (YAZ-3785), and the other line keeps its format and fold. Else the lower
 * line's text moves to the end of the upper line, whose format wins, and the lower line goes. With `space`, one space
 * goes between two words (D7), but not between two quote lines (YAZ-3787); the caret goes after it. A join never hides
 * a line: a fold that the moved lines would go into opens (the caret guard covers the caret's line). ⌘Z gives the text
 * and the folds back (`recordOpenedFolds`, YAZ-3781). Text into or out of a code block or a table, and anything at the
 * top of a zoom: nothing happens (true, no dispatch).
 */
const joinLines = (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, $upper: ResolvedPos, $lower: ResolvedPos, space: boolean): boolean => {
  const upper = $upper.parent
  const lower = $lower.parent
  if (isZoomLine(state, $upper)) return true
  const $empty = isEmptyLine($upper) ? $upper : isEmptyLine($lower) ? $lower : null
  if ($empty === null) {
    if (upper.type.spec.code || lower.type.spec.code || inTable($upper) || inTable($lower)) return true
    if (!isLine($upper) || !isLine($lower)) return false
  }
  if (!dispatch) return true

  // The upper heading's section grows when the lower line goes: open its fold (D6).
  const level = headingLevel(upper)
  const grows = $empty !== $upper && level !== null && $upper.depth === 1 && isHeadingCollapsed(state, $upper.before()) && sectionGrows(state, $lower, level)
  const { tr, finish } = startRemoval(state, $empty ?? $lower, { items: [], headings: grows ? [$upper.before()] : [] })
  let caret: number
  if ($empty === $upper) caret = tr.mapping.map($lower.start())
  else {
    const end = tr.mapping.map($upper.end(), -1)
    const words = $empty === null && space && !(inQuote($upper) && inQuote($lower)) && !/\s$/.test(upper.textContent) && !/^\s/.test(lower.textContent)
    const gap = words ? ' ' : ''
    if ($empty === null) tr.insert(end, gap === '' ? lower.content : Fragment.from(state.schema.text(gap)).append(lower.content))
    caret = end + gap.length
  }
  finish()
  tr.setSelection(TextSelection.create(tr.doc, caret))
  dispatch(tr.scrollIntoView())
  return true
}

/**
 * The leaf block (`hr`) next to the caret: an empty caret line just goes first (YAZ-3785); either way the leaf is
 * selected, so the next press removes it (YAZ-3784).
 */
const besideLeaf = (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, $line: ResolvedPos, leaf: NodeSelection): boolean => {
  if (!dispatch) return true
  if (!isEmptyLine($line)) {
    dispatch(state.tr.setSelection(leaf).scrollIntoView())
    return true
  }
  const { tr, finish } = startRemoval(state, $line)
  finish()
  dispatch(tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(leaf.from))).scrollIntoView())
  return true
}

/**
 * Backspace (and ⇧⌫, ⌃H, ⌥⌫, ⌘⌫) at the START of an item's first block, of a top-level heading or of a top-level
 * paragraph (D5, D6, YAZ-3780): join into the previous VISIBLE line, never a hidden one. No space right after an Enter,
 * so undoing a slip gives the word back (D7). A rule above is selected (an empty caret line goes first). At the top of the note an item lifts to a
 * paragraph (GRO-2012), an empty line goes and the next line moves up (YAZ-3798), a heading becomes a paragraph and a
 * paragraph declines; at the top of a zoom nothing happens.
 * Mid-line it declines: native deletion.
 */
const backspaceCommand = (itemType: NodeType, paragraphType: NodeType): Command => (state, dispatch, view) => {
  const { $from, empty } = state.selection
  const inItem = caretInFirstBlock(state, itemType) !== null
  const topLevel = $from.depth === 1 && ($from.parent.type.name === 'heading' || $from.parent.type === paragraphType)
  if (!empty || $from.parentOffset !== 0 || !(inItem || topLevel)) return false
  const $prev = nextVisibleTextblock(state, $from, -1)
  if ($prev instanceof NodeSelection) return besideLeaf(state, dispatch, $from, $prev)
  if ($prev === null) {
    if (getZoomedItemPos(state) !== null) return true
    if (inItem) return liftListItem(itemType)(state, dispatch)
    // An empty line at the top of the note just goes: the next line moves up with its format and fold (YAZ-3798).
    const $next = isEmptyLine($from) ? nextVisibleTextblock(state, $from, 1) : null
    if ($next instanceof NodeSelection) return besideLeaf(state, dispatch, $from, $next)
    if ($next !== null) return joinLines(state, dispatch, $from, $next, false)
    return $from.parent.type !== paragraphType && setBlockType(paragraphType)(state, dispatch)
  }
  return joinLines(state, dispatch, $prev, $from, !(view !== undefined && enterBefore.get(view)?.previous === true))
}

/**
 * Delete (and ⌃D, ⌥⌦, ⌘⌦, ⌃⌥⌫, ⌥D) at the END of a line (D4): the next VISIBLE line joins here; a rule there is
 * selected (an empty caret line goes first). Anywhere else it declines (D3: the next character, natively). At the end of the note it declines; at the
 * end of a zoom nothing happens.
 */
const deleteCommand: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code || $from.parentOffset !== $from.parent.content.size || !isLine($from)) return false
  const $next = nextVisibleTextblock(state, $from, 1)
  if ($next instanceof NodeSelection) return besideLeaf(state, dispatch, $from, $next)
  if ($next === null) return getZoomedItemPos(state) !== null
  return joinLines(state, dispatch, $from, $next, true)
}

const BACKSPACE_KEYS = ['Backspace', 'Shift-Backspace', 'Ctrl-h', 'Alt-Backspace', 'Mod-Backspace']
const DELETE_KEYS = ['Delete', 'Ctrl-d', 'Alt-Delete', 'Mod-Delete', 'Ctrl-Alt-Backspace', 'Alt-d']

/** Keymap plugin; register with `editor.use(outlinerKeymap)`. Tab, Enter, Backspace and Delete are built in; ⌘] / ⌘[ are the rows' (YAZ-3564 K4). */
export const outlinerKeymap = $shortcut((ctx: Ctx) => {
  const itemType = listItemSchema.type(ctx)
  const paragraphType = paragraphSchema.type(ctx)
  const bulletType = bulletListSchema.type(ctx)
  return {
    Tab: { key: 'Tab', priority: PRIORITY, onRun: () => indentCommand(itemType, bulletType) },
    ...rowShortcuts(ctx, 'note.indent', 'IndentBracket', { priority: PRIORITY, onRun: () => indentCommand(itemType, bulletType) }),
    Outdent: { key: 'Shift-Tab', priority: PRIORITY, onRun: () => outdentCommand(itemType) },
    ...rowShortcuts(ctx, 'note.outdent', 'OutdentBracket', { priority: PRIORITY, onRun: () => outdentCommand(itemType) }),
    Enter: { key: 'Enter', priority: PRIORITY, onRun: () => enterCommand(itemType, paragraphType) },
    HeadingEnter: { key: 'Enter', priority: PRIORITY, onRun: () => headingEnterCommand(paragraphType) },
    ...Object.fromEntries(BACKSPACE_KEYS.map((key) => [`Backspace:${key}`, { key, priority: PRIORITY, onRun: () => backspaceCommand(itemType, paragraphType) }])),
    ...Object.fromEntries(DELETE_KEYS.map((key) => [`Delete:${key}`, { key, priority: PRIORITY, onRun: () => deleteCommand }])),
  }
})
