import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sanitizeDailyPages } from '@shared/dailyPagesFile'
import { DEFAULT_SETTINGS, type AppState } from '@shared/types'
import { keepDailyPagesFiles, writeDailyPagesFile, type DailyFields } from './dailyPagesVaultFile'

/** YAZ-5476: the Mac mirrors Settings › Daily pages into each open vault's `.yaseendocs/daily-pages.json`, for the phone. */

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

async function vault(...folders: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-daily-'))
  roots.push(root)
  for (const f of folders) await mkdir(path.join(root, f), { recursive: true })
  return root
}
const file = (root: string) => path.join(root, '.yaseendocs', 'daily-pages.json')
const held = async (root: string): Promise<unknown> => JSON.parse(await readFile(file(root), 'utf8'))
const ON: DailyFields = { dailyPages: true, dailyPageFolder: 'Daily', dailyPageFormat: 'YYYY-MM-DD', dailyPageDayFolder: false }
const OFF: DailyFields = { ...ON, dailyPages: false }

describe('writeDailyPagesFile', () => {
  it('on, and the vault holds the folder: the file says on, in the phone\'s format', async () => {
    const root = await vault('Daily')
    expect(await writeDailyPagesFile(root, ON)).toBe('written')
    expect(await held(root)).toEqual({ enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false })
    expect(sanitizeDailyPages(await held(root))).toEqual({ folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false })
  })

  it('writes only a change: the same settings again leave the file alone', async () => {
    const root = await vault('Daily')
    await writeDailyPagesFile(root, ON)
    const before = (await stat(file(root))).mtimeMs
    expect(await writeDailyPagesFile(root, ON)).toBe('unchanged')
    expect((await stat(file(root))).mtimeMs).toBe(before)
    // A change of the name style is a change.
    expect(await writeDailyPagesFile(root, { ...ON, dailyPageFormat: 'MMM D, YYYY', dailyPageDayFolder: true })).toBe('written')
    expect(await held(root)).toEqual({ enabled: true, folder: 'Daily', format: 'MMM D, YYYY', dayFolder: true })
  })

  it('turned off: the file says off; a second time writes nothing', async () => {
    const root = await vault('Daily')
    await writeDailyPagesFile(root, ON)
    expect(await writeDailyPagesFile(root, OFF)).toBe('written')
    expect(await held(root)).toEqual({ enabled: false, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false })
    expect(sanitizeDailyPages(await held(root))).toBeNull()
    expect(await writeDailyPagesFile(root, OFF)).toBe('not-needed')
  })

  it('a plain vault: off makes no file and no .yaseendocs folder', async () => {
    const root = await vault('Notes')
    expect(await writeDailyPagesFile(root, OFF)).toBe('not-needed')
    expect(await readdir(root)).toEqual(['Notes'])
  })

  it('on, but the vault does not hold the folder: no file; one that said on is turned off', async () => {
    const other = await vault('Notes')
    expect(await writeDailyPagesFile(other, ON)).toBe('not-needed')
    expect(await readdir(other)).toEqual(['Notes'])
    // The folder moved to another vault: this one's file goes off.
    const was = await vault('Journal')
    await writeDailyPagesFile(was, { ...ON, dailyPageFolder: 'Journal' })
    expect(await writeDailyPagesFile(was, ON)).toBe('written')
    expect(await held(was)).toMatchObject({ enabled: false })
  })

  it("the vault folder ('') is in every vault; a nested folder must be a folder", async () => {
    const root = await vault('Life/Daily')
    expect(await writeDailyPagesFile(root, { ...ON, dailyPageFolder: '' })).toBe('written')
    expect(await held(root)).toMatchObject({ enabled: true, folder: '' })
    expect(await writeDailyPagesFile(root, { ...ON, dailyPageFolder: 'Life/Daily' })).toBe('written')
    expect(await held(root)).toMatchObject({ enabled: true, folder: 'Life/Daily' })
    await writeFile(path.join(root, 'Plain'), 'not a folder')
    expect(await writeDailyPagesFile(root, { ...ON, dailyPageFolder: 'Plain' })).toBe('written')
    expect(await held(root)).toMatchObject({ enabled: false })
  })

  it('a file that is not JSON is left as it is', async () => {
    const root = await vault('Daily')
    await mkdir(path.join(root, '.yaseendocs'))
    await writeFile(file(root), '{ half')
    expect(await writeDailyPagesFile(root, ON)).toBe('malformed')
    expect(await readFile(file(root), 'utf8')).toBe('{ half')
  })
})

describe('keepDailyPagesFiles', () => {
  function fakeStore(settings: Partial<AppState['settings']>, windowRoots: string[][]) {
    let state = { settings: { ...DEFAULT_SETTINGS, ...settings }, windows: windowRoots.map((r, i) => ({ id: `w${i}`, roots: r })), folders: {} } as unknown as AppState
    const listeners = new Set<(s: AppState) => void>()
    return {
      get: () => state,
      onChange: (l: (s: AppState) => void) => (listeners.add(l), () => listeners.delete(l)),
      set(next: Partial<AppState>) {
        state = { ...state, ...next } as AppState
        for (const l of listeners) l(state)
      },
    }
  }

  it('at start, each open vault; then a settings change; then a vault that opens', async () => {
    const daily = await vault('Daily')
    const plain = await vault('Notes')
    const store = fakeStore({ ...ON }, [[daily, plain]])
    const keep = keepDailyPagesFiles(store)
    await keep.idle()
    expect(await held(daily)).toMatchObject({ enabled: true, folder: 'Daily' })
    expect(await readdir(plain)).toEqual(['Notes'])

    store.set({ settings: { ...store.get().settings, dailyPages: false } })
    await keep.idle()
    expect(await held(daily)).toMatchObject({ enabled: false })

    const later = await vault('Daily')
    store.set({ settings: { ...store.get().settings, dailyPages: true }, windows: [{ id: 'w0', roots: [daily] }, { id: 'w1', roots: [later] }] } as Partial<AppState>)
    await keep.idle()
    expect(await held(later)).toMatchObject({ enabled: true })
    expect(await held(daily)).toMatchObject({ enabled: true })
    keep.stop()
  })

  it('another change of the app state (not Daily pages, not the vaults) writes nothing', async () => {
    const daily = await vault('Daily')
    const store = fakeStore({ ...ON }, [[daily]])
    const write = vi.fn(async () => 'unchanged' as const)
    const keep = keepDailyPagesFiles(store, write)
    await keep.idle()
    expect(write).toHaveBeenCalledTimes(1)
    store.set({ settings: { ...store.get().settings, spellcheck: !store.get().settings.spellcheck } } as Partial<AppState>)
    await keep.idle()
    expect(write).toHaveBeenCalledTimes(1)
    keep.stop()
  })
})
