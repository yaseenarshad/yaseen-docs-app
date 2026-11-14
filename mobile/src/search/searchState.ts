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
  notice: string | null
}

const held: Held = { vault: null, query: '', type: 'all', notice: null }

/** The box and the Type of `vault`: empty for another vault. */
export function searchStateOf(vault: string | null): { query: string; type: PhoneType } {
  if (held.vault !== vault) Object.assign(held, { vault, query: '', type: 'all' })
  return { query: held.query, type: held.type }
}

export function keepSearch(vault: string | null, query: string, type: PhoneType): void {
  Object.assign(held, { vault, query, type })
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

/** Forgets the box, the Type and the line (a test starts clean). */
export function forgetSearch(): void {
  Object.assign(held, { vault: null, query: '', type: 'all', notice: null })
}
