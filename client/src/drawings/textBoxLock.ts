/**
 * THE BLOCK LOCK OF A TEXT BOX (YAZ-4277 1B, D4). The box editor is the note's `createCrepe`; a box holds only what
 * the canvas draws: lines, bullets (checklists too) and the letter styles of `textRuns`. Three layers, as the folder
 * outline's `bulletsOnly.ts` does, cheapest first:
 *
 *  1. OFF: the input rules that would make a block or a mark a box cannot hold — `> ` quote, ``` code, `---` line,
 *     `# ` heading, `` `x` `` inline code (it deletes the backticks), `|2x2| ` table, the image rule. Kept: italic,
 *     bold, strike, highlight, the `[ ] ` checklist and the app's own bullet typing. `textBoxLock.test.ts` lists the
 *     rules that stay, so a new note rule fails it until it is put on a side.
 *  2. SCHEMA: a list item holds one line and its sub-bullets (`paragraph bullet_list?`); no trailing paragraph.
 *  3. MAP, NEVER DROP: a paste, a key (⌘⌥1 heading, ⌘E code) or anything else that still makes such a block is
 *     turned back into lines and bullets with the same letters, by a paste rule and an `appendTransaction`. A mark
 *     the box cannot draw comes off; its letters stay.
 *
 * Also here: `text_color`, the box's letter color mark (`textRuns[].color`). Notes have none; it never reaches Markdown.
 */
import type { Crepe } from '@milkdown/crepe'
import { trailingConfig } from '@milkdown/kit/plugin/trailing'
import {
  createCodeBlockInputRule,
  inlineCodeInputRule,
  insertHrInputRule,
  insertImageInputRule,
  wrapInBlockquoteInputRule,
  wrapInHeadingInputRule,
} from '@milkdown/kit/preset/commonmark'
import { extendListItemSchemaForTask, insertTableInputRule } from '@milkdown/kit/preset/gfm'
import { Fragment, type Node as ProseNode, type Schema, Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $markSchema, $pasteRule, $prose } from '@milkdown/kit/utils'

/** The marks a box draws (`textBoxDoc.ts` maps each to a run style). */
export const BOX_MARKS = new Set(['strong', 'emphasis', 'underline', 'strike_through', 'highlight', 'text_color'])
const BOX_NODES = new Set(['doc', 'paragraph', 'bullet_list', 'list_item', 'text', 'hardbreak'])

export const textColorSchema = $markSchema('text_color', () => ({
  attrs: { color: { default: null } },
  parseDOM: [{ tag: 'span[data-text-color]', getAttrs: (dom) => ({ color: (dom as HTMLElement).getAttribute('data-text-color') }) }],
  toDOM: (mark) => ['span', { 'data-text-color': mark.attrs.color as string }, 0],
  parseMarkdown: { match: () => false, runner: () => {} },
  // a copy as Markdown keeps the letters and drops the color
  toMarkdown: { match: (mark) => mark.type.name === 'text_color', runner: () => {} },
}))

/** True when the node, and all it holds, is something a box draws. */
function fits(node: ProseNode): boolean {
  if (!BOX_NODES.has(node.type.name)) return false
  if (node.type.name === 'list_item' && node.attrs.listType !== 'bullet') return false
  if (node.isText) return node.marks.every((mark) => BOX_MARKS.has(mark.type.name))
  let ok = true
  node.forEach((child) => {
    if (ok && !fits(child)) ok = false
  })
  return ok
}

/** A text block's inline content with only what a box draws: text with its box marks, and line breaks. */
function lineOf(schema: Schema, block: ProseNode): ProseNode {
  if (block.type.name === 'code_block') return schema.nodes.paragraph.create(null, block.textContent ? schema.text(block.textContent) : null)
  const inline: ProseNode[] = []
  block.forEach((child) => {
    if (child.isText) inline.push(child.mark(child.marks.filter((mark) => BOX_MARKS.has(mark.type.name))))
    else if (child.type.name === 'hardbreak') inline.push(child)
  })
  return schema.nodes.paragraph.create(null, inline)
}

/** The items of a bullet list made from `list`'s items: each item one line and its sub-bullets; more lines follow it. */
function itemsOf(schema: Schema, list: ProseNode): ProseNode[] {
  const out: ProseNode[] = []
  list.forEach((item) => {
    const inside = item.type.name === 'list_item' ? blocksOf(schema, item.content) : blocksOf(schema, Fragment.from(item))
    const first = inside[0]?.type.name === 'paragraph' ? inside.shift()! : schema.nodes.paragraph.create()
    const subItems: ProseNode[] = []
    const after: ProseNode[] = []
    for (const block of inside) {
      if (block.type.name === 'bullet_list') block.forEach((child) => subItems.push(child))
      else after.push(schema.nodes.list_item.create({ listType: 'bullet', spread: false }, block))
    }
    const attrs = { ...item.attrs, listType: 'bullet', spread: false, checked: item.type.name === 'list_item' ? item.attrs.checked : null }
    out.push(schema.nodes.list_item.create(attrs, subItems.length ? [first, schema.nodes.bullet_list.create(null, subItems)] : [first]), ...after)
  })
  return out
}

/**
 * A numbered list as numbered lines (`1. first`), 4 spaces for each level: a box has no numbered list, and its canvas
 * reads `1. ` as letters. Lists inside it are lines too, their markers written out, so no line loses its place.
 */
function numberedLines(schema: Schema, list: ProseNode, depth: number): ProseNode[] {
  const out: ProseNode[] = []
  const first = typeof list.attrs.order === 'number' ? list.attrs.order : 1
  list.forEach((item, _offset, index) => {
    const marker = list.type.name === 'ordered_list' ? `${first + index}.` : '•'
    let lead = true
    item.forEach((child) => {
      if (child.type.name === 'bullet_list' || child.type.name === 'ordered_list') {
        out.push(...numberedLines(schema, child, depth + 1))
        return
      }
      for (const block of blocksOf(schema, Fragment.from(child))) {
        const prefix = '    '.repeat(depth) + (lead ? `${marker} ` : '   ')
        lead = false
        out.push(schema.nodes.paragraph.create(null, [schema.text(prefix), ...contentOf(block)]))
      }
    })
  })
  return out
}

/** A paragraph's inline nodes. */
const contentOf = (block: ProseNode) => {
  const out: ProseNode[] = []
  block.forEach((child) => out.push(child))
  return out
}

/** `content` as lines and bullet lists, with the same letters. */
export function blocksOf(schema: Schema, content: Fragment): ProseNode[] {
  const out: ProseNode[] = []
  content.forEach((node) => {
    const name = node.type.name
    if (name === 'paragraph' && fits(node)) out.push(node)
    else if (name === 'bullet_list') out.push(schema.nodes.bullet_list.create(null, itemsOf(schema, node)))
    else if (name === 'ordered_list') out.push(...numberedLines(schema, node, 0))
    else if (name === 'code_block') for (const line of node.textContent.split('\n')) out.push(schema.nodes.paragraph.create(null, line ? schema.text(line) : null))
    else if (name === 'html') {
      if (node.attrs.value) out.push(schema.nodes.paragraph.create(null, schema.text(node.attrs.value as string)))
    } else if (node.isTextblock) out.push(lineOf(schema, node))
    else if (!node.isLeaf) out.push(...blocksOf(schema, node.content))
  })
  return out
}

/** A pasted slice as lines and bullets; one that already fits is kept as it is (a copy from a box or a note's bullets). */
function pasteAsBox(slice: Slice, schema: Schema): Slice {
  let ok = true
  slice.content.forEach((node) => {
    if (ok && !(node.isInline ? !node.isText || node.marks.every((m) => BOX_MARKS.has(m.type.name)) : fits(node))) ok = false
  })
  if (ok) return slice
  if (slice.content.firstChild?.isInline) {
    const inline: ProseNode[] = []
    slice.content.forEach((node) => {
      if (node.isText) inline.push(node.mark(node.marks.filter((mark) => BOX_MARKS.has(mark.type.name))))
      else if (node.type.name === 'hardbreak') inline.push(node)
    })
    return new Slice(Fragment.fromArray(inline), slice.openStart, slice.openEnd)
  }
  return Slice.maxOpen(Fragment.fromArray(blocksOf(schema, slice.content)))
}

const boxPaste = $pasteRule(() => ({ run: (slice: Slice, view) => pasteAsBox(slice, view.state.schema) }))

/** The backstop: after any change, a top-level block a box cannot draw becomes lines and bullets. */
const boxBlocks = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-text-box-blocks'),
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const wrong: Array<{ pos: number; node: ProseNode }> = []
        state.doc.forEach((node, pos) => {
          if (!fits(node) || (node.type.name !== 'paragraph' && node.type.name !== 'bullet_list')) wrong.push({ pos, node })
        })
        if (wrong.length === 0) return null
        const tr = state.tr
        for (const { pos, node } of wrong.reverse()) {
          const blocks = blocksOf(state.schema, Fragment.from(node))
          tr.replaceWith(pos, pos + node.nodeSize, blocks.length ? blocks : state.schema.nodes.paragraph.create())
        }
        return tr
      },
    }),
)

/** Locks a Crepe made by `createCrepe({ features: textBoxFeatures })` to a box, BEFORE `create()`. */
export function lockToTextBox(crepe: Crepe): void {
  for (const rule of [
    wrapInBlockquoteInputRule,
    createCodeBlockInputRule,
    insertHrInputRule,
    wrapInHeadingInputRule,
    inlineCodeInputRule,
    insertImageInputRule,
    insertTableInputRule,
  ]) {
    void crepe.editor.remove(rule)
  }
  crepe.editor
    .config((ctx) => {
      ctx.update(trailingConfig.key, (prev) => ({ ...prev, shouldAppend: () => false }))
    })
    .use(extendListItemSchemaForTask.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: 'paragraph bullet_list?' })))
    .use(textColorSchema)
    .use(boxPaste)
    .use(boxBlocks)
}
