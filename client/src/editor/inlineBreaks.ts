/**
 * Inline `<br>` ↔ hardbreak (YAZ-1452).
 *
 * Milkdown's `remarkPreserveEmptyLine` deletes EVERY inline `<br>` html node on parse, so a
 * `<br>` inside a table cell (the only way GFM can break a line in a cell) vanished on load and
 * was gone from disk on the next autosave. This plugin runs BEFORE it (see createCrepe) and turns
 * a `<br>` that sits next to real content into an mdast `break`. The lone `<br />` Milkdown writes
 * for an empty paragraph is left for Milkdown's plugin, so blank lines round-trip as before.
 * On save, a break inside a table cell is written as `<br>` (remark's default writes a space there).
 */
import { $remark } from '@milkdown/kit/utils'
import { defaultHandlers } from 'mdast-util-to-markdown'
import type { Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { visit } from 'unist-util-visit'

const BR = /^<br\s*\/?>$/i
/** Where a `<br>` is a block of its own, not a line break inside text. */
const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'listItem'])

const toMarkdownExtension: ToMarkdownOptions = {
  handlers: {
    break: (node, parent, state, info) =>
      state.stack.includes('tableCell') ? '<br>' : defaultHandlers.break(node, parent, state, info),
  },
}

export const inlineBreaks = $remark('mdapp-inline-breaks', () => function inlineBreaks() {
  const data = this.data() as { toMarkdownExtensions?: ToMarkdownOptions[] }
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdownExtension]
  return (tree) => {
    visit(tree, 'html', (node, index, parent) => {
      if (!parent || index === undefined || !BR.test(node.value.trim())) return
      if (BLOCK_CONTAINERS.has(parent.type)) return
      if (parent.type === 'paragraph' && parent.children.length === 1) return
      parent.children[index] = { type: 'break' }
    })
  }
})
