/**
 * A card's text (YAZ-4959 D10, D19, idea 3), Mochi's notation: `---` alone on a line splits the sides, `{{word}}`
 * hides a word. `{{1::word}}` reads as `{{word}}`: there are no cloze groups, and all hidden words on a card are ONE
 * review. The text is the card's raw Markdown between its fences (`cardLine.ts` `findCards`). Code in the card — a
 * code block, a code span — is literal: a `---` there splits nothing and a `{{x}}` there hides nothing (the one fence
 * walk, `fences.ts`). Pure: no DOM.
 */
import { lineKinds, maskCode } from './fences'
import { withLf } from './lineEnds'

/** A side break: `---` alone on its line (spaces around it allowed, and the `\r` of a Windows line end, YAZ-5146). */
const SIDE_BREAK_RE = /^[ \t]*---[ \t]*\r?$/
/** A hidden word: `{{word}}`, or Mochi's and Anki's numbered form `{{1::word}}` / `{{c1::word}}`, read as `{{word}}`. */
const HIDDEN_RE = /\{\{(?:c?\d+::)?([\s\S]*?)\}\}/g

/**
 * The sides of a card, in order, each without the blank lines around it. A card with no break has one side. Each side
 * has `\n` alone, also from a text that still holds a Windows line end's `\r` (the editor's, YAZ-5146).
 */
export function cardSides(text: string): string[] {
  const sides: string[][] = [[]]
  const lines = withLf(text).split('\n')
  const kinds = lineKinds(lines)
  lines.forEach((line, i) => {
    if (kinds[i] === 'text' && SIDE_BREAK_RE.test(line)) sides.push([])
    else sides[sides.length - 1].push(line)
  })
  return sides.map((side) => side.join('\n').replace(/^\s*\n/, '').replace(/\n\s*$/, ''))
}

/** The hidden words of `text` outside its code, in order: where each one stands, how long it is, and its word. */
function hiddenWords(text: string): { index: number; length: number; word: string }[] {
  if (!text.includes('{{')) return []
  return [...maskCode(text).matchAll(HIDDEN_RE)].map((m) => ({ index: m.index, length: m[0].length, word: m[1] }))
}

/** A piece of a side: plain Markdown, or a hidden word. */
export type CardPiece = { kind: 'text'; text: string } | { kind: 'hidden'; text: string }

/** A side as its pieces, in order: what the Inbox steps through one hidden word at a time (D18). */
export function cardPieces(side: string): CardPiece[] {
  const pieces: CardPiece[] = []
  let from = 0
  for (const m of hiddenWords(side)) {
    if (m.index > from) pieces.push({ kind: 'text', text: side.slice(from, m.index) })
    pieces.push({ kind: 'hidden', text: m.word })
    from = m.index + m.length
  }
  if (from < side.length) pieces.push({ kind: 'text', text: side.slice(from) })
  return pieces
}

/**
 * `text` with each hidden word put through `mark(word, n)`: `n` counts the hidden words in page order, from `from`. The
 * same words `cardPieces` finds, so the card render (YAZ-4961) and the Inbox's steps (D18) count alike.
 */
export function markHidden(text: string, mark: (word: string, n: number) => string, from = 0): string {
  let n = from
  let out = ''
  let at = 0
  for (const m of hiddenWords(text)) {
    out += text.slice(at, m.index) + mark(m.word, n++)
    at = m.index + m.length
  }
  return out + text.slice(at)
}

/** How many hidden words a side holds. */
export const hiddenCount = (side: string): number => cardPieces(side).filter((p) => p.kind === 'hidden').length

/** The text with every hidden word shown as the word: `{{1::Paris}}` → `Paris`. */
const showHidden = (text: string): string => markHidden(text, (word) => word)

/**
 * The card's title (idea 3): the first line of the first side that has text, as plain text — Markdown marks, link
 * brackets and hidden-word braces taken off. '' for an empty card.
 */
export function cardTitle(text: string): string {
  const first = cardSides(text)[0]
  for (const raw of first.split('\n')) {
    const plain = plainLine(raw)
    if (plain !== '') return plain
  }
  return ''
}

/**
 * The card's text without its title line (YAZ-5030, "Title on the front: Hide"): the line `cardTitle` reads, and the
 * blank lines right after it, taken out, so the Inbox draws no title on the front and its hidden words are no Space
 * steps. A card with no title is its text unchanged.
 */
export function cardWithoutTitle(text: string): string {
  const lines = text.split('\n')
  const kinds = lineKinds(lines)
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] === 'text' && SIDE_BREAK_RE.test(lines[i])) return text
    if (plainLine(lines[i]) === '') continue
    let end = i + 1
    while (end < lines.length && lines[end].trim() === '') end++
    return [...lines.slice(0, i), ...lines.slice(end)].join('\n')
  }
  return text
}

/**
 * A card file's card with its `title` back as its first line (YAZ-5044): "Put back into this page" writes it, and review
 * reads it so, so "Title on the front: Show / Hide" is one rule for both kinds. A blank line sets the title off from a
 * front that has text; a card whose text starts with its side break takes the title right above it.
 */
export function cardWithTitle(title: string, text: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (clean === '') return text
  const body = text.replace(/^\s*\n/, '')
  if (body.trim() === '') return clean
  return SIDE_BREAK_RE.test(body.split('\n')[0]) ? `${clean}\n${body}` : `${clean}\n\n${body}`
}

/** One line of Markdown as plain text. */
function plainLine(line: string): string {
  return showHidden(line)
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/, '') // heading, quote, list, task
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link
    .replace(/!?\[\[([^[\]|]*)\|([^[\]]*)\]\]/g, '$2') // [[page|words]]
    .replace(/!?\[\[([^[\]]*)\]\]/g, '$1') // [[page]]
    .replace(/(`+)(.*?)\1/g, '$2') // code span
    .replace(/(\*\*|__|~~|==)(.*?)\1/g, '$2') // bold, strike, highlight
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2') // italic
    .replace(/<[^>]+>/g, '') // HTML tags
    .replace(/\s+/g, ' ')
    .trim()
}
