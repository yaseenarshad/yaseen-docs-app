/**
 * `base` code blocks rendered inline (6B, GRO-2146): a fenced block with `language === 'base'`
 * renders `<BaseView>` over its own YAML instead of the code editor. Crepe's CodeMirror block is
 * a per-node-TYPE view (`nodeViews` is keyed by node name, no per-language hook that can host
 * live DOM — `renderPreview` sanitises to innerHTML, killing React), so this is a `$view`
 * replacement for `code_block` registered AFTER the Crepe features: `Object.fromEntries` in the
 * editor-view bootstrap makes the LAST entry win. For `language === 'base'` the node view is a
 * bare `div.base-code-block` slot (slot store + CrepeHost portal, exactly 6A's pattern); for every
 * other language it delegates to the stock constructor found in `nodeViewCtx`, so those blocks
 * keep Crepe's CodeMirror block exactly as today.
 *
 * The block stays ordinary markdown: no schema/serializer change — the node view only reads
 * `node.textContent` and `commit(text)` replaces the node's text through a normal transaction,
 * so edits flow markdownUpdated → autosave and the file on disk is the exact code block text.
 *
 * Remount avoidance: one slot per node-view instance. ProseMirror keeps the node view across
 * unrelated edits (`update` returns true), text changes only swap the slot's `text` (same key,
 * same DOM), so typing elsewhere or editing the YAML never remounts the portal.
 */
import { nodeViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { $view } from '@milkdown/kit/utils'

export const BASE_CODE_BLOCK_CLASS = 'base-code-block'

/** One live `base` block: the slot DOM the node view owns and React portals into. */
export interface BaseCodeBlockSlot {
  key: string
  /** The block's exact text (the YAML between the fences). */
  text: string
  dom: HTMLElement
  /** Replace the block's text through the normal ProseMirror path (→ markdownUpdated → autosave). */
  commit(text: string): void
}

export interface BaseCodeBlockSlotStore {
  list(): readonly BaseCodeBlockSlot[]
  /** Wakes on every slot change (block added / removed / text changed). */
  subscribe(listener: () => void): () => void
  /** Node-view side: add a slot; returns its key. */
  add(slot: Omit<BaseCodeBlockSlot, 'key'>): string
  /** Node-view side: the block's text changed (external edit, undo, …). */
  setText(key: string, text: string): void
  /** Node-view side: the node view was destroyed. */
  remove(key: string): void
}

export function createBaseCodeBlockSlotStore(): BaseCodeBlockSlotStore {
  let slots: BaseCodeBlockSlot[] = []
  let nextKey = 0
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())
  return {
    list: () => slots,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    add(slot) {
      const key = `base-code:${nextKey++}`
      slots = [...slots, { ...slot, key }]
      notify()
      return key
    },
    setText(key, text) {
      const i = slots.findIndex((s) => s.key === key)
      if (i === -1 || slots[i].text === text) return
      slots = slots.map((s, j) => (j === i ? { ...s, text } : s))
      notify()
    },
    remove(key) {
      const next = slots.filter((s) => s.key !== key)
      if (next.length === slots.length) return
      slots = next
      notify()
    },
  }
}

class BaseCodeBlockNodeView implements NodeView {
  dom: HTMLElement
  private readonly key: string

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly slotStore: BaseCodeBlockSlotStore,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = BASE_CODE_BLOCK_CLASS
    this.dom.contentEditable = 'false'
    this.key = slotStore.add({ text: node.textContent, dom: this.dom, commit: this.commit })
  }

  private commit = (text: string): void => {
    const pos = this.getPos()
    if (pos === undefined) return
    const { state } = this.view
    const from = pos + 1
    const to = pos + this.node.nodeSize - 1
    const tr = text.length > 0 ? state.tr.replaceWith(from, to, state.schema.text(text)) : state.tr.delete(from, to)
    this.view.dispatch(tr)
  }

  update(node: ProseNode): boolean {
    // A language change away from `base` must rebuild the node view (back to CodeMirror).
    if (node.type !== this.node.type || node.attrs.language !== 'base') return false
    this.node = node
    this.slotStore.setText(this.key, node.textContent)
    return true
  }

  /** React owns everything inside the slot: events stay out of ProseMirror, mutations out of its parser. */
  stopEvent(): boolean {
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.slotStore.remove(this.key)
  }
}

export function createBaseCodeBlock(slotStore: BaseCodeBlockSlotStore) {
  return $view(codeBlockSchema.node, (ctx): NodeViewConstructor => {
    const wrapped: NodeViewConstructor = (node, view, getPos, decorations, innerDecorations) => {
      if (node.attrs.language === 'base') return new BaseCodeBlockNodeView(node, view, getPos, slotStore)
      // Delegate every other language to the stock (Crepe CodeMirror) constructor. Both entries
      // share the id 'code_block'; ours is `wrapped`, so the other one is Crepe's.
      const stock = ctx.get(nodeViewCtx).find(([id, v]) => id === 'code_block' && v !== wrapped)?.[1] as
        | NodeViewConstructor
        | undefined
      if (stock === undefined) {
        // CodeMirror is on the feature allowlist, so this cannot happen; keep a plain <pre> as a
        // non-crashing fallback rather than throwing inside prosemirror-view.
        const dom = document.createElement('pre')
        const contentDOM = document.createElement('code')
        dom.appendChild(contentDOM)
        return { dom, contentDOM }
      }
      const nodeView = stock(node, view, getPos, decorations, innerDecorations)
      // Switching a stock block's language TO `base` must rebuild the node view too.
      const update = nodeView.update?.bind(nodeView)
      if (update) {
        nodeView.update = (n, decos, inner) => (n.attrs.language === 'base' ? false : update(n, decos, inner))
      }
      return nodeView
    }
    return wrapped
  })
}
