/**
 * The card's text cut into its sides for the card editor (YAZ-5026), and put back together. Pure: no editor, no DOM.
 *
 * The sides are cut BEFORE the editor reads the text, by the one side rule (`shared/cardText.ts`: `---` alone on a line,
 * outside code, `lineKinds`). So `---` never reaches the Markdown reader, where `Question\n---\nAnswer` is a heading.
 *
 * Each side keeps its own lines byte for byte, its blank lines around it too, and each break keeps its own line (` ---`
 * with its spaces). `joinCardParts(splitCardText(text))` is `text`. A side the editor did not change is written back
 * from these lines; a changed side is the editor's Markdown inside the side's own blank lines (`sideWithEdges`).
 */
import { lineKinds } from '@shared/fences'

/** A side break: `---` alone on its line (spaces around it allowed), as `cardSides` reads it. */
const SIDE_BREAK_RE = /^[ \t]*---[ \t]*$/

/** A card's text as its sides (each its lines) and the break lines between them: `breaks.length === sides.length - 1`. */
export interface CardParts {
  sides: string[][]
  breaks: string[]
}

/** The text in sides, every byte kept. A card with no break has one side; an empty card has one side with one empty line. */
export function splitCardText(text: string): CardParts {
  const lines = text.split('\n')
  const kinds = lineKinds(lines)
  const parts: CardParts = { sides: [[]], breaks: [] }
  lines.forEach((line, i) => {
    if (kinds[i] === 'text' && SIDE_BREAK_RE.test(line)) {
      parts.breaks.push(line)
      parts.sides.push([])
    } else parts.sides[parts.sides.length - 1].push(line)
  })
  return parts
}

/** The text of `parts`: each side's lines, a break line between two sides. */
export function joinCardParts(parts: CardParts): string {
  const lines: string[] = []
  parts.sides.forEach((side, i) => {
    if (i > 0) lines.push(parts.breaks[i - 1] ?? '---')
    lines.push(...side)
  })
  return lines.join('\n')
}

/** The Markdown of a side for the editor: its lines without the blank lines around them. */
export const sideMarkdown = (side: readonly string[]): string => side.slice(blankLead(side), side.length - blankTrail(side)).join('\n')

const blank = (line: string) => line.trim() === ''
const blankLead = (side: readonly string[]): number => {
  let n = 0
  while (n < side.length && blank(side[n])) n++
  return n
}
const blankTrail = (side: readonly string[]): number => {
  if (blankLead(side) === side.length) return 0
  let n = 0
  while (n < side.length && blank(side[side.length - 1 - n])) n++
  return n
}

/**
 * A changed side's lines: the editor's Markdown (`markdown`, no blank line at either end) inside the blank lines the
 * side had (`was`; a new side has none), so a changed side moves no line around it.
 */
export function sideWithEdges(markdown: string, was: readonly string[] | undefined): string[] {
  const body = markdown === '' ? [] : markdown.split('\n')
  if (was === undefined) return body
  const lead = blankLead(was)
  // A side of blank lines only (an empty card): the new text takes its place.
  if (lead === was.length) return body.length > 0 ? body : [...was]
  const trail = blankTrail(was)
  return [...was.slice(0, lead), ...body, ...was.slice(was.length - trail)]
}
