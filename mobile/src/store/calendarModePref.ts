/**
 * YAZ-5597: the folder calendar's Week / Month / Rolling as picked on THIS phone, for each vault, folder and view, in
 * `localStorage` (one JSON map). Phone only: it never goes in the folder page file, which keeps the Mac's own
 * `calendarScale`. Every read and write is in try/catch: Private Browsing, a full phone or a broken value gives no
 * pick, and the calendar opens on the view's own scale.
 */
export const CALENDAR_MODE_KEY = 'notecard.calendarModes'

export type ModeStorage = Pick<Storage, 'getItem' | 'setItem'>

const local = (): ModeStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** One view's place: its vault, its folder ('' the root) and its name. */
export const calendarPlace = (vault: string, folder: string, view: string): string => JSON.stringify([vault, folder, view])

function read(storage: ModeStorage | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(CALENDAR_MODE_KEY) ?? '{}')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** This phone's pick for `place`, or null (none, or no storage). Only the given `modes` count. */
export function savedCalendarMode<M extends string>(place: string, modes: readonly M[], storage: ModeStorage | null = local()): M | null {
  const value = read(storage)[place]
  return typeof value === 'string' && (modes as readonly string[]).includes(value) ? (value as M) : null
}

export function saveCalendarMode(place: string, mode: string, storage: ModeStorage | null = local()): void {
  try {
    storage?.setItem(CALENDAR_MODE_KEY, JSON.stringify({ ...read(storage), [place]: mode }))
  } catch {
    // No storage here: the pick holds while the calendar is open.
  }
}
