/**
 * CARD FILES (YAZ-5037): a card that is its own file. A card file is a normal `.md` file whose properties hold
 * `kind: card` (the mark, `isCardKind`) and whose body is exactly ONE card: its ```` ```card ```` block and its card line,
 * with no other text but blank lines. The card's ID (on its card line) is the file's ID: the sweep gives a card file no
 * page `id:` (one already there stays, YAZ-5037 pick 6). ITS TITLE IS ITS `title` PROPERTY, as a page's is (YAZ-5044,
 * decision A): the card's text holds only its sides, never the title. A card INSIDE A PAGE keeps the 5030 rule (its
 * first line). The name is built from the title and the card's ID as a page's is (`noteFileName`, YAZ-2420 🔒 D3).
 * A card file from before A (no `title`, the title as the card's first line) is moved one time by the ID sweep
 * (`cardFileTitleMoved`, `shared/cardConvert.ts`); until then its title reads from that first line.
 *
 * The mark is the key `kind`, never `type` (pick 4): many people use `type:` for their own notes. Only the value `card`
 * (trimmed, any case) is the mark; any other `kind` value is an ordinary property, and the properties panel shows it.
 *
 * Named `cardFileFormat`, not `cardFile`: `client/src/review/cardFile.ts` is a card's reads and writes in its file.
 * Pure: no DOM, no Node.
 */
import { cardBlock, cardIdOf, findCards, type CardBlock, type CardLine } from './cardLine'
import { buildFrontmatter, parseFrontmatter, splitFrontmatter } from './frontmatter'
import { TITLE_KEY, noteFileName } from './noteName'

/** The property key that marks a card file. Hidden in the properties panel when it holds `card`. */
export const CARD_KIND_KEY = 'kind'
/** The value of `kind` that marks a card file. */
export const CARD_KIND = 'card'
/** The title a new card starts with, as `/card` starts (YAZ-5030). A card file titled this keeps its `<id>.md` name. */
export const NEW_CARD_TEXT = 'Title'

/** Is `value` the card file mark's value (`card`, trimmed, any letter case)? */
export const isCardKindValue = (value: unknown): boolean => typeof value === 'string' && value.trim().toLowerCase() === CARD_KIND

/** Do these properties mark a card file? */
export const isCardKind = (properties: Record<string, unknown>): boolean => isCardKindValue(properties[CARD_KIND_KEY])

/** Is the property `key: value` the card file mark (the panel hides exactly this row)? */
export const isCardMark = (key: string, value: unknown): boolean => key === CARD_KIND_KEY && isCardKindValue(value)

/** Does the Markdown file `content` hold the card file mark? Properties that do not parse mark nothing. */
export function isCardFileContent(content: string): boolean {
  const { frontmatter } = splitFrontmatter(content)
  if (frontmatter === '') return false
  const { properties, error } = parseFrontmatter(frontmatter)
  return error === undefined && isCardKind(properties)
}

/** What a card file's body holds (`cardFileShape`). */
export interface CardFileShape {
  /** Every card in the body, in order (`findCards`). */
  cards: CardBlock[]
  /** The body text outside every card and its card line, above the first card (trimmed; '' when none). */
  before: string
  /** The body text outside every card and its card line, below the first card (trimmed; '' when none). */
  after: string
  /**
   * `ok`: exactly one card and no other text. `many`: 2 or more cards (`before`/`after` are read around the first one
   * only). `outside`: one card, with text outside it. `none`: no card at all (`before` holds the whole body).
   */
  problem: 'ok' | 'many' | 'outside' | 'none'
}

/**
 * The shape check of a card file's body (`splitFrontmatter(content).body`): how many cards, and the text outside them.
 * The tab shows one notice for each problem (`many`, `outside`, `none`), and never turns the file into a page.
 */
export function cardFileShape(body: string): CardFileShape {
  const cards = findCards(body)
  const lines = body.split('\n')
  if (cards.length === 0) return { cards, before: body.trim(), after: '', problem: 'none' }
  const inCard = new Set<number>()
  for (const c of cards) for (let i = c.open; i <= (c.lineAt ?? c.close); i++) inCard.add(i)
  const first = cards[0]
  const end = first.lineAt ?? first.close
  const outside = (from: number, to: number): string =>
    lines
      .slice(from, to)
      .filter((_, i) => !inCard.has(from + i))
      .join('\n')
      .trim()
  const before = outside(0, first.open)
  const after = outside(end + 1, lines.length)
  const problem = cards.length > 1 ? 'many' : before !== '' || after !== '' ? 'outside' : 'ok'
  return { cards, before, after, problem }
}

/** The card of a card file (its first card), or null when it holds none. */
export function cardFileCard(content: string): CardBlock | null {
  return findCards(splitFrontmatter(content).body)[0] ?? null
}

/** A card file's ID: its card's ID (`cardIdOf`), null when it holds no card or the card has none yet. */
export function cardFileId(content: string): string | null {
  const card = cardFileCard(content)
  return card === null ? null : cardIdOf(card.line)
}

/**
 * The content of a NEW card file: `kind: card`, its `title` (YAZ-5044; none when empty), then `extra` properties in their
 * order, and one card with `text` (its sides only) and `line`. The fence is the one `cardBlock` writes. The file ends
 * with one newline.
 */
export function cardFileContent(title: string, text: string, line: CardLine, extra: Record<string, unknown> = {}): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  const rest = Object.entries(extra).filter(([k]) => k !== CARD_KIND_KEY && k !== TITLE_KEY)
  const properties = { [CARD_KIND_KEY]: CARD_KIND, ...(clean !== '' && { [TITLE_KEY]: clean }), ...Object.fromEntries(rest) }
  return `${buildFrontmatter(properties)}${cardBlock(text, line)}\n`
}

/**
 * The content of a new card file holding a card block AS IT IS, byte for byte (`block`: the card's lines from its opening
 * fence to its card line, with the indent they had taken off, `unindentBlock`). Move to its own file and Split then move
 * the title out (`cardFileTitleMoved`, `shared/cardConvert.ts`).
 */
export function cardFileWithBlock(block: string, extra: Record<string, unknown> = {}): string {
  const properties = { [CARD_KIND_KEY]: CARD_KIND, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== CARD_KIND_KEY)) }
  return `${buildFrontmatter(properties)}${block.replace(/\n+$/, '')}\n`
}

/**
 * A card file's name (YAZ-5044 pick 1): `<kebab-title>-<id>.md`, as a page's (`noteFileName`). The placeholder title of
 * a new card (`NEW_CARD_TEXT`) and an empty title give `<id>.md`.
 */
export function cardFileName(title: string, id: string): string {
  return noteFileName(title.trim() === NEW_CARD_TEXT ? '' : title, id)
}

/**
 * The lines of `card` in `lines` (its opening fence to its card line, or to its closing fence when it has none), with
 * the card's indent taken off each line that has it: the block a card file holds, byte for byte otherwise.
 */
export function unindentBlock(lines: readonly string[], card: CardBlock): string {
  const end = card.lineAt ?? card.close
  return lines
    .slice(card.open, end + 1)
    .map((l) => (card.indent !== '' && l.startsWith(card.indent) ? l.slice(card.indent.length) : l))
    .join('\n')
}

/** `block` (a card's lines, no indent) with `indent` put in front of each line that is not blank: a card put back into a page. */
export const indentBlock = (block: string, indent: string): string =>
  indent === '' ? block : block
    .split('\n')
    .map((l) => (l === '' ? '' : indent + l))
    .join('\n')
