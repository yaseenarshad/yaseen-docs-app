/**
 * Where a review session reads and writes (YAZ-5067, decision 3 of YAZ-5055: "One review logic for both apps").
 * `useCardReview` holds the review RULES — the queue, repeats in the same session, Undo, the daily limits — and reaches
 * the outside only through a `ReviewHost`: the card read, the card line writes, the two day numbers of each device
 * (decision 9: the Up next places taken today, "Add more for today") and the vault's name.
 *
 * The desktop passes `desktopReviewHost` (`desktopReviewHost.ts`): today's files (`cardFile.ts`), and the day numbers
 * in the app state (`upNextTaken.ts`, `cardsAdded.ts`), unchanged. The phone passes its own host: its list of answers
 * and its own day numbers. Tests pass an in-memory host (`memoryReviewHost.ts`). There is no default host (YAZ-5161):
 * this file and the hook import no host, so the phone builds them with no desktop bridge and no app state.
 *
 * The rules each host keeps:
 *  - A card is read and written by its ID in the file that HOLDS it (a page, or a card file), never in a page that
 *    only embeds it (`![[ID]]`). A card file's card comes with its `title` (`fileTitle`, YAZ-5044), above its text.
 *  - A write whose card or file is gone rejects with `CardNotFoundError` (`@shared/cardLine`) or the bridge's
 *    `NOT_FOUND`: the hook reads it as "gone" (`isCardGone`) and passes the card over.
 *  - The answer and its undo are ONE write each, so an undo leaves the file byte for byte as before the answer.
 *  - A host is ONE object for the life of the hook (a module constant, or one `useMemo`): the hook's callbacks and its
 *    `useSyncExternalStore` subscriptions follow its identity, so a new object each render subscribes again each render.
 *  - A day number of another day reads as none; a snapshot (`upNextTakenToday`, `cardsAddedToday`) is ONE object while
 *    it holds still (`useSyncExternalStore`), and the subscribe functions wake on each change.
 */
import type { CardLine, CardReview } from '@shared/cardLine'
import type { CardsAddedToday } from '@shared/cardSchedule'
import type { CardOnPage } from './cardRead'

export interface ReviewHost {
  /** Card `id` of file `path` as it is now, or null when the file or the card is gone (`readCard`). */
  readCard(path: string, id: string): Promise<CardOnPage | null>
  /** The answer: `review` on the card's line and its `next` off, in ONE write. Resolves to `next`'s place (-1: none). */
  writeCardAnswer(path: string, id: string, review: CardReview): Promise<number>
  /** The answer's undo: the review at `at` out and `next` back at its place `next`, in ONE write. */
  undoCardAnswer(path: string, id: string, at: string, next: number): Promise<unknown>
  /** The review at `at` removed. Resolves to its place among the line's parts (-1: no such review), for `restoreCardReview`. */
  deleteCardReview(path: string, id: string, at: string): Promise<number>
  /** A deleted review back at its place `index` (-1 writes nothing). */
  restoreCardReview(path: string, id: string, review: CardReview, index: number): Promise<unknown>
  /** Card `id`'s line changed by `change` in ONE write (Up next, Archive). */
  changeCardLine(path: string, id: string, change: (line: CardLine) => CardLine): Promise<unknown>
  /** The card IDs of vault `root` whose Up next mark an answer took off today (YAZ-5028). */
  upNextTakenToday(root: string): readonly string[]
  /** Card `id` taken from Up next today by an answer (`taken`), or given back by its undo. */
  setUpNextTaken(root: string, id: string, taken: boolean): void
  subscribeUpNextTaken(listener: () => void): () => void
  /** Vault `root`'s "Add more for today" numbers (YAZ-5042). */
  cardsAddedToday(root: string): CardsAddedToday
  /** Today's added numbers, set whole. */
  setCardsAdded(root: string, added: CardsAddedToday): void
  subscribeCardsAdded(listener: () => void): () => void
  /** The name of vault `root`, as its sidebar shows it (the breadcrumb's first part, the done screen's scope). */
  vaultName(root: string): string
}
