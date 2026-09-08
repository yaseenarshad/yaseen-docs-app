import { editorViewOptionsCtx, prosePluginsCtx, remarkCtx } from '@milkdown/kit/core'
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

/** YAZ-1389: keep empty-paragraph save markers out of copy/cut text, without changing HTML or saves. */
export const clipboardCopyOut = $prose((ctx) => {
  ctx.update(editorViewOptionsCtx, (prev) => {
    const stock = ctx.get(prosePluginsCtx).find((plugin) => plugin.props.clipboardTextSerializer)
    const serialize = prev.clipboardTextSerializer ?? stock?.props.clipboardTextSerializer?.bind(stock)
    if (!serialize) return prev
    return {
      ...prev,
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
