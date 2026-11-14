/**
 * The desktop's review host (YAZ-5067, YAZ-5161): the vault's files through the bridge (`cardFile.ts`), and the day
 * numbers in the app state (`upNextTaken.ts`, `cardsAdded.ts`). Today's functions, unchanged. Its own file, so the
 * hook and the `ReviewHost` type load with no bridge: each desktop caller of `useCardReview` passes it.
 */
import type { CardsAddedToday } from '@shared/cardSchedule'
import { storage } from '../lib/storage'
import { changeCardLine, deleteCardReview, readCard, restoreCardReview, undoCardAnswer, writeCardAnswer } from './cardFile'
import { cardsAddedToday, setCardsAdded, subscribeCardsAdded } from './cardsAdded'
import type { ReviewHost } from './reviewHost'
import { setUpNextTaken, subscribeUpNextTaken, upNextTakenToday } from './upNextTaken'

/** The desktop's host: the vault's files through the bridge, and the day numbers in the app state. Today's functions, unchanged. */
export const desktopReviewHost: ReviewHost = Object.freeze({
  readCard,
  writeCardAnswer,
  undoCardAnswer,
  deleteCardReview,
  restoreCardReview,
  changeCardLine,
  upNextTakenToday: (root: string) => upNextTakenToday(root),
  setUpNextTaken: (root: string, id: string, taken: boolean) => setUpNextTaken(root, id, taken),
  subscribeUpNextTaken,
  cardsAddedToday: (root: string) => cardsAddedToday(root),
  setCardsAdded: (root: string, added: CardsAddedToday) => setCardsAdded(root, added),
  subscribeCardsAdded,
  vaultName: (root: string) => storage.vaultName(root),
})
