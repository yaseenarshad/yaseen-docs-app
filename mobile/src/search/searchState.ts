import type { PhoneType } from './searchRun'

/**
 * What the Search tab keeps while a page or a card is open over it: the box's text, the Type, and one line to
 * say once (R5: the open page was deleted). The tab draws again from here when the person comes back. Phone memory
 * only: a new start has an empty box (as the Mac's search, D15).
 */
interface Held {
  vault: string | null
  query: string
  type: PhoneType
  /** The rows shown ("Show more") and the scroll place of the list. */
  shown: number | null
  scroll: number
  notice: string | null
}

const held: Held = { vault: null, query: '', type: [], shown: null, scroll: 0, notice: null }

/** The box, the Type, the rows shown and the scroll place of `vault`: empty for another vault. */
export function searchStateOf(vault: string | null): { query: string; type: PhoneType; shown: number | null; scroll: number } {
  if (held.vault !== vault) Object.assign(held, { vault, query: '', type: [], shown: null, scroll: 0 })
  return { query: held.query, type: held.type, shown: held.shown, scroll: held.scroll }
}

export function keepSearch(vault: string | null, query: string, type: PhoneType): void {
  Object.assign(held, { vault, query, type })
}

/** The list's rows shown and its scroll place, kept while a page is open over the tab. */
export function keepPlace(shown: number | null, scroll?: number): void {
  if (shown !== null) held.shown = shown
  if (scroll !== undefined) held.scroll = scroll
}

/** A line the Search tab says once, the next time it shows. */
export function setSearchNotice(text: string): void {
  held.notice = text
}

/** The line to say, and it is said: the next call gives null. */
export function takeSearchNotice(): string | null {
  const text = held.notice
  held.notice = null
  return text
}

/** The tree's open folders, for each vault, kept while the app runs (as the Mac's sidebar keeps them). */
const opened = new Map<string, Set<string>>()
export function openFoldersOf(vault: string | null): Set<string> {
  const key = vault ?? ''
  let set = opened.get(key)
  if (set === undefined) opened.set(key, (set = new Set()))
  return set
}

/** The row the tree shows next time it draws (YAZ-5714, Show in Search): its folders open, scrolled to, glowing. */
let revealing: string | null = null

/**
 * Show in Search (YAZ-5714, the bubble of Review's crumb): the next Search shows the whole tree (the box empty, no Type),
 * every folder above `path` open, and the tree scrolls to its row and lights it, as the Mac's Show in sidebar. The
 * list filter (Favorites) goes too (`SearchBar`): the page may not be in it.
 */
export function revealInSearch(vault: string | null, path: string): void {
  Object.assign(held, { vault, query: '', type: [], shown: null, scroll: 0 })
  const open = openFoldersOf(vault)
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/'))
  revealing = path
}

/** The row to show, once: the tree takes it when its row is drawn. */
export const revealOf = (): string | null => revealing
export function revealDone(): void {
  revealing = null
}

/** Forgets the box, the Type, the line, the open folders and a reveal (a test starts clean). */
export function forgetSearch(): void {
  Object.assign(held, { vault: null, query: '', type: [], shown: null, scroll: 0, notice: null })
  opened.clear()
  revealing = null
}
