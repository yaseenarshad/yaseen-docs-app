import { editorViewOptionsCtx, prosePluginsCtx, remarkCtx, schemaCtx } from '@milkdown/kit/core'
import { DOMSerializer } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node } from '@milkdown/kit/transformer'
import { $prose } from '@milkdown/kit/utils'

type ClipboardNode = Node & { value?: unknown; children?: ClipboardNode[] }

/** Remove only parsed HTML spacers; source offsets preserve every other byte, including code. */
function withoutSpacers(text: string, tree: ClipboardNode): string {
  let result = ''
  let cursor = 0
  const visit = (node: ClipboardNode): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (node.type === 'html' && node.value === '<br />' && start !== undefined && end !== undefined) {
      result += text.slice(cursor, start)
      cursor = end
    }
    node.children?.forEach(visit)
  }
  visit(tree)
  return result + text.slice(cursor)
}

/** Copy-only formatting: clean text spacers and explicit HTML paragraph spacing; saves stay unchanged. */
export const clipboardCopyOut = $prose((ctx) => {
  ctx.update(editorViewOptionsCtx, (prev) => {
    const stock = ctx.get(prosePluginsCtx).find((plugin) => plugin.props.clipboardTextSerializer)
    const serialize = prev.clipboardTextSerializer ?? stock?.props.clipboardTextSerializer?.bind(stock)
    if (!serialize) return prev
    const html = prev.clipboardSerializer ?? DOMSerializer.fromSchema(ctx.get(schemaCtx))
    return {
      ...prev,
      clipboardSerializer: new DOMSerializer({
        ...html.nodes,
        paragraph: (node) => {
          const paragraph = html.serializeNode(node) as HTMLElement
          paragraph.style.marginTop = '0'
          paragraph.style.marginBottom = '0'
          if (node.content.size === 0) paragraph.appendChild(document.createElement('br'))
          return paragraph
        },
      }, html.marks),
      clipboardTextSerializer: (slice, view) => {
        const text = serialize(slice, view)
        if (!text.includes('<br />')) return text
        let hasEmptyParagraph = false
        slice.content.descendants((node) => {
          if (node.type.name === 'paragraph' && node.content.size === 0) hasEmptyParagraph = true
        })
        // A pure selection of `<br />` inside code is literal text, not a generated spacer.
        return hasEmptyParagraph ? withoutSpacers(text, ctx.get(remarkCtx).parse(text)) : text
      },
    }
  })
  return new Plugin({ key: new PluginKey('mdapp-clipboard-copy-out') })
})
