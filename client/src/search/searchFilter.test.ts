import { describe, expect, it, vi } from 'vitest'
import type { MenuAction, MenuParent } from '../sidebar/menuSections'
import { matchScore } from '../sidebar/hooks/useSidebarSearch'
import type { SearchCandidate } from './searchCandidates'
import { filterSection, filterTest, NO_FILTER, timeStart, typeOf } from './searchFilter'

const row = (path: string, kind: 'file' | 'dir' = 'file'): SearchCandidate => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { kind, name, lower: name.toLowerCase(), label: name, path, folder: '' }
}
// Wednesday Oct 28 2026, 15:30 local time.
const NOW = new Date(2026, 9, 28, 15, 30).getTime()
const at = (...parts: [number, number, number, number?, number?]) => new Date(...(parts as [number, number, number, number, number])).getTime()

describe('typeOf (YAZ-3511 D13)', () => {
  it('a folder by its kind; a file by its extension, case-blind (edge cases 40 to 43)', () => {
    expect(typeOf(row('/v/Plans', 'dir'))).toBe('folders')
    expect(typeOf(row('/v/Plans.md', 'dir'))).toBe('folders')
    expect(typeOf(row('/v/plan.md'))).toBe('notes')
    expect(typeOf(row('/v/plan.markdown'))).toBe('notes')
    expect(typeOf(row('/v/shot.JPG'))).toBe('images')
    expect(typeOf(row('/v/logo.svg'))).toBe('images')
    expect(typeOf(row('/v/spec.pdf'))).toBe('pdfs')
    expect(typeOf(row('/v/board.excalidraw'))).toBe('other')
    expect(typeOf(row('/v/data.csv'))).toBe('other')
    expect(typeOf(row('/v/.env'))).toBe('other')
    expect(typeOf(row('/v/Makefile'))).toBe('other')
  })
})

describe('timeStart (YAZ-3511 D14)', () => {
  it('the local calendar: 00:00 today, Monday 00:00, the 1st, January 1', () => {
    expect(timeStart('today', NOW)).toBe(at(2026, 9, 28))
    expect(timeStart('week', NOW)).toBe(at(2026, 9, 26))
    expect(timeStart('month', NOW)).toBe(at(2026, 9, 1))
    expect(timeStart('year', NOW)).toBe(at(2026, 0, 1))
  })

  it('on a Monday the week starts today; on a Sunday it started six days before (edge case 46)', () => {
    expect(timeStart('week', at(2026, 9, 26, 9))).toBe(at(2026, 9, 26))
    expect(timeStart('week', at(2026, 10, 1, 23))).toBe(at(2026, 9, 26))
  })
})

describe('filterTest (YAZ-3511 D13, D14, D16)', () => {
  const times = new Map([
    ['/v/new.md', at(2026, 9, 28, 0, 1)],
    ['/v/old.md', at(2026, 9, 27, 23, 59)],
    ['/v/Dir', at(2026, 9, 28, 9)],
    ['/v/Empty', 0],
    ['/v/new.pdf', at(2026, 9, 28, 10)],
  ])
  const timeOf = (path: string) => times.get(path) ?? 0

  it('no filter: no test, so the ranking reads the rows as they are', () => {
    expect(filterTest(NO_FILTER, timeOf, NOW)).toBeUndefined()
  })

  it('Today: 00:01 passes, 23:59 yesterday does not; a folder by its newest file; an empty folder never (edge cases 45, 47, 48)', () => {
    const keep = filterTest({ type: 'all', time: 'today' }, timeOf, NOW)!
    expect(keep(row('/v/new.md'))).toBe(true)
    expect(keep(row('/v/old.md'))).toBe(false)
    expect(keep(row('/v/Dir', 'dir'))).toBe(true)
    expect(keep(row('/v/Empty', 'dir'))).toBe(false)
  })

  it('a type and a time together: a row must pass both (edge case 50)', () => {
    const keep = filterTest({ type: 'pdfs', time: 'today' }, timeOf, NOW)!
    expect(keep(row('/v/new.pdf'))).toBe(true)
    expect(keep(row('/v/new.md'))).toBe(false)
  })

  it('a type alone reads no time', () => {
    const read = vi.fn(() => 0)
    expect(filterTest({ type: 'notes', time: 'any' }, read, NOW)!(row('/v/a.md'))).toBe(true)
    expect(read).not.toHaveBeenCalled()
  })
})

describe('filterSection (YAZ-3511 D13, D14)', () => {
  const labels = (parent: MenuParent) => parent.children.map((group) => group.map((item) => `${item.label}${item.hint ?? ''}`))

  it('Type ▸ and Time ▸, each its "all" choice apart, ✓ on the pick, the pick as the row hint (edge cases 39, 44, 59)', () => {
    const [type, time] = filterSection({ type: 'notes', time: 'any' }, vi.fn()) as MenuParent[]
    expect([type.label, type.hint, time.label, time.hint]).toEqual(['Type', 'Notes', 'Time', 'Any time'])
    expect(labels(type)).toEqual([['All types'], ['Notes✓', 'Folders', 'Images', 'PDFs', 'Other']])
    expect(labels(time)).toEqual([['Any time✓'], ['Today', 'This week', 'This month', 'This year']])
  })

  it('a pick writes the one filter it changes, and a pick that changes nothing writes nothing', () => {
    const set = vi.fn()
    const [type, time] = filterSection(NO_FILTER, set) as MenuParent[]
    ;(time.children[1][0] as MenuAction).onSelect()
    expect(set).toHaveBeenLastCalledWith({ type: 'all', time: 'today' })
    ;(type.children[1][3] as MenuAction).onSelect()
    expect(set).toHaveBeenLastCalledWith({ type: 'pdfs', time: 'any' })
    set.mockClear()
    ;(type.children[0][0] as MenuAction).onSelect()
    expect(set).not.toHaveBeenCalled()
  })
})

describe('matchScore (YAZ-3511 D12)', () => {
  it('0 an ID match, 1 the same name, 2 starts with, 3 holds (edge cases 28, 32)', () => {
    expect(matchScore(row('/v/Phase 12.md'), 'yaz-12')).toBe(0)
    expect(matchScore({ lower: 'plan' }, 'plan')).toBe(1)
    expect(matchScore({ lower: 'plan b' }, 'plan')).toBe(2)
    expect(matchScore({ lower: 'project plan' }, 'plan')).toBe(3)
  })
})
