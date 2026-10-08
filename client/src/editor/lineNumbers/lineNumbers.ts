import type { Crepe } from '../crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { BlockLines } from './blockLines'

const pluginKey = new PluginKey<DecorationSet>('mdapp-line-numbers')
const CONTAINERS = new Set(['bullet_list', 'ordered_list', 'list_item', 'blockquote'])
const KIND: Record<string, string> = { paragraph: 'p', heading: 'h', code_block: 'c', hr: 'r', table: 't' }

/**
 * Pairs the page's leaf blocks with the file's, in order. No number beats a wrong one, so the
 * pairing has two stops. At the first pair whose kinds disagree the numbers end, and the ones
 * before it stay. When every pair agreed and one side still has blocks, the two sides count
 * differently somewhere above, and no number shows at all. The empty paragraph Crepe keeps at the
 * end of the page is not such a block.
 */
const build = (doc: ProseNode, blocks: BlockLines): DecorationSet => {
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
    if (kind === undefined || (fileKind !== undefined && kind !== fileKind)) disagreed = true
    else if (fileKind === undefined) pageHasMore ||= kind !== 'p' || node.content.size > 0
    else decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-line': String(blocks.lines[index++]) }))
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
          const blocks = tr.getMeta(pluginKey) as BlockLines | null | undefined
          if (blocks === undefined) return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
          return blocks === null ? DecorationSet.empty : build(tr.doc, blocks)
        },
      },
      props: { decorations: (state) => pluginKey.getState(state) },
    }),
)

export const showLineNumbers = (crepe: Crepe, blocks: BlockLines | null): void =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setMeta(pluginKey, blocks).setMeta('addToHistory', false))
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
