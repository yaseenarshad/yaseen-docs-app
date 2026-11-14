/**
 * One note card in its page, read and written by ID (YAZ-4967): what the Inbox and the card window (YAZ-4962) do to
 * a card file, usable with or without a review session. The index holds no card text (D4), so a card shows from the
 * page as it is on disk now. Each write is ONE `transformFile` (`changeCard` on the bytes just read, a re-read and a
 * second try on a conflict): the page may be open in a tab, and the app merges an outside write into an open note.
 */
import {
  CardNotFoundError,
  cardIdOf,
  cardNextIndex,
  cardReviewIndex,
  cardReviewsOf,
  changeCard,
  changeCardText,
  isCardNext,
  isCardNoTitle,
  isCardOff,
  pageCards,
  withCardNext,
  withCardReview,
  withCardReviewAt,
  withoutCardReview,
  type CardLine,
  type CardReview,
} from '@shared/cardLine'
import { isCardKind } from '@shared/cardFileFormat'
import { cardTitle, cardWithTitle } from '@shared/cardText'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { titleOf } from '@shared/noteName'
import { BridgeRequestError, api } from '../api'
import { announcedWrite } from '../lib/twinEditors'
import { transformFile } from '../views/writeProperty'

/** A card as its page holds it now. */
export interface CardOnPage {
  path: string
  id: string
  /** The card's raw Markdown (`cardSides`, `cardPieces` and `cardTitle` read it). */
  text: string
  /** Its reviews, in the order the line holds them (`cardHistory`, `cardState` and `recallChance` read them). */
  reviews: CardReview[]
  off: boolean
  /** Up next (YAZ-4999 D3): the line's `next`. */
  next: boolean
  /** The title is hidden on the Inbox's front (YAZ-5030): the line's `notitle`. Absent: it shows. */
  notitle?: boolean
}

/** A card found by its ID or, before it has one, by its place (the card window, YAZ-4962). */
export interface CardAtPage extends Omit<CardOnPage, 'id'> {
  id: string | null
  /** Its place among the page's cards now. */
  index: number
  /**
   * A CARD FILE's card (YAZ-5044, decision A): the file's `title`, which its `text` does not hold. Absent for a card in a
   * page, and for a card file from before A (its first line is still its title).
   */
  fileTitle?: string
}

/** A card's title: a card file's `title` (YAZ-5044), else its first line (`cardTitle`). */
export const titleOfCard = (card: Pick<CardAtPage, 'text' | 'fileTitle'>): string => card.fileTitle ?? cardTitle(card.text)

/**
 * Card `id` of `path` — the one at `index` when that one holds `id` (two cards with one ID before the sweep settles
 * the copy: each card window shows its own card), else the first that holds it — or with no ID the card at `index`.
 * Null when the page or the card is gone (an ID no card has; no card at `index`).
 */
export async function readCardAt(path: string, id: string | null, index: number): Promise<CardAtPage | null> {
  let content: string
  try {
    content = (await api.readFile(path)).content
  } catch (err) {
    if (err instanceof BridgeRequestError && err.code === 'NOT_FOUND') return null
    throw err
  }
  return cardInContent(path, content, id, index)
}

/** `readCardAt` on bytes already read (a card embed's one read per file version, and a card file's tab, which holds its file's bytes: YAZ-5037): the same choice of card. */
export function cardInContent(path: string, content: string, id: string | null, index: number): CardAtPage | null {
  const cards = pageCards(content)
  const at = id === null || (cards[index] !== undefined && cardIdOf(cards[index].line) === id) ? index : cards.findIndex((c) => cardIdOf(c.line) === id)
  const card = cards[at]
  if (card === undefined) return null
  // A card file's own card (its first): the file's `title`, read off its properties, when it has one (YAZ-5044).
  const { properties, error } = at === 0 ? parseFrontmatter(splitFrontmatter(content).frontmatter) : { properties: {}, error: 'none' }
  const fileTitle = error === undefined && isCardKind(properties) ? titleOf(properties, '') : ''
  return { path, id: cardIdOf(card.line), index: at, text: card.text, reviews: cardReviewsOf(card.line), off: isCardOff(card.line), next: isCardNext(card.line), notitle: isCardNoTitle(card.line), ...(fileTitle !== '' && { fileTitle }) }
}

/**
 * Card `id` of page `path` (the first that holds it), or null when the page or the card is gone (deleted, moved, or its
 * ID changed). This is the Inbox's read, so a CARD FILE's card comes with its `title` as its text's first line
 * (`cardWithTitle`, YAZ-5044): "Title on the front" Show puts the title above the front and Hide leaves it out until
 * the card is fully shown, the one rule cards in pages follow. The Inbox writes only the card line, never the text.
 */
export async function readCard(path: string, id: string): Promise<CardOnPage | null> {
  const card = await readCardAt(path, id, -1)
  if (card === null || card.id === null) return null
  return { ...card, id: card.id, ...(card.fileTitle !== undefined && { text: cardWithTitle(card.fileTitle, card.text) }) }
}

/**
 * Card `id`'s line changed by `change`: ONE `transformFile`, as the app's own write (`announcedWrite`), so a page open
 * in a tab takes the new line quietly — no outside-change bar, no glow, out of its undo history. `index`: the card's
 * place, when two cards hold `id` (`changeCard`). Throws `CardNotFoundError`.
 */
export const changeCardLine = (path: string, id: string, change: (line: CardLine) => CardLine, index?: number): Promise<unknown> =>
  announcedWrite(path, () => transformFile(path, (c) => changeCard(c, id, change, index)))

/**
 * Card `id`'s TEXT replaced by `text` (YAZ-5003, Edit card in the card window): ONE `transformFile`, as the app's own
 * write, so a page open in a tab takes it quietly. With no ID, the card at `index`. Throws `CardNotFoundError`.
 */
export const changeCardTextIn = (path: string, id: string | null, text: string, index: number): Promise<unknown> =>
  announcedWrite(path, () => transformFile(path, (c) => changeCardText(c, id, text, index)))

/** Writes `review` to card `id`'s line: the answer the hover showed, as it showed it (D13). Throws `CardNotFoundError`. */
export const writeCardReview = (path: string, id: string, review: CardReview): Promise<unknown> => changeCardLine(path, id, (l) => withCardReview(l, review))

/**
 * The Inbox's answer: `review` on card `id`'s line, and its `next` removed in the SAME write (YAZ-4999 D3: the first
 * answer to an up-next card ends the mark). Resolves to the place `next` had among the line's parts (-1: none), for
 * `undoCardAnswer`. Throws `CardNotFoundError`.
 */
export async function writeCardAnswer(path: string, id: string, review: CardReview): Promise<number> {
  let next = -1
  await changeCardLine(path, id, (l) => {
    // The last try wins: `transformFile` runs the change again on a conflict.
    next = cardNextIndex(l)
    return withCardReview(withCardNext(l, false), review)
  })
  return next
}

/**
 * The undo of `writeCardAnswer`: the review at `at` removed and, when the answer removed `next`, `next` back at its
 * place `next` — ONE write, so the file is the same bytes as before the answer.
 */
export const undoCardAnswer = (path: string, id: string, at: string, next: number): Promise<unknown> =>
  changeCardLine(path, id, (l) => {
    const without = withoutCardReview(l, at)
    return next < 0 ? without : withCardNext(without, true, next)
  })

/**
 * Removes the review made at `at` from card `id` (undo, and the Reviews table's delete). An unknown `at` writes nothing.
 * Resolves to the review's place among the line's parts (-1 for an unknown `at`): `restoreCardReview` puts it back there.
 */
export async function deleteCardReview(path: string, id: string, at: string): Promise<number> {
  let removed = -1
  await changeCardLine(path, id, (l) => {
    // The last try wins: `transformFile` runs the change again on a conflict.
    removed = cardReviewIndex(l, at)
    return withoutCardReview(l, at)
  })
  return removed
}

/**
 * The undo of a delete (YAZ-4964): `review` back at part `index`, the place `deleteCardReview` gave, so the file
 * comes back byte for byte. No place (-1: the delete found no review) writes nothing.
 */
export const restoreCardReview = (path: string, id: string, review: CardReview, index: number): Promise<unknown> =>
  index < 0 ? Promise.resolve() : changeCardLine(path, id, (l) => withCardReviewAt(l, review, index))

/** A write that found no card: the page changed under the review. */
export const isCardGone = (err: unknown): boolean => err instanceof CardNotFoundError || (err instanceof BridgeRequestError && err.code === 'NOT_FOUND')
