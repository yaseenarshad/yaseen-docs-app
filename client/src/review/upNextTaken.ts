import { isRecord } from '@shared/guards'

/**
 * The Up next marks an answer took off today (YAZ-5028), per vault: `cardQueue`'s `upNextTaken`, so "Up next a day"
 * holds for the day. The card line keeps no trace of a `next` its answer removed, so this computer counts them: each
 * answer that removed a mark adds its card ID, and its ⌘Z takes it out again. Kept in localStorage for the local day:
 * an Inbox closed and opened again, or the app restarted, keeps the count. Another Mac does not see it.
 */
const KEY = 'cards:upNextTaken'

const dayOf = (now: number): string => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function read(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return isRecord(raw) ? raw : {}
  } catch {
    return {}
  }
}

/** The card IDs of vault `root` whose mark an answer took off today. */
function takenIn(all: Record<string, unknown>, root: string, day: string): string[] {
  const entry = all[root]
  if (!isRecord(entry) || entry.day !== day || !Array.isArray(entry.cards)) return []
  return entry.cards.filter((id): id is string => typeof id === 'string')
}

/** How many Up next cards of vault `root` an answer took today. */
export const upNextTakenToday = (root: string, now = Date.now()): number => takenIn(read(), root, dayOf(now)).length

/** Card `id` of vault `root` taken from Up next today by an answer (`taken`), or given back by its undo. */
export function setUpNextTaken(root: string, id: string, taken: boolean, now = Date.now()): void {
  const all = read()
  const day = dayOf(now)
  const cards = new Set(takenIn(all, root, day))
  if (taken) cards.add(id)
  else cards.delete(id)
  // Today's alone: a vault's entry of an older day goes.
  const kept = Object.fromEntries(Object.entries(all).filter(([key, entry]) => key !== root && isRecord(entry) && entry.day === day))
  try {
    localStorage.setItem(KEY, JSON.stringify(cards.size === 0 ? kept : { ...kept, [root]: { day, cards: [...cards] } }))
  } catch {
    // No storage: the day's count starts again with the next Inbox.
  }
}
