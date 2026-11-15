import { describe, expect, it } from 'vitest'
import { CALENDAR_MODE_KEY, calendarPlace, saveCalendarMode, savedCalendarMode, type ModeStorage } from './calendarModePref'

/** YAZ-5597: this phone's Week / Month / Rolling for each vault, folder and view; no storage, no pick. */
const MODES = ['month', 'week', 'rolling'] as const
const memory = (): ModeStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('calendarModePref (YAZ-5597)', () => {
  it('keeps a pick for each vault, folder and view apart', () => {
    const s = memory()
    const a = calendarPlace('Main', 'Events', 'Calendar')
    const b = calendarPlace('Main', 'Trips', 'Calendar')
    const c = calendarPlace('Other', 'Events', 'Calendar')
    saveCalendarMode(a, 'week', s)
    saveCalendarMode(b, 'rolling', s)
    expect(savedCalendarMode(a, MODES, s)).toBe('week')
    expect(savedCalendarMode(b, MODES, s)).toBe('rolling')
    expect(savedCalendarMode(c, MODES, s)).toBeNull()
    expect([...s.data.keys()]).toEqual([CALENDAR_MODE_KEY])
  })

  it('no pick when storage throws, is missing, holds broken JSON or an unknown mode', () => {
    const place = calendarPlace('Main', 'Events', 'Calendar')
    const throwing: ModeStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') } }
    expect(() => saveCalendarMode(place, 'week', throwing)).not.toThrow()
    expect(savedCalendarMode(place, MODES, throwing)).toBeNull()
    expect(savedCalendarMode(place, MODES, null)).toBeNull()
    const s = memory()
    s.data.set(CALENDAR_MODE_KEY, '{not json')
    expect(savedCalendarMode(place, MODES, s)).toBeNull()
    s.data.set(CALENDAR_MODE_KEY, JSON.stringify({ [place]: 'year' }))
    expect(savedCalendarMode(place, MODES, s)).toBeNull()
  })
})
