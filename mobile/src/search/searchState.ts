import type { PhoneType } from './searchRun'

/**
 * What the Search tab keeps while a page or a card is open over it (YAZ-5079): the box's text, the Type, and one line to
 * say once (R5: the open page was deleted). The tab draws again from here when the person comes back. Phone memory
 * only: a new start has an empty box (as the Mac's search, D15).
 */
interface Held {
  vault: string | null
  query: string
  type: PhoneType
  /** YAZ-5211: the rows shown ("Show more") and the scroll place of the list. */
  shown: number | null
  scroll: number
  notice: string | null
}

const held: Held = { vault: null, query: '', type: 'all', shown: null, scroll: 0, notice: null }

/** The box, the Type, the rows shown and the scroll place of `vault`: empty for another vault. */
export function searchStateOf(vault: string | null): { query: string; type: PhoneType; shown: number | null; scroll: number } {
  if (held.vault !== vault) Object.assign(held, { vault, query: '', type: 'all', shown: null, scroll: 0 })
  return { query: held.query, type: held.type, shown: held.shown, scroll: held.scroll }
}

export function keepSearch(vault: string | null, query: string, type: PhoneType): void {
  Object.assign(held, { vault, query, type })
}

/** YAZ-5211: the list's rows shown and its scroll place, kept while a page is open over the tab. */
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

/** YAZ-5438: the tree's open folders, for each vault, kept while the app runs (as the Mac's sidebar keeps them). */
const opened = new Map<string, Set<string>>()
export function openFoldersOf(vault: string | null): Set<string> {
  const key = vault ?? ''
  let set = opened.get(key)
  if (set === undefined) opened.set(key, (set = new Set()))
  return set
}

/** Forgets the box, the Type, the line and the open folders (a test starts clean). */
export function forgetSearch(): void {
  Object.assign(held, { vault: null, query: '', type: 'all', shown: null, scroll: 0, notice: null })
  opened.clear()
}
