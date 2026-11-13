/**
 * Finding board embeds in the text (YAZ-4827): the one scan the host (`boardEmbed.ts`), the caret (`idLinkCaret.ts`),
 * ⌘F (`findInPage.ts`) and the fold (`listNodes.ts`) share, so they agree on what an embed is. No state; the host's
 * plugin key lives here so ⌘F can ask for it without importing the host.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { PluginKey, type EditorState, type Selection } from '@milkdown/kit/prose/state'
import type { DecorationSet } from '@milkdown/kit/prose/view'
import type { CardLink } from '@shared/cardLinks'
import { optionsPipe, splitEmbed } from '@shared/embedOptions'
import { WIKILINK_RE, eachPlainRun } from '../wikilink/wikilinkPlugin'
import { boardEmbedTarget, isBoardSrc, type BoardCheck } from './boardEmbedText'

/** One board embed of a textblock. */
export interface BoardEmbedMatch {
  from: number
  to: number
  inner: string
  target: string
  /** The options text (after the last `|`, when it parses as options; an alias before it is kept), or null. */
  options: string | null
  /** The doc position of the `|` before the options, or null: a write replaces from there, else adds before `]]`. */
  optionsAt: number | null
}

/**
 * The board embeds of one textblock at `pos`, in order (code is never one). `isBoard` is the host's word on an id link
 * (`boardCheckOf`, YAZ-4920); without it an id embed is no board.
 */
export function boardEmbedsIn(block: ProseNode, pos: number, isBoard?: BoardCheck): BoardEmbedMatch[] {
  if (block.type.spec.code === true || !block.textContent.includes('![[')) return []
  const found: BoardEmbedMatch[] = []
  eachPlainRun(block, pos + 1, (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] !== '!') continue
      const target = boardEmbedTarget(m[2], isBoard)
      if (target === null) continue
      const pipe = optionsPipe(m[2])
      const from = runPos + m.index
      found.push({ from, to: from + m[0].length, inner: m[2], target, options: splitEmbed(m[2]).options, optionsAt: pipe < 0 ? null : from + 3 + pipe })
    }
  })
  return found
}

/** The board embed that starts at `pos` (`at: 'start'`) or holds it (`at: 'inside'`, edges excluded), or null. */
export function boardEmbedAt(doc: ProseNode, pos: number, at: 'start' | 'inside' | 'any' = 'any', isBoard?: BoardCheck): BoardEmbedMatch | null {
  if (pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(pos)
  if (!$pos.parent.isTextblock) return null
  return boardEmbedsIn($pos.parent, $pos.before(), isBoard).find((m) => (at === 'start' ? m.from === pos : at === 'inside' ? m.from < pos && pos < m.to : m.from <= pos && pos <= m.to)) ?? null
}

/** The selection opens the embed (raw text): it reaches inside it without covering it whole. */
export function embedRevealed(sel: Selection, from: number, to: number): boolean {
  return sel.from < to && sel.to > from && !(sel.from <= from && sel.to >= to)
}

/** The host's plugin key (`boardEmbed.ts`): ⌘F asks whether the host is there before it leaves an embed's text out. */
export const boardEmbedKey = new PluginKey<DecorationSet>('mdapp-board-embed')

/** The host's board check (YAZ-4920), on its plugin's spec, or undefined without the host: an id link's kind. */
export const boardCheckOf = (state: EditorState): BoardCheck | undefined => (boardEmbedKey.get(state)?.spec as { isBoard?: BoardCheck } | undefined)?.isBoard

/**
 * What the host knows of cards (YAZ-5037), on its plugin's spec: the card a link or an id embed names (by its ID, or a
 * card file's link), and an ID it draws as "Missing card". Its board check says yes to both; these tell them apart.
 */
export interface CardCheck {
  cardOf: (target: string) => CardLink | null
  isMissing: (target: string) => boolean
}

/** The host's card check, or undefined: no host, or no card embeds in this editor (the card editor, YAZ-5026). */
export const cardCheckOf = (state: EditorState): CardCheck | undefined => (boardEmbedKey.get(state)?.spec as { cards?: CardCheck } | undefined)?.cards

/**
 * The paragraph at `pos` is one board embed and nothing else (YAZ-4907: a line goes beside it, as beside a code block or
 * a table): a board embed over its whole text (the host plugin there, `boardEmbed.ts`), or one board image node
 * (`imageView.ts`, a board of another vault). The 6-dot "Add line above / below" and Enter on a selected embed ask it
 * (`turnIntoRows.ts`, `addLineBeside.ts`).
 */
export function embedOnlyParagraph(state: EditorState, pos: number): boolean {
  const paragraph = state.doc.nodeAt(pos)
  if (paragraph?.type.name !== 'paragraph' || paragraph.childCount !== 1) return false
  const only = paragraph.firstChild!
  if (only.type.name === 'image') return isBoardSrc(only.attrs.src as string)
  if (boardEmbedKey.getState(state) === undefined) return false
  const embed = boardEmbedsIn(paragraph, pos, boardCheckOf(state))[0]
  return embed !== undefined && embed.from === pos + 1 && embed.to === pos + 1 + paragraph.content.size
}
