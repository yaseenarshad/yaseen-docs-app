import type { Route } from '../app/nav'
import type { VaultStore } from '../store'

/**
 * RECENT ON THE PHONE (YAZ-5457): the pages and cards opened on THIS phone, newest first, `MAX_RECENT` at most, kept
 * for each vault in the phone's own storage (IndexedDB, the vault's state `recent`). Not the Mac's Recents: those live
 * in the Mac's own settings, not in the vault, and writing the phone's into the vault would make a GitHub commit for
 * each page opened. A chunk of its own, never the first load (YAZ-5377): the app state loads it as a page opens.
 */

export const RECENT_STATE = 'recent'
export const MAX_RECENT = 50

/** One page or card opened: a page by its path; a card by its file (a card file) or its page, and its ID. */
export interface RecentEntry {
  path: string
  id?: string
  /** When it was opened (ms). */
  at: number
}

const isEntry = (v: unknown): v is RecentEntry => {
  const e = v as RecentEntry | null
  return typeof e === 'object' && e !== null && typeof e.path === 'string' && e.path !== '' && typeof e.at === 'number' && (e.id === undefined || typeof e.id === 'string')
}

/** The vault's list as stored, newest first; anything else in the state reads as no list. */
export async function readRecent(store: VaultStore, vault: string): Promise<RecentEntry[]> {
  const held = await store.getState<unknown>(vault, RECENT_STATE)
  return Array.isArray(held) ? held.filter(isEntry).slice(0, MAX_RECENT) : []
}

/** The writes of each vault, one after the other: two pages opened at once both stay. */
const chains = new Map<string, Promise<void>>()

/**
 * A page, a card or a drawing (YAZ-5473) was opened (`go` of the app state, YAZ-5457): it goes to the top of the vault's list, once.
 * Any other screen is not recorded. Never throws: a list that cannot be written only misses this entry.
 */
export function remember(store: VaultStore, vault: string | null, route: Route, now = Date.now()): Promise<void> {
  if (vault === null || (route.kind !== 'page' && route.kind !== 'card' && route.kind !== 'drawing')) return Promise.resolve()
  const entry: RecentEntry = { path: route.path, ...(route.kind === 'card' && { id: route.id }), at: now }
  const next = (chains.get(vault) ?? Promise.resolve())
    .then(async () => {
      const list = await readRecent(store, vault)
      const rest = list.filter((e) => e.path !== entry.path || e.id !== entry.id)
      await store.setState(vault, RECENT_STATE, [entry, ...rest].slice(0, MAX_RECENT))
    })
    .catch(() => undefined)
  chains.set(vault, next)
  return next
}
