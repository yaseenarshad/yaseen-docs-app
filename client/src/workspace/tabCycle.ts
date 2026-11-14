/**
 * ⌃Tab / ⌃⇧Tab (rule 9, YAZ-5373): the next or previous tab of the strip AS IT SHOWS, wrapping around. The Inbox tab
 * (YAZ-5011) is one of its stops where it stands (`at`, YAZ-5016), so ⌃Tab from it goes to the tab right after it — not
 * to the one after the page tab behind it — and ⌃Tab from the tab before it goes to it. The blank tab stands last
 * (YAZ-2655): from it, on to the first stop and back to the last one.
 */
export type CycleStop = { tab: string } | { inbox: true }

/** The Inbox tab while a review session is open: its slot among the page tabs and whether it is on show. */
export interface InboxSlot {
  at: number
  front: boolean
}

export function cycleStop(ids: readonly string[], active: string | null, blank: boolean, inbox: InboxSlot | null, dir: 1 | -1): CycleStop | null {
  const stops: CycleStop[] = ids.map((id) => ({ tab: id }))
  if (inbox !== null) stops.splice(Math.max(0, Math.min(inbox.at, stops.length)), 0, { inbox: true })
  if (stops.length === 0) return null
  const n = stops.length
  // The blank tab, past the last stop: one step on is the first, one step back the last.
  if (blank && inbox?.front !== true) return stops[dir === 1 ? 0 : n - 1]
  const from = inbox?.front === true ? stops.findIndex((s) => 'inbox' in s) : stops.findIndex((s) => 'tab' in s && s.tab === active)
  if (from === -1 || n < 2) return null
  return stops[(from + dir + n) % n]
}
