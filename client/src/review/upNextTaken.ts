import { storage } from '../lib/storage'

/**
 * The Up next marks an answer took off today (YAZ-5028), per vault: `cardQueue`'s `upNextTaken`, so "Up next a day"
 * holds for the day. The card line keeps no trace of a `next` its answer removed, so this computer keeps them: each
 * answer that removed a mark adds its card ID, and its ⌘Z takes it out again.
 *
 * Kept in the app's own state (`yaseendocs.json`, the vault's folder bucket `upNext`, through `storage` and
 * `state.setFolder`), never in the browser profile (docs/DEVELOPMENT.md "App state"): an Inbox closed and opened
 * again, another window, or the app restarted keeps the day's list. A list of an older day reads as none. Another
 * Mac does not see it.
 */
const NONE: readonly string[] = Object.freeze([])

export const dayOf = (now: number): string => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** The card IDs of vault `root` whose mark an answer took off today: one array while the list holds still (a snapshot). */
export function upNextTakenToday(root: string, now = Date.now()): readonly string[] {
  const kept = storage.getUpNextTaken(root)
  return kept === null || kept.day !== dayOf(now) ? NONE : kept.cards
}

const listeners = new Set<() => void>()

/** Wakes `listener` on a change of the lists: a write here, or one of another window (the app state's broadcast). */
export function subscribeUpNextTaken(listener: () => void): () => void {
  listeners.add(listener)
  const off = storage.subscribe(listener)
  return () => {
    listeners.delete(listener)
    off()
  }
}

/** Card `id` of vault `root` taken from Up next today by an answer (`taken`), or given back by its undo. */
export function setUpNextTaken(root: string, id: string, taken: boolean, now = Date.now()): void {
  const cards = new Set(upNextTakenToday(root, now))
  if (cards.has(id) === taken) return
  if (taken) cards.add(id)
  else cards.delete(id)
  // Today's alone: the list of an older day goes with this write.
  storage.setUpNextTaken(root, { day: dayOf(now), cards: [...cards] })
  listeners.forEach((l) => l())
}
