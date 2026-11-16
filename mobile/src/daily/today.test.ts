import { describe, expect, it } from 'vitest'
import { dailyPageDate, dailyPageName } from '@shared/dailyPage'
import { dailyPagesFile, readDailyPagesFile, sanitizeDailyPages, type VaultDailyPages } from '@shared/dailyPagesFile'
import { phoneRecord } from '../sync/phoneIndex'
import { todayOrLatest } from './today'

/** YAZ-5470: the Today button's page, by the Mac's daily page rules. Made-up vaults and names only. */
const NOW = new Date(2026, 10, 13, 9, 30) // Friday 13 November 2026, the phone's local time
const page = (path: string, title?: string) => phoneRecord(path, 10, title === undefined ? '' : `---\ntitle: ${title}\n---\n`, { ctime: 1, mtime: 1 })
const ISO: VaultDailyPages = { folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }

describe('the vault file `.yaseendocs/daily-pages.json` (on, off)', () => {
  it('on only with "enabled": true and a style the Mac can use', () => {
    expect(sanitizeDailyPages({ enabled: true, folder: 'Journal/Days/', format: 'MM_DD- ddd', dayFolder: true })).toEqual({ folder: 'Journal/Days', format: 'MM_DD- ddd', dayFolder: true })
    expect(sanitizeDailyPages({ enabled: true })).toEqual({ folder: '', format: 'YYYY-MM-DD', dayFolder: false })
    for (const off of [undefined, null, 'x', [], {}, { enabled: false, folder: 'Daily' }, { enabled: 'yes' }, { enabled: true, format: 'YYYY' }, { enabled: true, format: 7 }, { enabled: true, folder: '../x' }])
      expect(sanitizeDailyPages(off)).toBeNull()
  })

  it('YAZ-5491: the file the Mac writes from Settings reads here as it did; one the Mac reads as off is off here', () => {
    const mac = dailyPagesFile({ enabled: true, folder: 'Journal', format: 'MMM D, YYYY', dayFolder: true })
    expect(sanitizeDailyPages({ ...mac, later: { x: 1 } })).toEqual({ folder: 'Journal', format: 'MMM D, YYYY', dayFolder: true })
    expect(sanitizeDailyPages(dailyPagesFile({ ...readDailyPagesFile(mac), enabled: false }))).toBeNull()
  })
})

describe('the date in a daily page name (`dailyPageDate`, shared)', () => {
  it('reads back each ready style and a custom one', () => {
    for (const format of ['YYYY-MM-DD', 'MM_DD', 'MMM D, YYYY', 'YYYY-MM-DD ddd', '[Daily] dddd, MMMM D', 'MM_DD- ddd', 'D.M.YYYY']) {
      const day = new Date(2026, 9, 5)
      expect(dailyPageDate(format, dailyPageName(format, day), NOW)?.getTime(), format).toBe(day.getTime())
    }
  })
  it('a style with no year: the latest such day on or before today; its weekday picks the year', () => {
    expect(dailyPageDate('MM_DD', '11_13', NOW)).toEqual(new Date(2026, 10, 13))
    expect(dailyPageDate('MM_DD', '12_31', NOW)).toEqual(new Date(2025, 11, 31))
    // 14 Nov is a Saturday in 2026 (tomorrow) and a Thursday in 2024: the weekday says which.
    expect(dailyPageDate('MM_DD- ddd', '11_14- Thu', NOW)).toEqual(new Date(2024, 10, 14))
  })
  it('not a name of the style, or no such day: null', () => {
    expect(dailyPageDate('YYYY-MM-DD', 'Shopping list', NOW)).toBeNull()
    expect(dailyPageDate('YYYY-MM-DD', '2026-02-30', NOW)).toBeNull()
    expect(dailyPageDate('YYYY-MM-DD', '2026-11-13 notes', NOW)).toBeNull()
  })
})

describe("the Today button's page (`todayOrLatest`)", () => {
  it("today's page exists: it opens", () => {
    const records = [page('Daily/2026-11-12.md'), page('Daily/2026-11-13.md'), page('Daily/2026-11-10.md')]
    expect(todayOrLatest(records, ISO, NOW)).toEqual({ path: 'Daily/2026-11-13.md', today: true })
  })

  it('today is missing: the latest one before today by the date in its name, not by path or file time', () => {
    const records = [page('Daily/2026-11-12.md'), page('Daily/2026-09-30.md'), page('Daily/2026-11-02.md'), page('Daily/2026-11-20.md'), page('Notes/2026-11-12 ideas.md')]
    expect(todayOrLatest(records, ISO, NOW)).toEqual({ path: 'Daily/2026-11-12.md', today: false })
    // By the date, not the order of names: "MMM D, YYYY" sorts "Nov 9" after "Nov 10".
    const mmm: VaultDailyPages = { folder: 'Daily', format: 'MMM D, YYYY', dayFolder: false }
    expect(todayOrLatest([page('Daily/Nov 9, 2026.md'), page('Daily/Nov 10, 2026.md'), page('Daily/Oct 31, 2026.md')], mmm, NOW)?.path).toBe('Daily/Nov 10, 2026.md')
  })

  it('another style, in a vault with IDs: found by the title, not the file name', () => {
    const style: VaultDailyPages = { folder: 'daily', format: 'MM_DD- ddd', dayFolder: false }
    const records = [page('daily/11-11-wed-ab-3.md', '11_11- Wed'), page('daily/11-12-thu-ab-7.md', '11_12- Thu')]
    expect(todayOrLatest(records, style, NOW)).toEqual({ path: 'daily/11-12-thu-ab-7.md', today: false })
    expect(todayOrLatest([...records, page('daily/11-13-fri-ab-9.md', '11_13- Fri')], style, NOW)).toEqual({ path: 'daily/11-13-fri-ab-9.md', today: true })
  })

  it('another folder: the vault folder itself, a nested folder, and a day folder for each day', () => {
    const root: VaultDailyPages = { folder: '', format: 'YYYY-MM-DD', dayFolder: false }
    expect(todayOrLatest([page('2026-11-11.md'), page('Old/2026-11-12.md')], root, NOW)?.path).toBe('2026-11-11.md')
    const nested: VaultDailyPages = { folder: 'Journal/Days', format: 'YYYY-MM-DD', dayFolder: false }
    expect(todayOrLatest([page('Journal/Days/2026-11-11.md'), page('Daily/2026-11-12.md')], nested, NOW)?.path).toBe('Journal/Days/2026-11-11.md')
    const days: VaultDailyPages = { folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: true }
    expect(todayOrLatest([page('Daily/2026-11-12/2026-11-12.md'), page('Daily/2026-11-13/2026-11-13.md')], days, NOW)).toEqual({ path: 'Daily/2026-11-13/2026-11-13.md', today: true })
    expect(todayOrLatest([page('Daily/2026-11-12/2026-11-12.md'), page('Daily/2026-11-12/Groceries.md')], days, NOW)).toEqual({ path: 'Daily/2026-11-12/2026-11-12.md', today: false })
  })

  it('an empty folder, or only pages that are no daily page or are after today: null', () => {
    expect(todayOrLatest([], ISO, NOW)).toBeNull()
    expect(todayOrLatest([page('Daily/Read me.md'), page('Daily/2026-11-20.md'), page('Other/2026-11-12.md')], ISO, NOW)).toBeNull()
  })
})
