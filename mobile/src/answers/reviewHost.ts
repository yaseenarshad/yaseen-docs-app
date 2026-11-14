// The pure card read (YAZ-5161): no bridge, so the phone's build wall takes it. Never `cardFile.ts` (the desktop's).
import { cardOnPageIn, type CardOnPage } from '@client/review/cardRead'
import type { ReviewHost } from '@client/review/reviewHost'
import { CardNotFoundError, cardIdOf, cardNextIndex, cardReviewIndex, cardReviewsOf, pageCards, type CardLine, type CardReview } from '@shared/cardLine'
import { NOTHING_ADDED, type CardsAddedToday } from '@shared/cardSchedule'
import { cardTitle } from '@shared/cardText'
import type { VaultStore } from '../store'
import type { Answers } from './answers'
import { opsBetween, type CardOp } from './ops'

/**
 * DECISION 9: the phone's own two day numbers, kept on this phone only (they never sync, and never become an action):
 * the Up next places an answer took today (YAZ-5028), and "Add more for today" (YAZ-5042). The new-card limit needs no
 * number of its own: it is counted from the reviews, which sync. Kept as the vault's phone-only state `DAYS_STATE`.
 * A number of another day reads as none, as on the Mac (`upNextTaken.ts`, `cardsAdded.ts`: the local calendar day).
 */
export const DAYS_STATE = 'reviewDay'

interface StoredDays {
  upNext: { day: string; cards: string[] } | null
  added: (CardsAddedToday & { day: string }) | null
}

export interface PhoneDays {
  upNextTakenToday(): readonly string[]
  setUpNextTaken(id: string, taken: boolean): void
  /** Today's added numbers: ONE object while they hold still (a snapshot for `useSyncExternalStore`). */
  cardsAddedToday(): CardsAddedToday
  setCardsAdded(added: CardsAddedToday): void
  subscribeUpNext(listener: () => void): () => void
  subscribeAdded(listener: () => void): () => void
  /** Resolves when every change is stored. */
  saved(): Promise<void>
}

const NONE: readonly string[] = Object.freeze([])
/** The local calendar day, in the Mac's own form (`dayOf` in `client/src/review/upNextTaken.ts`). */
const dayOf = (now: number): string => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export async function openPhoneDays(store: VaultStore, vault: string, now: () => number = Date.now): Promise<PhoneDays> {
  let kept: StoredDays = (await store.getState<StoredDays>(vault, DAYS_STATE)) ?? { upNext: null, added: null }
  const upNextListeners = new Set<() => void>()
  const addedListeners = new Set<() => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const save = (next: StoredDays, wake: Set<() => void>) => {
    kept = next
    // A write that fails (a full phone) keeps today's numbers in memory; they are this phone's only.
    chain = chain.then(() => store.setState(vault, DAYS_STATE, next)).catch(() => undefined)
    wake.forEach((l) => l())
  }
  const subscribe = (set: Set<() => void>) => (listener: () => void) => {
    set.add(listener)
    return () => void set.delete(listener)
  }
  const days: PhoneDays = {
    upNextTakenToday: () => (kept.upNext === null || kept.upNext.day !== dayOf(now()) ? NONE : kept.upNext.cards),
    setUpNextTaken(id, taken) {
      const cards = new Set(days.upNextTakenToday())
      if (cards.has(id) === taken) return
      if (taken) cards.add(id)
      else cards.delete(id)
      save({ ...kept, upNext: { day: dayOf(now()), cards: [...cards] } }, upNextListeners)
    },
    cardsAddedToday: () => (kept.added === null || kept.added.day !== dayOf(now()) ? NOTHING_ADDED : kept.added),
    setCardsAdded(added) {
      const today = days.cardsAddedToday()
      if (today.newCards === added.newCards && today.upNext === added.upNext) return
      save({ ...kept, added: { day: dayOf(now()), newCards: Math.max(0, added.newCards), upNext: Math.max(0, added.upNext) } }, addedListeners)
    },
    subscribeUpNext: subscribe(upNextListeners),
    subscribeAdded: subscribe(addedListeners),
    saved: () => chain.then(() => undefined),
  }
  return days
}

export interface PhoneReviewHostOptions {
  answers: Answers
  /** The open vault's day numbers (`openPhoneDays`). */
  days: PhoneDays
  /** The vault's name as the phone shows it. */
  vaultName: (root: string) => string
}

/**
 * The phone's `ReviewHost` (YAZ-5067 2A; decision 3): the review rules stay in `useCardReview`; this host WRITES
 * ACTIONS (`CardOp`), never files. Each write adds one group of actions to the answer list (`answers.add`), which the
 * screens see at once (`answers.text`: the stored copy with the waiting actions) and which goes to GitHub later in one
 * commit. The `path` is the file in the repo that holds the card (the index's record path); a page that only embeds
 * the card is never written. A card that is gone: `readCard` gives null, a write rejects with `CardNotFoundError`.
 * Undo of an UNSENT answer removes its actions (the card reads byte for byte as before); undo of a SENT answer adds an
 * `unreview` action (and Up next back). The day numbers are the phone's own (`PhoneDays`, decision 9). One host for
 * the open vault: `root` is the vault id, and only the open vault's numbers are kept.
 */
export function phoneReviewHost(options: PhoneReviewHostOptions): ReviewHost {
  const { answers, days } = options

  /** The card as the phone shows it now, or a `CardNotFoundError`. */
  async function current(path: string, id: string): Promise<{ line: CardLine; title: string }> {
    const text = await answers.text(path)
    const card = text === null ? null : cardOnPageIn(path, text, id)
    const block = text === null ? undefined : pageCards(text).find((c) => cardIdOf(c.line) === card?.id)
    if (card === null || block === undefined) throw new CardNotFoundError(id)
    return { line: block.line, title: card.fileTitle ?? cardTitle(card.text) }
  }
  const add = (path: string, title: string, ops: readonly CardOp[]) => answers.add(ops.map((op) => ({ op, path, title })))
  /** The waiting answer of card `id` at `at` (its group and rating), or null when it is not in the list. */
  const unsentAnswer = (id: string, at: string): { group: number; rating: CardReview['rating'] } | null => {
    const w = [...answers.waiting()].reverse().find((w) => w.op.kind === 'review' && w.op.id === id && w.op.review.at === at)
    return w === undefined || w.op.kind !== 'review' ? null : { group: w.group, rating: w.op.review.rating }
  }
  /** The review `withoutCardReview(line, at)` would take: the last one at `at`. */
  const reviewAt = (line: CardLine, at: string): CardReview | undefined => cardReviewsOf(line).reverse().find((r) => r.at === at)

  return {
    async readCard(path, id): Promise<CardOnPage | null> {
      const text = await answers.text(path)
      return text === null ? null : cardOnPageIn(path, text, id)
    },
    async writeCardAnswer(path, id, review: CardReview) {
      const { line, title } = await current(path, id)
      const next = cardNextIndex(line)
      await add(path, title, [...(next >= 0 ? [{ kind: 'next', id, on: false } as const] : []), { kind: 'review', id, review }])
      return next
    },
    async undoCardAnswer(path, id, at, next) {
      const waiting = unsentAnswer(id, at)
      // Removed from the list only while no send has tried it. Else (a send runs, or its reply was lost) GitHub may
      // hold the review, so Undo sends `unreview` (YAZ-5180). On a line with no such review it changes nothing.
      if (waiting !== null && (await answers.undo(waiting.group))) return
      const { line, title } = await current(path, id)
      const rating = waiting?.rating ?? reviewAt(line, at)?.rating
      const ops: CardOp[] = [...(rating === undefined ? [] : [{ kind: 'unreview', id, at, rating } as const]), ...(next >= 0 ? [{ kind: 'next', id, on: true } as const] : [])]
      if (ops.length > 0) await add(path, title, ops)
    },
    async deleteCardReview(path, id, at) {
      const { line, title } = await current(path, id)
      const place = cardReviewIndex(line, at)
      const review = reviewAt(line, at)
      if (place >= 0 && review !== undefined) await add(path, title, [{ kind: 'unreview', id, at, rating: review.rating }])
      return place
    },
    async restoreCardReview(path, id, review, index) {
      if (index < 0) return
      const { title } = await current(path, id)
      await add(path, title, [{ kind: 'review', id, review }])
    },
    async changeCardLine(path, id, change) {
      const { line, title } = await current(path, id)
      const ops = opsBetween(id, line, change(line))
      if (ops.length > 0) await add(path, title, ops)
    },
    upNextTakenToday: () => days.upNextTakenToday(),
    setUpNextTaken: (_root, id, taken) => days.setUpNextTaken(id, taken),
    subscribeUpNextTaken: (listener) => days.subscribeUpNext(listener),
    cardsAddedToday: () => days.cardsAddedToday(),
    setCardsAdded: (_root, added) => days.setCardsAdded(added),
    subscribeCardsAdded: (listener) => days.subscribeAdded(listener),
    vaultName: (root) => options.vaultName(root),
  }
}
