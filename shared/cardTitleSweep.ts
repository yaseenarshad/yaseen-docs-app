/**
 * THE ONE-TIME MOVE OF CARD TITLES ONTO THEIR CARD LINES (YAZ-5308, decision D: "a card's facts always live in its card
 * line"). Before D a card in a page had its title as its first line (YAZ-5030), and a card file had it in its `title`
 * property (YAZ-5044). This module is the move, and nothing else reads a title the old way: the index's sweep runs it
 * one time for each vault (`desktop/src/main/vaultIndex/idSweep.ts`), and then no card's text is ever read as a title.
 *
 *  - A card file's `title` property goes onto its card's line, and leaves its properties.
 *  - A card in a page with no `title` on its line: its first line goes onto its line as its title, with the blank lines
 *    after it, when that line is plain text and the front has more text below it. A first line that is not plain text
 *    (a hidden word, code, a link, a sound, a picture, a board) is the question, and so is a first line that is the whole front
 *    (`Which river runs through Paris?` / `---` / `The Seine`): it stays, and the card has no title.
 *
 * Everything else stays byte for byte: the fences, the rest of the text, every other part of the card line, the other
 * properties, and the file's own line end (YAZ-5146). Pure: no DOM, no Node.
 */
import { isCardFileContent } from './cardFileFormat'
import { cardTitleOf, formatCardLine, findCards, withCardTitle } from './cardLine'
import { cardSides, hiddenCount, markHidden } from './cardText'
import { lineKinds } from './fences'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { inLineEnds } from './lineEnds'
import { TITLE_KEY, titleOf } from './pageName'

/** A side break: `---` alone on its line. */
const SIDE_BREAK_RE = /^[ \t]*---[ \t]*$/

/** One line of Markdown as plain text: the words a title keeps of it. */
function plainLine(line: string): string {
  return markHidden(line, (word) => word)
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/, '') // heading, quote, list, task
    .replace(/(`+)(.*?)\1/g, '$2') // code span
    .replace(/(\*\*|__|~~|==)(.*?)\1/g, '$2') // bold, strike, highlight
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2') // italic
    .replace(/<[^>]+>/g, '') // HTML tags
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The title a card's text gave before D, and its text without it: `title` '' when the first line stays (see the top of
 * this file). `text` is the text with `\n` alone.
 */
export function firstLineTitle(text: string): { title: string; text: string } {
  const lines = text.split('\n')
  const kinds = lineKinds(lines)
  const at = lines.findIndex((line) => line.trim() !== '')
  const none = { title: '', text }
  if (at === -1 || kinds[at] !== 'text' || SIDE_BREAK_RE.test(lines[at])) return none
  const line = lines[at]
  // A hidden word, an embed or a picture (`![[tone.mp3]]`, `![alt](src)`), a link: the question, not a title (a title is
  // plain text, and the link would be lost).
  if (hiddenCount(line) > 0 || line.includes('![') || line.includes('[[') || line.includes('](')) return none
  const title = plainLine(line)
  if (title === '') return none
  let end = at + 1
  while (end < lines.length && lines[end].trim() === '') end++
  const rest = [...lines.slice(0, at), ...lines.slice(end)].join('\n')
  // The whole front is that line: it is the question.
  if (cardSides(rest)[0].trim() === '') return none
  return { title, text: rest }
}

/** The file `content` with its cards' titles on their card lines, or null when nothing moves. */
export function cardTitlesMoved(content: string): string | null {
  const moved = inLineEnds(content, (file) => {
    const { frontmatter, body } = splitFrontmatter(file)
    const cardFile = isCardFileContent(file)
    const own = cardFile ? titleOf(parseFrontmatter(frontmatter).properties, '') : ''
    const cards = findCards(body)
    const lines = body.split('\n')
    // Back to front, so each card's line numbers stay right while the ones after it change.
    for (let n = cards.length - 1; n >= 0; n--) {
      const card = cards[n]
      if (cardTitleOf(card.line) !== '') continue
      const out = cardFile && n === 0 && own !== '' ? { title: own, text: card.text } : firstLineTitle(card.text)
      if (out.title === '') continue
      const line = formatCardLine(withCardTitle(card.line, out.title))!
      const text = out.text === card.text ? lines.slice(card.open + 1, card.close) : out.text.split('\n').map((l) => (l === '' ? '' : card.indent + l))
      lines.splice(card.open + 1, (card.lineAt ?? card.close) - card.open, ...text, lines[card.close], card.indent + line)
    }
    let next = frontmatter + lines.join('\n')
    if (cardFile && own !== '') next = setFrontmatterProperty(next, TITLE_KEY, undefined)
    return next
  })
  return moved === content ? null : moved
}
