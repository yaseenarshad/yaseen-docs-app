/**
 * Today's daily note (YAZ-3607): the name style (D4), the note found by its title in either layout (D3, D9), and the
 * vault of the window that holds the daily notes folder (D2, amended in the demo).
 */
import { describe, expect, it } from 'vitest'
import { dailyNoteFormatProblem, dailyNoteName } from '@shared/dailyNote'
import type { IndexRecord, TreeNode } from '@shared/types'
import { dailyNoteVault, findDailyNote } from './dailyNote'

const FRI = new Date(2026, 9, 16)
const record = (path: string, title: string): IndexRecord => {
  const at = path.slice(3, path.lastIndexOf('/'))
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title, folder: at, ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
}
const dir = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })

describe('the name style (D4)', () => {
  it('reads every token on the Mac day, keeps [text] and other text as typed', () => {
    expect(dailyNoteName('MM_DD- ddd', FRI)).toBe('10_16- Fri')
    expect(dailyNoteName('YYYY-MM-DD', FRI)).toBe('2026-10-16')
    expect(dailyNoteName('MMM D, YYYY', new Date(2026, 0, 5))).toBe('Jan 5, 2026')
    expect(dailyNoteName('dddd, MMMM D', FRI)).toBe('Friday, October 16')
    expect(dailyNoteName('[Daily] M/D', FRI)).toBe('Daily 10/16')
  })

  it('refuses a style with no day, a "/", or a hidden name, and says why', () => {
    expect(dailyNoteFormatProblem('YYYY-MM')).toMatch(/D or DD/)
    expect(dailyNoteFormatProblem('[Daily]')).toMatch(/D or DD/)
    expect(dailyNoteFormatProblem('YYYY/MM/DD')).toMatch(/"\/"/)
    expect(dailyNoteFormatProblem('[.]DD')).toMatch(/hidden/)
    expect(dailyNoteFormatProblem('MM_DD- ddd')).toBeNull()
  })
})

describe('findDailyNote (D3, D9)', () => {
  // A vault with IDs: file names are built, folders are the title in kebab-case.
  const RECORDS = [
    record('/v/daily/2026-10-15-dn-3.md', '2026-10-15'),
    record('/v/journal/2026-10-16-dn-6.md', '2026-10-16'),
    record('/v/daily/2026-10-16/2026-10-16-dn-9.md', '2026-10-16'),
  ]

  it('finds the note by its title, flat or in its day folder, never in another folder', () => {
    expect(findDailyNote(RECORDS, 'daily', '2026-10-16', true)).toBe('/v/daily/2026-10-16/2026-10-16-dn-9.md')
    expect(findDailyNote(RECORDS, 'daily', '2026-10-15', false)).toBe('/v/daily/2026-10-15-dn-3.md')
    expect(findDailyNote(RECORDS, 'daily', '2026-10-17', true)).toBeNull()
    // The vault folder as the daily notes folder: "journal" is no day folder of today.
    expect(findDailyNote(RECORDS, '', '2026-10-16', true)).toBeNull()
  })

  it('a switch of "Make a folder for each day" in the middle of a day finds the note made before it', () => {
    expect(findDailyNote(RECORDS, 'daily', '2026-10-15', true)).toBe('/v/daily/2026-10-15-dn-3.md')
    expect(findDailyNote(RECORDS, 'daily', '2026-10-16', false)).toBe('/v/daily/2026-10-16/2026-10-16-dn-9.md')
    // The kebab-case day folder of an ID vault: "10_16- Fri" stands in "10-16-fri".
    expect(findDailyNote([record('/v/daily/10-16-fri/10-16-fri-dn-2.md', '10_16- Fri')], 'daily', '10_16- Fri', true)).toBe('/v/daily/10-16-fri/10-16-fri-dn-2.md')
  })
})

describe('dailyNoteVault (D2, amended)', () => {
  const A = { root: '/a', tree: [dir('/a/daily')] }
  const B = { root: '/b', tree: [dir('/b/WORKING-LOG')] }

  it('the vault in front when it holds the folder, else the next vault of the window that does, else none', () => {
    expect(dailyNoteVault([A, B], 'daily')).toBe('/a')
    expect(dailyNoteVault([A, B], 'WORKING-LOG')).toBe('/b')
    expect(dailyNoteVault([B, A], 'daily')).toBe('/a')
    expect(dailyNoteVault([A, B], 'Gone')).toBeNull()
    expect(dailyNoteVault([B, A], '')).toBe('/b')
  })
})
