/**
 * A new line beside a code block or a table (YAZ-4800 demo): the block handle's "Add line above" / "Add line below"
 * (`turnIntoRows.ts`), ⌘↵ / ⌘⇧↵ in a code block (a CodeMirror keymap, `addLineCodeKeys`) and in a table cell
 * (`addLineKeymap`). An embed too (YAZ-4907): its line's rows, and Enter, ⌘↵ and ⌘⇧↵ with the embed selected
 * (`embedBlockAtSelection`). One command for all of them, so the menu and the keys always agree:
 *  - the block is a list item's first block: a new sibling item of the same list, above or below that item (after its
 *    children), with an empty paragraph; it takes the item's attrs, and a checklist line's new item starts unchecked,
 *    as Enter's new item does (`listCommands.ts`). A numbered list's numbers follow;
 *  - else: an empty paragraph directly above or below the block.
 * The caret goes into the new paragraph and the editor takes the focus. One transaction: one ⌘Z removes it.
 */
import { Prec } from '@codemirror/state'
import { keymap, type EditorView as CodeMirrorView } from '@codemirror/view'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { boardEmbedAt, boardEmbedKey } from '../drawing/boardEmbedScan'
import { isBoardSrc } from '../drawing/boardEmbedText'
import { getZoomedItemPos } from './zoom'

export type LineSide = 'above' | 'below'

/** Adds the line beside the code block or table at `blockPos`; false when nothing can go there. */
export const addLineBesideCommand = (blockPos: number, side: LineSide): Command => (state, dispatch) => {
  const block = state.doc.nodeAt(blockPos)
  const paragraph = state.schema.nodes.paragraph
  if (block == null || paragraph === undefined) return false
  const $block = state.doc.resolve(blockPos)
  const parent = $block.parent
  const itemPos = $block.depth > 0 ? $block.before() : -1
  // The zoomed bullet's own block has no sibling in view (YAZ-4800 demo): a paragraph below it, in the item; none above
  // (that would take the bullet's line).
  const zoomed = parent.type.name === 'list_item' && $block.index() === 0 && itemPos === getZoomedItemPos(state)
  if (zoomed && side === 'above') return false
  if (parent.type.name === 'list_item' && $block.index() === 0 && !zoomed) {
    const list = state.doc.resolve(itemPos).parent
    const at = side === 'above' ? itemPos : itemPos + parent.nodeSize
    const item = parent.type.create({ ...parent.attrs, checked: parent.attrs.checked == null ? null : false }, paragraph.create())
    const index = state.doc.resolve(itemPos).index() + (side === 'above' ? 0 : 1)
    if (!list.canReplaceWith(index, index, item.type)) return false
    if (dispatch) {
      const tr = state.tr.insert(at, item)
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView())
    }
    return true
  }
  const at = side === 'above' ? blockPos : blockPos + block.nodeSize
  const index = $block.index() + (side === 'above' ? 0 : 1)
  if (!parent.canReplaceWith(index, index, paragraph)) return false
  if (dispatch) {
    const tr = state.tr.insert(at, paragraph.create())
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView())
  }
  return true
}

/** The menu rows' and the keys' run: the line, then the focus in it. */
export function addLineBeside(view: EditorView, blockPos: number, side: LineSide): boolean {
  if (!view.editable || !addLineBesideCommand(blockPos, side)(view.state, view.dispatch)) return false
  view.focus()
  return true
}

/** The table the selection is in (a caret or a cell selection in a cell), or null. */
export function tableAtSelection(state: EditorState): number | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'table') return $from.before(depth)
  return null
}

/** In a table cell (YAZ-4800 demo): above `obsidianHotkeys`' ⌘↵ (100), which leaves a table to Crepe's exit-table. */
const inTable = (side: LineSide): Command => (state, dispatch, view) => {
  const table = tableAtSelection(state)
  if (table === null || view === undefined || !view.editable) return false
  // A bullet IN a cell keeps its own ⌘↵, the to-do cycle (YAZ-3818 D6): YAZ-4800 asked for the line beside the table
  // from the table's text, not to take the cell bullets' key away.
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0 && $from.before(depth) > table; depth--) if ($from.node(depth).type.name === 'list_item') return false
  if (!addLineBesideCommand(table, side)(state, dispatch)) return false
  view.focus()
  return true
}

/**
 * The paragraph of a selected embed (YAZ-4907), or null. A board embed is its text selected whole (`boardEmbed.ts`:
 * the window is selected, the host plugin is there); a board of another vault is an image node, selected
 * (`imageView.ts`). The embed's paragraph is the block the line goes beside, as a code block or a table is.
 */
export function embedBlockAtSelection(state: EditorState): number | null {
  const sel = state.selection
  if (sel instanceof NodeSelection) return sel.node.type.name === 'image' && isBoardSrc(sel.node.attrs.src as string) ? sel.$from.before() : null
  if (sel.empty || !(sel instanceof TextSelection) || boardEmbedKey.getState(state) === undefined) return null
  const embed = boardEmbedAt(state.doc, sel.from, 'start')
  return embed !== null && embed.to === sel.to ? sel.$from.before() : null
}

/** Enter, ⌘↵ and ⌘⇧↵ on a selected embed (YAZ-4907): above the list's Enter (100), which typed over the embed. */
const onEmbed = (side: LineSide): Command => (state, dispatch, view) => {
  const block = embedBlockAtSelection(state)
  if (block === null || view === undefined || !view.editable) return false
  if (!addLineBesideCommand(block, side)(state, dispatch)) return false
  view.focus()
  return true
}

export const addLineKeymap = $shortcut(() => ({
  AddLineBelowTable: { key: 'Mod-Enter', priority: 200, onRun: () => inTable('below') },
  AddLineAboveTable: { key: 'Mod-Shift-Enter', priority: 200, onRun: () => inTable('above') },
  AddLineBelowEmbed: { key: 'Enter', priority: 210, onRun: () => onEmbed('below') },
  AddLineBelowEmbedMod: { key: 'Mod-Enter', priority: 210, onRun: () => onEmbed('below') },
  AddLineAboveEmbed: { key: 'Mod-Shift-Enter', priority: 210, onRun: () => onEmbed('above') },
}))

/**
 * The note editor of a DOM node (YAZ-4800 demo): a code block's CodeMirror keymap runs on CodeMirror's own view, and
 * Crepe's code block stops every event before ProseMirror, so the keys find their editor here.
 */
const views = new WeakMap<Element, EditorView>()

export const addLineViews = $prose(
  () =>
    new Plugin({
      key: new PluginKey('ADD_LINE_VIEWS'),
      view: (view) => {
        views.set(view.dom, view)
        return { destroy: () => views.delete(view.dom) }
      },
    }),
)

/** ⌘↵ / ⌘⇧↵ in a code block: the code block's line. Declines (Crepe's exit-code runs) when it finds no editor or block. */
const inCode = (side: LineSide) => (cm: CodeMirrorView): boolean => {
  const editor = cm.dom.parentElement?.closest('.ProseMirror')
  const view = editor == null ? undefined : views.get(editor)
  if (view === undefined || !view.editable) return false
  let blockPos = -1
  view.state.doc.descendants((node, pos) => {
    if (blockPos >= 0) return false
    if (node.type.spec.code === true && view.nodeDOM(pos)?.contains(cm.dom) === true) blockPos = pos
    return !node.isTextblock
  })
  return blockPos >= 0 && addLineBeside(view, blockPos, side)
}

/** In every code block's CodeMirror extensions (`createCrepe.ts`): highest, so it runs before Crepe's `Mod-Enter` exit-code. */
export const addLineCodeKeys = Prec.highest(
  keymap.of([
    { key: 'Mod-Enter', run: inCode('below') },
    { key: 'Mod-Shift-Enter', run: inCode('above') },
  ]),
)
