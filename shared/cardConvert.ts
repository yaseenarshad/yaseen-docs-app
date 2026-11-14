/**
 * THE CONVERT ACTIONS (YAZ-5037 phase 5), as pure changes of a file's bytes: a card between a page and a card file, a
 * card file and a page, and the fixes of a card file that is not valid. EVERY ONE MOVES A CARD BLOCK AND ITS CARD LINE
 * BYTE FOR BYTE (`unindentBlock`, `indentBlock`, `cardFileWithBlock`): the ID, the reviews and every `[[GEO-140]]`
 * link stay. The writes (one compare-and-set for each file) are `client/src/review/cardConvert.ts`'s. Pure: no DOM, no Node.
 *
 * THE TITLE SWAPS PLACES (YAZ-5044, decision A): a card in a page has its title as its first line; a card file has it
 * in `title`. A card that becomes a card file gives its first line to `title` (`cardFileTitleMoved`); a card file's card
 * that goes back into a page takes `title` back as its first line (`cardWithTitle`). The title is plain text there.
 *
 *  - Move to its own file (`moveCardOut`): the card file's bytes, and the page with `![[GEO-140]]` in the block's place,
 *    at its indent.
 *  - Put back into this page (`putCardBack`): the embed's line replaced by the block, at the embed's indent.
 *  - Turn into a page (`cardFileAsPage`): `kind: card` off; `title:` stays the page's title, and is the card's first line again.
 *  - Turn into a card file (`pageAsCardFile`): a page that holds exactly one card with an ID and no other text takes
 *    `kind: card`, its `title:` goes to `aliases` (so `[[Old title]]` still resolves), its `id:` stays (pick 6), and the
 *    card's first line is its new `title`.
 *  - The notice's fixes: Split (`splitCardFile`), Move into the card (`moveTextIntoCard`), Make a card from the text
 *    (`cardFromText`).
 */
import { cardFileName, cardFileShape, cardFileTitle, cardFileTitleMoved, cardFileWithBlock, CARD_KIND, CARD_KIND_KEY, hasTitleProperty, indentBlock, NEW_CARD_TEXT, unindentBlock } from './cardFileFormat'
import { CardNotFoundError, EMPTY_CARD_LINE, cardBlock, cardIdOf, changeCardText, findCards, type CardBlock } from './cardLine'
import { cardTitle, cardWithTitle } from './cardText'
import { lineKinds } from './fences'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { TITLE_KEY } from './noteName'

/** A card that leaves its page or its card file: the new card file's bytes, its name, its ID and its title. */
export interface CardFileOut {
  /** The new card file: `kind: card`, its `title` (the card's first line, taken out of it), and the block. */
  content: string
  /** `cardFileName(title, id)`. */
  name: string
  id: string
  title: string
}

/** The card at `index` when it holds `id`, else the first that holds it (`changeCard`'s choice); throws `CardNotFoundError`. */
function cardOf(cards: readonly CardBlock[], id: string, index?: number): CardBlock {
  const at = index !== undefined && cards[index] !== undefined && cardIdOf(cards[index].line) === id ? index : cards.findIndex((c) => cardIdOf(c.line) === id)
  if (at === -1) throw new CardNotFoundError(id)
  return cards[at]
}

/** The card file a card makes, from the lines it is in. A card with no ID is no card file yet (the sweep gives it one). */
function cardOut(lines: readonly string[], card: CardBlock): CardFileOut {
  const id = cardIdOf(card.line)
  if (id === null) throw new CardNotFoundError('(no ID yet)')
  const title = cardTitle(card.text)
  const block = cardFileWithBlock(unindentBlock(lines, card))
  return { content: cardFileTitleMoved(block) ?? block, name: cardFileName(title, id), id, title }
}

/** The embed a card leaves in its place: `![[GEO-140]]`. */
export const cardEmbedText = (id: string): string => `![[${id}]]`

/**
 * MOVE TO ITS OWN FILE: card `id` of the page `content` (the one at `index` when two hold it). `page` is the page with
 * the card's block and card line replaced by `![[GEO-140]]` at the block's indent; `card` the new card file. Throws
 * `CardNotFoundError` (no card holds `id`).
 */
export function moveCardOut(content: string, id: string, index?: number): { page: string; card: CardFileOut } {
  const { frontmatter, body } = splitFrontmatter(content)
  const lines = body.split('\n')
  const card = cardOf(findCards(body), id, index)
  const out = cardOut(lines, card)
  lines.splice(card.open, (card.lineAt ?? card.close) - card.open + 1, card.indent + cardEmbedText(out.id))
  return { page: frontmatter + lines.join('\n'), card: out }
}

/**
 * The line of the `nth` embed `![[inner]]` (0 first) that stands alone on its line in `body`, outside every code block
 * and card, or -1. `inner` is the embed's text between the brackets, as the page holds it.
 */
export function embedLine(body: string, inner: string, nth: number): number {
  const wanted = `![[${inner}]]`
  const lines = body.split('\n')
  const kinds = lineKinds(lines)
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'text' || lines[i].trim() !== wanted) continue
    if (seen++ === nth) return i
  }
  return -1
}

/**
 * PUT BACK INTO THIS PAGE: the page `page` with the `nth` lone embed `![[inner]]` replaced by card `id`'s block and card
 * line from the card file `cardFile`, at the embed's indent; the card file's `title` is the card's first line again.
 * Throws `CardNotFoundError` when the card file has no such card, an Error when the page holds no such embed (it changed since).
 */
export function putCardBack(page: string, inner: string, nth: number, cardFile: string, id: string): string {
  const held = splitFrontmatter(cardFile).body
  const cards = findCards(held)
  const card = cardOf(cards, id)
  const raw = unindentBlock(held.split('\n'), card)
  const block = card === cards[0] && hasTitleProperty(cardFile) ? changeCardText(raw, null, cardWithTitle(cardFileTitle(cardFile), card.text), 0) : raw
  const { frontmatter, body } = splitFrontmatter(page)
  const at = embedLine(body, inner, nth)
  if (at === -1) throw new Error('the embed is no longer on its own line in this page')
  const lines = body.split('\n')
  const indent = /^[ \t]*/.exec(lines[at])![0]
  lines[at] = indentBlock(block, indent)
  return frontmatter + lines.join('\n')
}

/**
 * TURN INTO A PAGE: the card file `content` without `kind: card`. Its `title:` stays the page's title (`cardFileTitle`;
 * none for a card with no title), and the card, now in a page, takes it back as its first line (`cardWithTitle`); its
 * card line stays byte for byte. The page's own ID and name come after (`retitle`).
 */
export function cardFileAsPage(content: string): { content: string; title: string } {
  const card = findCards(splitFrontmatter(content).body)[0]
  const title = cardFileTitle(content)
  const back = card !== undefined && hasTitleProperty(content) ? changeCardText(content, null, cardWithTitle(title, card.text), 0) : content
  const titled = title === '' ? back : setFrontmatterProperty(back, TITLE_KEY, title)
  return { content: setFrontmatterProperty(titled, CARD_KIND_KEY, undefined), title }
}

/**
 * Can the page `content` turn into a card file? Exactly one card, with its ID, and no other text but blank lines.
 * Cheap for a page with no card (`findCards` looks once).
 */
export function canBeCardFile(content: string): boolean {
  const shape = cardFileShape(splitFrontmatter(content).body)
  return shape.problem === 'ok' && cardIdOf(shape.cards[0].line) !== null
}

/**
 * TURN INTO A CARD FILE: the page `content` with `kind: card`, its `title:` moved to `aliases` (after the ones it has),
 * its `id:` kept (pick 6), and the card's first line moved into `title` (`cardFileTitleMoved`). `name`: the card file's
 * name, `cardFileName(card title, card ID)`. Null when the page cannot (`canBeCardFile`).
 */
export function pageAsCardFile(content: string): { content: string; name: string } | null {
  if (!canBeCardFile(content)) return null
  const card = findCards(splitFrontmatter(content).body)[0]
  const { properties } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  const raw = properties[TITLE_KEY]
  const title = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  let next = setFrontmatterProperty(content, CARD_KIND_KEY, CARD_KIND)
  if (raw !== undefined) {
    const held = properties.aliases
    const aliases: unknown[] = Array.isArray(held) ? [...held] : held === undefined || held === null || held === '' ? [] : [held]
    if (title !== '' && !aliases.includes(title)) aliases.push(title)
    next = setFrontmatterProperty(setFrontmatterProperty(next, TITLE_KEY, undefined), 'aliases', aliases.length === 0 ? undefined : aliases)
  }
  return { content: cardFileTitleMoved(next) ?? next, name: cardFileName(cardTitle(card.text), cardIdOf(card.line)!) }
}

/**
 * SPLIT INTO N CARD FILES: the card file `content` keeps its first card; each other card leaves (its block and card line,
 * and the blank line after it) for a new card file, byte for byte. Null when it holds one card or none, or when a card
 * that leaves has no ID yet (the sweep gives it one first).
 */
export function splitCardFile(content: string): { keep: string; cards: CardFileOut[] } | null {
  const { frontmatter, body } = splitFrontmatter(content)
  const cards = findCards(body)
  if (cards.length < 2 || cards.slice(1).some((c) => cardIdOf(c.line) === null)) return null
  const lines = body.split('\n')
  const out = cards.slice(1).map((c) => cardOut(lines, c))
  // Back to front, so each card's line numbers stay right.
  for (const card of cards.slice(1).reverse()) {
    const end = card.lineAt ?? card.close
    const blank = lines[card.open - 1]?.trim() === '' && lines[end + 1]?.trim() === '' ? 1 : 0
    lines.splice(card.open, end - card.open + 1 + blank)
  }
  return { keep: frontmatter + lines.join('\n'), cards: out }
}

/**
 * MOVE INTO THE CARD: the card file `content` with the text above its card at the start of the card's front and the
 * text below it at the end of its last side, each set off by a blank line. The card line stays byte for byte. Null
 * when there is no such text, or not exactly one card.
 */
export function moveTextIntoCard(content: string): string | null {
  const { frontmatter, body } = splitFrontmatter(content)
  const shape = cardFileShape(body)
  if (shape.problem !== 'outside') return null
  const card = shape.cards[0]
  const lines = body.split('\n')
  const only = frontmatter + lines.slice(card.open, (card.lineAt ?? card.close) + 1).join('\n') + '\n'
  const text = [shape.before, card.text.replace(/\n+$/, ''), shape.after].filter((t) => t !== '').join('\n\n')
  return changeCardText(only, cardIdOf(card.line), text, 0)
}

/**
 * MAKE A CARD FROM THE TEXT: the card file `content` with no card, its body now one card (no ID yet: the sweep gives it
 * one). A file with no `title` takes the text's first line as its title (`cardFileTitleMoved`); an empty body gives the
 * title "Title", as New card starts. Its properties stay. Null when it holds a card.
 */
export function cardFromText(content: string): string | null {
  const { frontmatter, body } = splitFrontmatter(content)
  const shape = cardFileShape(body)
  if (shape.problem !== 'none') return null
  const made = `${frontmatter}${cardBlock(shape.before === '' ? NEW_CARD_TEXT : shape.before, EMPTY_CARD_LINE)}\n`
  return cardFileTitleMoved(made) ?? made
}
