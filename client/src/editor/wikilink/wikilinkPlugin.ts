/**
 * Wikilink rendering in the editor (Links A, GRO-2190): `[[target]]` stays PLAIN TEXT in the
 * document (Crepe parses it as text; `postProcessMarkdown` un-escapes it on save) and a `$prose`
 * plugin renders it Obsidian-live-preview style with INLINE DECORATIONS only — never a schema or
 * serializer change, so round-trip stays byte-identical (`roundtrip.test.ts`).
 *
 * Display (caret outside the match):
 *  - the `[[` / `]]` brackets get `wikilink__syntax` (CSS `display: none`),
 *  - `[[target|alias]]` hides `target|` and shows only the alias,
 *  - `[[target#heading]]` shows `target > heading` (the `#` is hidden; each post-`#` segment
 *    carries `wikilink__sub`, whose CSS `::before` draws the ` > ` separator),
 *  - visible segments get `wikilink` (accent), plus `wikilink--unresolved` (dimmed) when the
 *    resolve source cannot find the target. NO pointer cursor and NO click handlers here —
 *    Links C (click navigation) adds interaction on top of these decorations.
 *
 * Caret inside or immediately adjacent (selection overlapping the match, boundaries INCLUSIVE):
 * that match's decorations drop entirely — raw `[[syntax]]` is visible and editable. This is
 * also what makes arrow traversal work with `display: none` hiding: the caret can never sit
 * against hidden text, because by the time it reaches a match boundary the match is already raw.
 *
 * Exclusions: `![[…]]` embeds (base embeds are `baseEmbedPlugin.ts`'s; image embeds stay plain),
 * `code_block` nodes and inline-`code` marked text (mirrors the index's `stripCode`,
 * CONTRACTS "Property index").
 *
 * Resolution: the ONE resolver (`bases/engine.ts` `resolverFor`) reaches the plugin through a
 * `WikilinkResolveSource` — a mutable holder App owns. Index updates call `source.update(...)`,
 * which pokes every subscribed editor with a meta transaction: decorations recompute live, the
 * Crepe instance is never recreated and the document never changes.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Selection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import './wikilink.css'

export const WIKILINK_CLASS = 'wikilink'
export const WIKILINK_UNRESOLVED_CLASS = 'wikilink--unresolved'
export const WIKILINK_SYNTAX_CLASS = 'wikilink__syntax'
export const WIKILINK_SUB_CLASS = 'wikilink__sub'

/** Link target → resolved absolute path, or null when no note matches. */
export type ResolveLink = (target: string) => string | null

/** How the latest resolver reaches the plugin; see `createWikilinkResolveSource`. */
export interface WikilinkResolveSource {
  /** null until the vault index first loads — every link renders as resolved meanwhile. */
  readonly resolve: ResolveLink | null
  /** Wakes subscribed editors (decoration recompute) whenever `resolve` is swapped. */
  subscribe(listener: () => void): () => void
}

export interface MutableWikilinkResolveSource extends WikilinkResolveSource {
  /** Swap in a fresh resolver (index refetch) and notify every subscribed editor. */
  update(resolve: ResolveLink): void
}

export function createWikilinkResolveSource(): MutableWikilinkResolveSource {
  let current: ResolveLink | null = null
  const listeners = new Set<() => void>()
  return {
    get resolve() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(resolve) {
      current = resolve
      listeners.forEach((l) => l())
    },
  }
}

/** Non-embed wiki links; inner brackets are unrepresentable (same shape as the index's WIKILINK_RE). */
const WIKILINK_RE = /(!?)\[\[([^[\]]+)\]\]/g

const wikilinkKey = new PluginKey<DecorationSet>('mdapp-wikilink')

/**
 * Calls `cb` for every maximal run of plain text (consecutive text children WITHOUT the
 * inlineCode mark) in `block`. Adjacent text children are contiguous in document positions,
 * so `runPos + offset-in-run` addresses any character of the run.
 */
function eachPlainRun(block: ProseNode, base: number, cb: (text: string, runPos: number) => void): void {
  let text = ''
  let start = -1
  block.forEach((child, offset) => {
    if (child.isText && !child.marks.some((m) => m.type.name === 'inlineCode')) {
      if (start < 0) start = offset
      text += child.text ?? ''
      return
    }
    if (start >= 0) cb(text, base + start)
    text = ''
    start = -1
  })
  if (start >= 0) cb(text, base + start)
}

/** Push a hidden-syntax decoration (empty ranges are skipped). */
function hide(out: Decoration[], from: number, to: number): void {
  if (from < to) out.push(Decoration.inline(from, to, { class: WIKILINK_SYNTAX_CLASS }))
}

/** Decorations for one collapsed match: `[[inner]]` starting at `start`. */
function decorate(out: Decoration[], start: number, inner: string, resolve: ResolveLink | null): void {
  const target = inner.split('|')[0].split('#')[0].trim()
  // An empty target ([[#heading]]) is a same-file link: always resolved.
  const resolved = resolve === null || target === '' || resolve(target) !== null
  const cls = resolved ? WIKILINK_CLASS : `${WIKILINK_CLASS} ${WIKILINK_UNRESOLVED_CLASS}`
  const innerStart = start + 2
  const end = innerStart + inner.length + 2
  hide(out, start, innerStart) // [[
  const pipe = inner.indexOf('|')
  if (pipe >= 0) {
    hide(out, innerStart, innerStart + pipe + 1) // target(#heading)?| — the alias is the display
    if (pipe + 1 < inner.length) out.push(Decoration.inline(innerStart + pipe + 1, end - 2, { class: cls }))
  } else {
    // target, then ` > `-separated sub segments for each `#heading` / `#^block` part
    let at = innerStart
    let shown = 0
    const parts = inner.split('#')
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        hide(out, at, at + 1) // the #
        at += 1
      }
      const part = parts[i]
      if (part.length > 0) {
        out.push(Decoration.inline(at, at + part.length, { class: shown > 0 ? `${cls} ${WIKILINK_SUB_CLASS}` : cls }))
        shown++
      }
      at += part.length
    }
  }
  hide(out, end - 2, end) // ]]
}

/** True when the selection touches [from, to] with inclusive boundaries — the reveal rule. */
function touches(sel: Selection, from: number, to: number): boolean {
  return sel.from <= to && sel.to >= from
}

function build(state: EditorState, source: WikilinkResolveSource): DecorationSet {
  const decorations: Decoration[] = []
  const sel = state.selection
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') return false
    if (!node.isTextblock) return true
    eachPlainRun(node, pos + 1, (text, runPos) => {
      for (const m of text.matchAll(WIKILINK_RE)) {
        if (m[1] === '!') continue // embeds are someone else's (or nobody's) business
        const from = runPos + m.index
        const to = from + m[0].length
        if (touches(sel, from, to)) continue // caret inside/adjacent → raw, editable syntax
        decorate(decorations, from, m[2], source.resolve)
      }
    })
    return false
  })
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decorations)
}

export function createWikilink(source: WikilinkResolveSource) {
  return $prose(
    () =>
      new Plugin({
        key: wikilinkKey,
        state: {
          init: (_, state) => build(state, source),
          apply: (tr, set, _old, state) =>
            tr.docChanged || tr.selectionSet || tr.getMeta(wikilinkKey) !== undefined ? build(state, source) : set,
        },
        props: {
          decorations: (state) => wikilinkKey.getState(state),
        },
        view: (editorView) => {
          const unsubscribe = source.subscribe(() => {
            editorView.dispatch(editorView.state.tr.setMeta(wikilinkKey, 'resolver-updated'))
          })
          return { destroy: unsubscribe }
        },
      }),
  )
}
