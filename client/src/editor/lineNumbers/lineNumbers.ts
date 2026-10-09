import type { Crepe } from '../crepe'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { BlockLines } from './blockLines'
import { CODE_LINE_ATTR, syncCodeLines } from './codeLines'

/** What the host sends: the file's blocks. With no `ends`, every block is one line. */
export type ShownLines = Omit<BlockLines, 'ends'> & Partial<Pick<BlockLines, 'ends'>>

const pluginKey = new PluginKey<DecorationSet>('mdapp-line-numbers')
const CONTAINERS = new Set(['bullet_list', 'ordered_list', 'list_item', 'blockquote'])
const KIND: Record<string, string> = { paragraph: 'p', heading: 'h', code_block: 'c', hr: 'r', table: 't' }
/** The file's two kinds of code block, both the page's `code_block`: the fence lines above the first code line. */
const FENCE: Record<string, number> = { c: 1, i: 0 }

/**
 * Pairs the page's leaf blocks with the file's, in order. No number beats a wrong one, so the
 * pairing has two stops. At the first pair whose kinds disagree the numbers end, and the ones
 * before it stay. When every pair agreed and one side still has blocks, the two sides count
 * differently somewhere above, and no number shows at all. The empty paragraph Crepe keeps at the
 * end of the page is not such a block.
 *
 * A block gets its start as `data-line` and, when it ends on a later line, its end as
 * `data-line-end` (D7). A code block also gets the file line of its first code line (D8), but only
 * when the page holds as many code lines as the file has inside the block. An empty block, a fence
 * that is never closed, and indented code that the load-time rules gave a blank line do not, and
 * keep their own 1, 2, 3.
 */
const build = (doc: ProseNode, blocks: ShownLines): DecorationSet => {
  const decorations: Decoration[] = []
  let index = 0
  let disagreed = false
  let pageHasMore = false
  doc.descendants((node, pos) => {
    if (disagreed) return false
    if (CONTAINERS.has(node.type.name)) return true
    const kind = KIND[node.type.name]
    // `undefined` past the file's last block.
    const fileKind: string | undefined = blocks.kinds[index]
    const fence: number | undefined = FENCE[fileKind]
    if (kind === undefined || (fileKind !== undefined && kind !== (fence === undefined ? fileKind : 'c'))) disagreed = true
    else if (fileKind === undefined) pageHasMore ||= kind !== 'p' || node.content.size > 0
    else {
      const line = blocks.lines[index]
      const end = blocks.ends?.[index] ?? line
      const attrs: Record<string, string> = { 'data-line': String(line) }
      if (end > line) attrs['data-line-end'] = String(end)
      if (fence !== undefined && node.textContent.split('\n').length === end - line + 1 - 2 * fence) attrs[CODE_LINE_ATTR] = String(line + fence)
      decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs))
      index++
    }
    return false
  })
  if (!disagreed && (pageHasMore || index < blocks.lines.length)) return DecorationSet.empty
  return DecorationSet.create(doc, decorations)
}

/**
 * Line numbers (YAZ-2643): view state only, like folding. The host sends the file's block lines
 * (or null for "off") in a metadata-only transaction; between two sends the set only rides the
 * position mapping, so typing never rebuilds it.
 */
export const lineNumbers = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: pluginKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => {
          const blocks = tr.getMeta(pluginKey) as ShownLines | null | undefined
          if (blocks === undefined) return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
          return blocks === null ? DecorationSet.empty : build(tr.doc, blocks)
        },
      },
      props: { decorations: (state) => pluginKey.getState(state) },
    }),
)

/**
 * Sends the file's blocks to the plugin, or null for "off". Then each code block that has a
 * CodeMirror now takes its inner lines from what the plugin just decided for it (`codeLines.ts`).
 */
export const showLineNumbers = (crepe: Crepe, blocks: ShownLines | null): void =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setMeta(pluginKey, blocks).setMeta('addToHistory', false))
    for (const block of view.dom.querySelectorAll<HTMLElement>('.milkdown-code-block')) {
      const cm = CodeMirrorView.findFromDOM(block)
      if (cm !== null) syncCodeLines(cm)
    }
  })

let worker: Worker | null = null
let lastId = 0
const waiting = new Map<number, { resolve: (blocks: BlockLines) => void; reject: (reason: Error) => void }>()

/**
 * ONE worker per window, started on the first use; a page that never turns numbers on never loads it.
 * A worker that fails (its chunk does not load, a parse throws) rejects every request that waits
 * on it and is dropped, so the next request starts a new one.
 */
export const requestBlockLines = (text: string): Promise<BlockLines> =>
  new Promise((resolve, reject) => {
    if (worker === null) {
      worker = new Worker(new URL('./lineNumbers.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<BlockLines & { id: number }>) => {
        waiting.get(event.data.id)?.resolve(event.data)
        waiting.delete(event.data.id)
      }
      worker.onerror = worker.onmessageerror = () => {
        const failed = [...waiting.values()]
        waiting.clear()
        worker?.terminate()
        worker = null
        for (const request of failed) request.reject(new Error('the line-number worker failed'))
      }
    }
    waiting.set(++lastId, { resolve, reject })
    worker.postMessage({ id: lastId, text })
  })
