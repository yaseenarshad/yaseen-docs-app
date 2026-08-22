/**
 * Base embeds in the editor (6A, GRO-2145): `![[X.base]]` / `![[X.base#View]]` stays plain text
 * in the document (Crepe parses it as text; `postProcessMarkdown` un-escapes it on save), and a
 * `$prose` plugin decorates the paragraph containing EXACTLY ONE base embed with a widget right
 * after the paragraph — a decoration, never a schema change, so round-trip stays byte-identical.
 *
 * React ownership stays clean via a registry: the plugin only creates bare `div.base-embed`
 * slots and keeps them in sync with the document; `CrepeHost` (Editor.tsx) subscribes and
 * portals `<BaseEmbed>` into each slot (resolution, loading and the read-only `<BaseView>` all
 * live on the React side).
 *
 * Remount avoidance: slots are keyed by `target#view:occurrence`. Every doc change rebuilds the
 * decoration set from the document, but `sync()` reuses the existing DOM node for an unchanged
 * key and the widget spec stays shallow-equal (module-level `stopEvent`, same `side`), so
 * prosemirror-view keeps the mounted widget — typing near an embed never remounts it.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export const BASE_EMBED_CLASS = 'base-embed'

/** `![[target.base]]` / `![[target.base#View]]` (optional `|alias` tolerated, Obsidian-style). */
const EMBED_RE = /!\[\[([^[\]#|]+\.base)(?:#([^[\]|]+))?(?:\|[^[\]]*)?\]\]/gi

/** One live embed slot: the widget DOM the plugin owns and React portals into. */
export interface BaseEmbedSlot {
  key: string
  target: string
  /** The `#View` part, or null for the base's first view. */
  viewName: string | null
  dom: HTMLElement
}

interface FoundEmbed {
  key: string
  /** Widget position: right after the paragraph carrying the embed. */
  pos: number
  target: string
  viewName: string | null
}

export interface BaseEmbedRegistry {
  list(): readonly BaseEmbedSlot[]
  /** Wakes on every slot set change (embed added / removed / retargeted). */
  subscribe(listener: () => void): () => void
  /** Plugin-side: reconcile the slots with the embeds found in the doc; returns key → DOM. */
  sync(found: readonly Omit<FoundEmbed, 'pos'>[]): ReadonlyMap<string, HTMLElement>
}

export function createBaseEmbedRegistry(): BaseEmbedRegistry {
  let slots: BaseEmbedSlot[] = []
  const listeners = new Set<() => void>()
  return {
    list: () => slots,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sync(found) {
      const prev = new Map(slots.map((s) => [s.key, s]))
      const next = found.map((e) => {
        const kept = prev.get(e.key)
        if (kept !== undefined) return kept
        const dom = document.createElement('div')
        dom.className = BASE_EMBED_CLASS
        dom.contentEditable = 'false'
        return { key: e.key, target: e.target, viewName: e.viewName, dom }
      })
      const changed = next.length !== slots.length || next.some((s, i) => s !== slots[i])
      if (changed) {
        slots = next
        listeners.forEach((l) => l())
      }
      return new Map(slots.map((s) => [s.key, s.dom]))
    },
  }
}

/** Paragraphs containing exactly one base embed, keyed `target#view:occurrence` (stable across unrelated edits). */
function findBaseEmbeds(doc: ProseNode): FoundEmbed[] {
  const found: FoundEmbed[] = []
  const seen = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true
    const matches = [...node.textContent.matchAll(EMBED_RE)]
    if (matches.length === 1) {
      const target = matches[0][1].trim()
      const viewName = matches[0][2]?.trim() || null
      const signature = `${target.toLowerCase()}#${viewName?.toLowerCase() ?? ''}`
      const occurrence = seen.get(signature) ?? 0
      seen.set(signature, occurrence + 1)
      found.push({ key: `${signature}:${occurrence}`, pos: pos + node.nodeSize, target, viewName })
    }
    return false
  })
  return found
}

const pluginKey = new PluginKey<DecorationSet>('mdapp-base-embed')

/** Same function object on every widget spec so decoration equality holds across rebuilds. */
const stopEvent = () => true

export function createBaseEmbed(registry: BaseEmbedRegistry) {
  const build = (doc: ProseNode): DecorationSet => {
    const found = findBaseEmbeds(doc)
    const doms = registry.sync(found)
    if (found.length === 0) return DecorationSet.empty
    return DecorationSet.create(
      doc,
      found.map((e) =>
        Decoration.widget(e.pos, doms.get(e.key) as HTMLElement, {
          key: e.key,
          side: -1,
          ignoreSelection: true,
          stopEvent,
        }),
      ),
    )
  }
  return $prose(
    () =>
      new Plugin({
        key: pluginKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, set) => (tr.docChanged ? build(tr.doc) : set),
        },
        props: {
          decorations: (state) => pluginKey.getState(state),
        },
        view: () => ({ destroy: () => void registry.sync([]) }),
      }),
  )
}
