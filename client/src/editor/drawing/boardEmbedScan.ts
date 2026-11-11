/**
 * Finding board embeds in the text (YAZ-4827): the one scan the host (`boardEmbed.ts`), the caret (`idLinkCaret.ts`),
 * ⌘F (`findInPage.ts`) and the fold (`listNodes.ts`) share, so they agree on what an embed is. No plugin, no state.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { PluginKey, type Selection } from '@milkdown/kit/prose/state'
import type { DecorationSet } from '@milkdown/kit/prose/view'
import { WIKILINK_RE, eachPlainRun } from '../wikilink/wikilinkPlugin'
import { boardEmbedTarget } from './boardEmbedText'

/** One board embed of a textblock. */
export interface BoardEmbedMatch {
  from: number
  to: number
  inner: string
  target: string
  /** The text after the first `|`, or null. */
  options: string | null
}

/** The board embeds of one textblock at `pos`, in order (code is never one). */
export function boardEmbedsIn(block: ProseNode, pos: number): BoardEmbedMatch[] {
  if (block.type.spec.code === true || !block.textContent.includes('![[')) return []
  const found: BoardEmbedMatch[] = []
  eachPlainRun(block, pos + 1, (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] !== '!') continue
      const target = boardEmbedTarget(m[2])
      if (target === null) continue
      const pipe = m[2].indexOf('|')
      const from = runPos + m.index
      found.push({ from, to: from + m[0].length, inner: m[2], target, options: pipe < 0 ? null : m[2].slice(pipe + 1) })
    }
  })
  return found
}

/** The board embed that starts at `pos` (`at: 'start'`) or holds it (`at: 'inside'`, edges excluded), or null. */
export function boardEmbedAt(doc: ProseNode, pos: number, at: 'start' | 'inside' | 'any' = 'any'): BoardEmbedMatch | null {
  if (pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(pos)
  if (!$pos.parent.isTextblock) return null
  return boardEmbedsIn($pos.parent, $pos.before()).find((m) => (at === 'start' ? m.from === pos : at === 'inside' ? m.from < pos && pos < m.to : m.from <= pos && pos <= m.to)) ?? null
}

/** The selection opens the embed (raw text): it reaches inside it without covering it whole. */
export function embedRevealed(sel: Selection, from: number, to: number): boolean {
  return sel.from < to && sel.to > from && !(sel.from <= from && sel.to >= to)
}


/** The host's plugin key (`boardEmbed.ts`): ⌘F asks whether the host is there before it leaves an embed's text out. */
export const boardEmbedKey = new PluginKey<DecorationSet>('mdapp-board-embed')
