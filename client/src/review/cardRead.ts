/**
 * A card read from the text of its file, with no bridge and no app state (YAZ-5161): pure, so the desktop's
 * `cardFile.ts` and every other review host (the phone's, a test's) read a card the same way. `cardFile.ts` gives out
 * the same names.
 */
import { CardNotFoundError, cardIdOf, cardPlace, cardPropertiesOf, cardReviewsOf, cardTitleAtOf, cardTitleOf, isCardFix, isCardNext, isCardNoTitle, isCardOff, pageCards, type CardPropertyValue, type CardReview, type CardTitleAt } from '@shared/cardLine'
import { isCardFileContent } from '@shared/cardFileFormat'
import { BridgeRequestError } from '../bridgeError'

/** A card as its page holds it now. */
export interface CardOnPage {
  path: string
  id: string
  /** The card's raw Markdown, its sides only (`cardSides` and `cardPieces` read it). */
  text: string
  /** Its title, off its card line (YAZ-5308); '' for a card with none. */
  title: string
  /** Its reviews, in the order the line holds them (`cardHistory`, `cardState` and `recallChance` read them). */
  reviews: CardReview[]
  off: boolean
  /** Up next (YAZ-4999 D3): the line's `next`. */
  next: boolean
  /** The title is hidden on the Inbox's front (YAZ-5030): the line's `notitle`. Absent: it shows. */
  notitle?: boolean
  /** When its title shows in Review, its own choice (YAZ-5696: the line's `title-front`…). Absent: the global `titleAt`. */
  titleAt?: CardTitleAt
  /** Marked "Fix later" (YAZ-5097): the line's `fix`. Absent: no mark. */
  fix?: true
  /** The card's own properties (YAZ-5379), off its card line; {} for a card with none. */
  properties?: Record<string, CardPropertyValue>
}

/** A card found by its ID or, before it has one, by its place (the card window, YAZ-4962). */
export interface CardAtPage extends Omit<CardOnPage, 'id'> {
  id: string | null
  /** Its place among the page's cards now. */
  index: number
  /** A CARD FILE's card (YAZ-5037): its title is the file's, so a rename renames the file too (the tab's title door). */
  cardFile?: true
}

/** `readCardAt` on bytes already read (a card embed's one read per file version, and a card file's tab, which holds its file's bytes: YAZ-5037): the same choice of card. */
export function cardInContent(path: string, content: string, id: string | null, index: number): CardAtPage | null {
  const cards = pageCards(content)
  const at = cardPlace(cards.map((c) => cardIdOf(c.line)), id, index)
  const card = cards[at]
  if (card === undefined) return null
  const cardFile = at === 0 && isCardFileContent(content)
  return { path, id: cardIdOf(card.line), index: at, text: card.text, title: cardTitleOf(card.line), reviews: cardReviewsOf(card.line), off: isCardOff(card.line), next: isCardNext(card.line), notitle: isCardNoTitle(card.line), ...(cardTitleAtOf(card.line) !== null && { titleAt: cardTitleAtOf(card.line)! }), properties: cardPropertiesOf(card.line), ...(isCardFix(card.line) && { fix: true as const }), ...(cardFile && { cardFile: true as const }) }
}

/**
 * `readCard` on bytes already read: pure, so every review host reads a card the same way (YAZ-5067; the phone's host
 * reads its stored text with it). Both kinds of card come alike: the title off the card line (YAZ-5308).
 */
export function cardOnPageIn(path: string, content: string, id: string): CardOnPage | null {
  const card = cardInContent(path, content, id, -1)
  if (card === null || card.id === null) return null
  return { ...card, id: card.id }
}

/** A write that found no card: the page changed under the review. */
export const isCardGone = (err: unknown): boolean => err instanceof CardNotFoundError || (err instanceof BridgeRequestError && err.code === 'NOT_FOUND')
