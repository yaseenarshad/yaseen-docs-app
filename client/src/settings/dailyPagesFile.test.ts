/**
 * `shared/dailyPagesFile.ts` (YAZ-5491): the Mac's reader of `daily-pages.json` (each field falls back alone), the
 * writer's shape (the phone reads it), and the window's choice: the first vault whose file says on, else off when any
 * vault has a file, else the app value.
 */
import { describe, expect, it } from 'vitest'
import { DAILY_PAGES_OFF, dailyPagesFile, dailyPagesOfSettings, readDailyPagesFile, sanitizeDailyPages, windowDailyPages, withDailyPages } from '@shared/dailyPagesFile'
import { DEFAULT_SETTINGS } from '@shared/types'

const ON = { enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }
const APP = { ...ON, folder: 'App' }

describe('readDailyPagesFile', () => {
  it('each field falls back alone; unknown keys and version are ignored', () => {
    expect(readDailyPagesFile({ version: 9, enabled: true, folder: 'Daily', format: 'MM_DD', dayFolder: true, other: 1 })).toEqual({ enabled: true, folder: 'Daily', format: 'MM_DD', dayFolder: true })
    expect(readDailyPagesFile({ enabled: 'yes', folder: '../out', format: 7, dayFolder: 'no' })).toEqual(DAILY_PAGES_OFF)
    expect(readDailyPagesFile({ enabled: true, folder: '/Journal/', format: 'not a style ☃' })).toEqual({ enabled: true, folder: 'Journal', format: 'YYYY-MM-DD', dayFolder: false })
    expect(readDailyPagesFile(null)).toEqual(DAILY_PAGES_OFF)
    expect(readDailyPagesFile([1])).toEqual(DAILY_PAGES_OFF)
  })

  it('the writer writes every field; the phone reads it as before', () => {
    expect(dailyPagesFile(ON)).toEqual({ version: 1, ...ON })
    expect(sanitizeDailyPages(dailyPagesFile(ON))).toEqual({ folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false })
    expect(sanitizeDailyPages(dailyPagesFile({ ...ON, enabled: false }))).toBeNull()
  })

  it('the app value goes over settings and back; the same value keeps the object', () => {
    const s = withDailyPages(DEFAULT_SETTINGS, ON)
    expect(dailyPagesOfSettings(s)).toEqual(ON)
    expect(withDailyPages(s, { ...ON })).toBe(s)
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme)
  })
})

describe('windowDailyPages', () => {
  it('no file in the window: the app value, found by its folder at the click (root null)', () => {
    expect(windowDailyPages([{ root: '/a', file: null }, { root: '/b', file: null }], APP)).toEqual({ settings: APP, root: null })
  })

  it('the first vault whose file says on, in the window\'s order', () => {
    const b = { ...ON, folder: 'Journal' }
    expect(windowDailyPages([{ root: '/a', file: { ...ON, enabled: false } }, { root: '/b', file: b }, { root: '/c', file: ON }], APP)).toEqual({ settings: b, root: '/b' })
  })

  it('a file anywhere and none on: off, and the app value is not used (a vault with no file never turns it back on)', () => {
    const off = { ...ON, enabled: false }
    const got = windowDailyPages([{ root: '/a', file: null }, { root: '/b', file: off }], APP, '/a')
    expect(got).toEqual({ settings: off, root: '/b' })
    // The active vault's file is the one shown, when it has one.
    const offA = { ...off, folder: 'A' }
    expect(windowDailyPages([{ root: '/a', file: offA }, { root: '/b', file: off }], APP, '/b').root).toBe('/b')
  })

  it('two vaults in two windows keep two values', () => {
    const b = { ...ON, folder: 'Journal', format: 'MM_DD' }
    expect(windowDailyPages([{ root: '/a', file: ON }], APP).settings).toEqual(ON)
    expect(windowDailyPages([{ root: '/b', file: b }], APP).settings).toEqual(b)
  })
})
