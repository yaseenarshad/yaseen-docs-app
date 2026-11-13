import { NOTHING_ADDED, type CardsAddedToday } from '@shared/cardSchedule'
import { storage } from '../lib/storage'
import { dayOf } from './upNextTaken'

/**
 * "Add more for today" (YAZ-5042), per vault: how many new cards and Up next cards the Inbox added past the Settings
 * numbers today — `cardQueue`'s `added`. The Settings numbers never change; an add raises today's number only, and
 * its undo lowers it again. At midnight the numbers of the day before read as none.
 *
 * Kept in the app's own state (`yaseendocs.json`, the vault's folder bucket `added`, through `storage` and
 * `state.setFolder`), as `upNextTaken.ts` keeps the day's taken Up next places: an Inbox closed and opened again,
 * another window, or the app restarted keeps the day's numbers. Another Mac does not see them.
 */

/** Vault `root`'s added numbers today: one object while they hold still (a snapshot). */
export function cardsAddedToday(root: string, now = Date.now()): CardsAddedToday {
  const kept = storage.getCardsAdded(root)
  return kept === null || kept.day !== dayOf(now) ? NOTHING_ADDED : kept
}

const listeners = new Set<() => void>()

/** Wakes `listener` on a change of the numbers: a write here, or one of another window (the app state's broadcast). */
export function subscribeCardsAdded(listener: () => void): () => void {
  listeners.add(listener)
  const off = storage.subscribe(listener)
  return () => {
    listeners.delete(listener)
    off()
  }
}

/** Vault `root`'s added numbers for today, set whole; today's alone (the numbers of an older day go with this write). */
export function setCardsAdded(root: string, added: CardsAddedToday, now = Date.now()): void {
  const today = cardsAddedToday(root, now)
  if (today.newCards === added.newCards && today.upNext === added.upNext) return
  storage.setCardsAdded(root, { day: dayOf(now), newCards: Math.max(0, added.newCards), upNext: Math.max(0, added.upNext) })
  listeners.forEach((l) => l())
}
