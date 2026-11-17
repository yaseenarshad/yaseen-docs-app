/**
 * One card in its page, read and written by ID (YAZ-4967): what the Inbox and the card window (YAZ-4962) do to
 * a card file, usable with or without a review session. The index holds no card text (D4), so a card shows from the
 * page as it is on disk now. Each write is ONE `transformFile` (`changeCard` on the bytes just read, a re-read and a
 * second try on a conflict): the page may be open in a tab, and the app merges an outside write into an open page.
 */
import {
  cardNextIndex,
  cardReviewIndex,
  changeCard,
  changeCardText,
  rewritePageCards,
  withCardNext,
  withCardReview,
  withCardReviewAt,
  withCardTitle,
  withoutCardReview,
  type CardLine,
  type CardReview,
} from '@shared/cardLine'
import { BridgeRequestError, api } from '../api'
import { cardInContent, cardOnPageIn, type CardAtPage, type CardOnPage } from './cardRead'

// The pure read moved to `cardRead.ts` (YAZ-5161), so the phone reads a card with no bridge; its names stay here too.
export { cardInContent, cardOnPageIn, isCardGone, type CardAtPage, type CardOnPage } from './cardRead'
import { announcedWrite } from '../lib/twinEditors'
import { transformFile } from '../views/writeProperty'

/**
 * Card `id` of `path` — the one at `index` when that one holds `id` (two cards with one ID before the sweep settles
 * the copy: each card window shows its own card), else the first that holds it — or with no ID the card at `index`.
 * Null when the page or the card is gone (an ID no card has; no card at `index`).
 */
export async function readCardAt(path: string, id: string | null, index: number): Promise<CardAtPage | null> {
  const content = await readOrGone(path)
  return content === null ? null : cardInContent(path, content, id, index)
}

/** The text of `path`, or null when it is gone. */
async function readOrGone(path: string): Promise<string | null> {
  try {
    return (await api.readFile(path)).content
  } catch (err) {
    if (err instanceof BridgeRequestError && err.code === 'NOT_FOUND') return null
    throw err
  }
}

/**
 * Card `id` of page `path` (the first that holds it), or null when the page or the card is gone (deleted, moved, or its
 * ID changed). This is the Inbox's read: both kinds of card come alike, the title off the card line (YAZ-5308).
 */
export async function readCard(path: string, id: string): Promise<CardOnPage | null> {
  const content = await readOrGone(path)
  return content === null ? null : cardOnPageIn(path, content, id)
}

/**
 * Card `id`'s line changed by `change`: ONE `transformFile`, as the app's own write (`announcedWrite`), so a page open
 * in a tab takes the new line quietly — no outside-change bar, no glow, out of its undo history. `index`: the card's
 * place, when two cards hold `id` (`changeCard`). Throws `CardNotFoundError`.
 */
export const changeCardLine = (path: string, id: string, change: (line: CardLine) => CardLine, index?: number): Promise<unknown> =>
  announcedWrite(path, () => transformFile(path, (c) => changeCard(c, id, change, index)))

/**
 * Card `id`'s TEXT replaced by `text` (YAZ-5003, Edit card in the card window) and, when given, its `title` on its card
 * line (YAZ-5308, Edit card's Title field): ONE `transformFile`, as the app's own write, so a page open in a tab takes
 * it quietly. With no ID, the card at `index`. Throws `CardNotFoundError`. The line's `fix` (Fix later) stays: it is set
 * and cleared only by hand (YAZ-5647 item 5).
 */
export const changeCardTextIn = (path: string, id: string | null, text: string, index: number, title?: string): Promise<unknown> =>
  announcedWrite(path, () =>
    transformFile(path, (c) => {
      const next = changeCardText(c, id, text, index)
      if (title === undefined) return next
      const line = (l: CardLine): CardLine => withCardTitle(l, title)
      return id === null ? rewritePageCards(next, (card, n) => (n === index ? line(card.line) : undefined)) : changeCard(next, id, line, index)
    }),
  )

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

