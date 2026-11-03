/**
 * Inline `<br>` ↔ hardbreak (YAZ-1452).
 *
 * Milkdown's `remarkPreserveEmptyLine` deletes EVERY inline `<br>` html node on parse, so a
 * `<br>` inside a table cell (the only way GFM can break a line in a cell) vanished on load and
 * was gone from disk on the next autosave. Three pieces fix that:
 *
 *  1. `inlineBreaksRemark` ($remark): runs BEFORE Milkdown's plugin (see createCrepe) and turns a
 *     `<br>` into an mdast `break`. In a prose paragraph a `<br>` with nothing after it is
 *     meaningless (CommonMark has no trailing hard break; remark would write a stray `\`), so those
 *     are dropped — which also keeps Milkdown's lone `<br />` blank-line marker round-tripping.
 *     A `<br>` at a line end, or on a line of its own, is ONE break with the line ending beside
 *     it: Milkdown has already made that line ending a soft break, and the `<br>` takes the one
 *     before it and the one after it.
 *     Its stringify handler writes a break inside a table cell back as `<br>` (remark's default
 *     writes a space there).
 *  2. `cellSchemas` ($nodeSchema extensions): a table cell serialises its paragraph content
 *     directly. Milkdown's paragraph runner always drops a paragraph's LAST hardbreak (right for
 *     prose, wrong in a cell — a trailing `<br>` would decay one per save), and wrote `<br />` for
 *     an empty cell. Several paragraphs in one cell are joined by a break. A body cell also holds
 *     lists (YAZ-3818 D1), written as one line of HTML (`table/cellLists.ts`, D2). `withCellStyle` adds
 *     the cell's `fill` and `color` (YAZ-3758) in the same extension: `extendSchema` always derives
 *     from the ORIGINAL schema, so a second extension would drop this one.
 *  3. `cellBreakKeymap` ($shortcut): Enter and Shift-Enter inside a table cell insert a
 *     hardbreak — a new line in the cell, as in Google Docs (🔒 YAZ-1462); Mod-Enter still exits
 *     the table. Milkdown's own Shift-Enter refuses to run inside tables, and its "second
 *     Shift-Enter after a break makes a new paragraph" rule would split the table. In a bullet in a
 *     cell, Enter makes the next bullet (YAZ-3818 D6); Shift-Enter stays a line break in the bullet.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { hardbreakSchema, listItemSchema } from '@milkdown/kit/preset/commonmark'
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm'
import type { Node as PMNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { splitListItem } from '@milkdown/kit/prose/schema-list'
import type { Command } from '@milkdown/kit/prose/state'
import type { SerializerState } from '@milkdown/kit/transformer'
import { $remark, $shortcut } from '@milkdown/kit/utils'
import type { RootContent } from 'mdast'
import { defaultHandlers } from 'mdast-util-to-markdown'
import type { Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { visit } from 'unist-util-visit'
import { itemInCell } from './outline/listNodes'
import { cellListsRemark, writeCellBlocks } from './table/cellLists'
import { withCellStyle } from './table/tableStyle'

/** A `<br>` in any spelling: a line break, or a footnote's empty line (`table/cellNotes.ts`). */
export const BR = /^<br\s*\/?>$/i
const isBr = (node: RootContent): boolean => node.type === 'html' && BR.test(node.value.trim())
/** The line ending inside a paragraph, which Milkdown has already made a break of its own (`isInline`). */
const isSoftBreak = (node: RootContent | undefined): boolean =>
  node?.type === 'break' && (node.data as { isInline?: boolean } | undefined)?.isInline === true

const toMarkdownExtension: ToMarkdownOptions = {
  handlers: {
    break: (node, parent, state, info) =>
      state.stack.includes('tableCell') ? '<br>' : defaultHandlers.break(node, parent, state, info),
  },
}

export const inlineBreaksRemark = $remark('mdapp-inline-breaks', () => function inlineBreaks() {
  const data = this.data() as { toMarkdownExtensions?: ToMarkdownOptions[] }
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdownExtension]
  return (tree) => {
    visit(tree, 'html', (node, index, parent) => {
      if (!parent || index === undefined || !isBr(node)) return
      const trailingInProse = parent.type === 'paragraph' && !parent.children.slice(index + 1).some((n) => !isBr(n))
      if (!trailingInProse) {
        parent.children[index] = { type: 'break' }
        // A `<br>` at a line end, or on a line of its own, is ONE break with the line ending beside
        // it. Two breaks would save as `\` + a blank line, which ends the paragraph.
        if (isSoftBreak(parent.children[index + 1])) parent.children.splice(index + 1, 1)
        if (!isSoftBreak(parent.children[index - 1])) return
        parent.children.splice(index - 1, 1)
        return index
      }
      parent.children.splice(index, 1)
      return index
    })
  }
})

const cellToMarkdown = (typeName: string) => ({
  match: (node: PMNode) => node.type.name === typeName,
  runner: (state: SerializerState, node: PMNode) => {
    state.openNode('tableCell')
    writeCellBlocks(state, node)
    state.closeNode()
  },
})

/** What a body cell holds: lines and lists (YAZ-3818 D1). Paragraph first, so `createAndFill` makes one empty line. */
export const CELL_CONTENT = '(paragraph | bullet_list | ordered_list)+'

export const cellSchemas = [
  tableCellSchema.extendSchema((prev) => (ctx) => withCellStyle({ ...prev(ctx), content: CELL_CONTENT, toMarkdown: cellToMarkdown('table_cell') })),
  // A header cell stays one line (YAZ-3818 D7).
  tableHeaderSchema.extendSchema((prev) => (ctx) => withCellStyle({ ...prev(ctx), toMarkdown: cellToMarkdown('table_header') })),
]

const CELL_TYPES = new Set(['table_cell', 'table_header'])

const inCell = ($pos: ResolvedPos): boolean => {
  for (let depth = $pos.depth; depth > 0; depth--) if (CELL_TYPES.has($pos.node(depth).type.name)) return true
  return false
}

/** Inside a table cell: insert a hardbreak. Elsewhere: not handled (Milkdown's Shift-Enter runs). */
export const insertCellBreak = (ctx: Ctx): Command => (state, dispatch) => {
  if (!inCell(state.selection.$from)) return false
  dispatch?.(state.tr.replaceSelectionWith(hardbreakSchema.type(ctx).create()).scrollIntoView())
  return true
}

/**
 * Above Milkdown's keymaps (50), BELOW the wikilink picker and outliner keymaps (100): an open
 * `[[` picker must take Enter before a cell does.
 */
const PRIORITY = 90

/**
 * Enter in a table cell: in a bullet in the cell, the plain split the outliner's Enter (priority 100) leaves to Crepe
 * (YAZ-3818 D6; the outliner keeps the empty bullet and the bullet with children); elsewhere in a cell, a hardbreak.
 */
const cellEnter = (ctx: Ctx): Command => (state, dispatch) =>
  itemInCell(state.selection.$from) ? splitListItem(listItemSchema.type(ctx))(state, dispatch) : insertCellBreak(ctx)(state, dispatch)

export const cellBreakKeymap = $shortcut((ctx: Ctx) => ({
  InsertCellBreak: { key: 'Enter', priority: PRIORITY, onRun: () => cellEnter(ctx) },
  InsertCellBreakShift: { key: 'Shift-Enter', priority: PRIORITY, onRun: () => insertCellBreak(ctx) },
}))

/**
 * Register with `editor.use(inlineBreaks)` — BEFORE Milkdown's `remarkPreserveEmptyLinePlugin`.
 * `cellListsRemark` runs right after `inlineBreaksRemark`: it reads a cell's `<br>` as a `break`.
 */
export const inlineBreaks = [inlineBreaksRemark, cellListsRemark, ...cellSchemas, cellBreakKeymap].flat()
