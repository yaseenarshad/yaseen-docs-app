/**
 * A card's text (YAZ-4959 D10, D19, idea 3), Mochi's notation: `---` alone on a line splits the sides, `{{word}}`
 * hides a word. `{{1::word}}` reads as `{{word}}`: there are no cloze groups, and all hidden words on a card are ONE
 * review. The text is the card's raw Markdown between its fences (`cardLine.ts` `findCards`). Code in the card — a
 * code block, a code span — is literal: a `---` there splits nothing and a `{{x}}` there hides nothing (the one fence
 * walk, `fences.ts`). The text is only the card's sides: its title is on its card line (YAZ-5308, `cardLine.ts`), and no
 * line of the text is ever read as a title. Pure: no DOM.
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
