import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sanitizeDailyPages } from '@shared/dailyPagesFile'
import { DEFAULT_SETTINGS, type AppState, type VaultConfigChange } from '@shared/types'
import { DAILY_PAGES_MOVE, holdsDailyFolder, readDailyPages, seedWindowDailyPages, watchDailyPages, type DailyFields } from './dailyPagesVaultFile'
import { moveSettingsIntoVaults, seedVaultPart } from './vaultSettingsMove'

/**
 * YAZ-5491: daily-pages.json is the one source. The app value moves ONCE into the vault that holds the daily folder of
 * each window (the gaps of the YAZ-5476 mirror closed), and main reads the files for the menu.
 */

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
const put = async (root: string, text: string) => {
  await mkdir(path.join(root, '.yaseendocs'), { recursive: true })
  await writeFile(file(root), text)
}
const ON: DailyFields = { dailyPages: true, dailyPageFolder: 'Daily', dailyPageFormat: 'YYYY-MM-DD', dailyPageDayFolder: false }
const OFF: DailyFields = { ...ON, dailyPages: false }

/** The seeded marks of the app state, as the store keeps them. */
function marks() {
  const seen = new Map<string, Set<string>>()
  return {
    seededConfig: (root: string, name: string) => seen.get(root)?.has(name) === true,
    markSeededConfig: (root: string, name: string) => void seen.set(root, new Set([...(seen.get(root) ?? []), name])),
  }
}

describe('seedVaultPart (the move rules)', () => {
  it('absent: written once; deleted later, it does not come back', async () => {
    const root = await vault()
    const m = marks()
    expect(await seedVaultPart(root, 'x.json', { version: 1, a: 1 }, ['a'], m)).toBe('written')
    expect(JSON.parse(await readFile(path.join(root, '.yaseendocs', 'x.json'), 'utf8'))).toEqual({ version: 1, a: 1 })
    await unlink(path.join(root, '.yaseendocs', 'x.json'))
    expect(await seedVaultPart(root, 'x.json', { version: 1, a: 1 }, ['a'], m)).toBe('seeded-before')
  })

  it('present with the part: left alone; present without it: the part is added and the other keys stay', async () => {
    const root = await vault()
    await mkdir(path.join(root, '.yaseendocs'))
    await writeFile(path.join(root, '.yaseendocs', 'x.json'), '{"a":5}')
    expect(await seedVaultPart(root, 'x.json', { a: 1 }, ['a'], marks())).toBe('present')
    await writeFile(path.join(root, '.yaseendocs', 'y.json'), '{"version":1,"h2":{"size":20}}')
    expect(await seedVaultPart(root, 'y.json', { version: 2, b: { x: 1 } }, ['b'], marks())).toBe('written')
    expect(JSON.parse(await readFile(path.join(root, '.yaseendocs', 'y.json'), 'utf8'))).toEqual({ version: 2, h2: { size: 20 }, b: { x: 1 } })
  })

  it('malformed: never written', async () => {
    const root = await vault()
    await put(root, '{ not json')
    expect(await seedVaultPart(root, 'daily-pages.json', { a: 1 }, ['a'], marks())).toBe('malformed')
    expect(await readFile(file(root), 'utf8')).toBe('{ not json')
  })

  it('not a folder now: skipped, and nothing is made there', async () => {
    const root = path.join(tmpdir(), `yd-gone-${Date.now()}`)
    expect(await seedVaultPart(root, 'x.json', { a: 1 }, ['a'], marks())).toBe('unreachable')
    await expect(stat(root)).rejects.toThrow()
  })

  it('the default (null): nothing written and nothing noted, so a later value still moves', async () => {
    const root = await vault()
    const m = marks()
    expect(await seedVaultPart(root, 'x.json', null, ['a'], m)).toBe('default')
    expect(await readdir(root)).toEqual([])
    expect(await seedVaultPart(root, 'x.json', { a: 1 }, ['a'], m)).toBe('written')
  })

  it('before the first pull: not yet', async () => {
    const root = await vault()
    expect(await seedVaultPart(root, 'x.json', { a: 1 }, ['a'], marks(), async () => false)).toBe('not-yet')
    expect(await readdir(root)).toEqual([])
  })
})

describe('seedWindowDailyPages', () => {
  it('only the vault that holds the folder, in the phone\'s format', async () => {
    const plain = await vault('Notes')
    const daily = await vault('Daily')
    expect(await seedWindowDailyPages([plain, daily], ON, marks())).toEqual({ root: daily, result: 'written' })
    expect(await held(daily)).toEqual({ version: 1, enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false })
    expect(sanitizeDailyPages(await held(daily))).toEqual({ folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false })
    expect(await readdir(plain)).toEqual(['Notes'])
  })

  it("'' (the vault folder) seeds the FIRST vault only, not every vault", async () => {
    const a = await vault('Notes')
    const b = await vault('Notes')
    expect((await seedWindowDailyPages([a, b], { ...ON, dailyPageFolder: '' }, marks())).root).toBe(a)
    expect(await readdir(b)).toEqual(['Notes'])
  })

  it('off (the default) moves nothing; a window with a file in any vault moves nothing', async () => {
    const daily = await vault('Daily')
    expect((await seedWindowDailyPages([daily], OFF, marks())).result).toBe('default')
    expect(await readdir(daily)).toEqual(['Daily'])
    const other = await vault()
    await put(other, '{"enabled":false}')
    expect((await seedWindowDailyPages([daily, other], ON, marks())).result).toBe('present')
    expect(await readdir(daily)).toEqual(['Daily'])
  })

  it('no vault holds the folder: nothing', async () => {
    const plain = await vault('Notes')
    expect(await seedWindowDailyPages([plain], ON, marks())).toEqual({ root: null, result: 'default' })
  })

  it('readDailyPages: null when absent; a file that is not JSON says off', async () => {
    const root = await vault()
    expect(await readDailyPages(root)).toBeNull()
    await put(root, 'nope')
    expect(await readDailyPages(root)).toMatchObject({ enabled: false })
    expect(await holdsDailyFolder(root, '../x')).toBe(false)
  })
})

function fakeStore(settings: Partial<AppState['settings']>, windowRoots: string[][]) {
  let state = { settings: { ...DEFAULT_SETTINGS, ...settings }, windows: windowRoots.map((r, i) => ({ id: `w${i}`, roots: r })), folders: {} } as unknown as AppState
  const listeners = new Set<(s: AppState) => void>()
  return {
    ...marks(),
    get: () => state,
    onChange: (l: (s: AppState) => void) => (listeners.add(l), () => listeners.delete(l)),
    set(next: Partial<AppState>) {
      state = { ...state, ...next } as AppState
      for (const l of listeners) l(state)
    },
  }
}

describe('moveSettingsIntoVaults with DAILY_PAGES_MOVE', () => {
  it('a settings change alone writes nothing (two Macs never flip it); a vault that opens later is seeded', async () => {
    const daily = await vault('Daily')
    const store = fakeStore({ ...ON }, [[daily]])
    const move = moveSettingsIntoVaults(store, [DAILY_PAGES_MOVE])
    await move.idle()
    expect(await held(daily)).toMatchObject({ enabled: true, folder: 'Daily' })
    store.set({ settings: { ...store.get().settings, dailyPageFormat: 'MM_DD', dailyPages: false } })
    await move.idle()
    expect(await held(daily)).toMatchObject({ enabled: true, format: 'YYYY-MM-DD' })
    const later = await vault('Daily')
    store.set({ settings: { ...store.get().settings, dailyPages: true }, windows: [{ id: 'w0', roots: [daily] }, { id: 'w1', roots: [later] }] } as Partial<AppState>)
    await move.idle()
    expect(await held(later)).toMatchObject({ enabled: true, format: 'MM_DD' })
    move.stop()
  })

  it('a deleted file does not come back', async () => {
    const daily = await vault('Daily')
    const store = fakeStore({ ...ON }, [[daily]])
    const move = moveSettingsIntoVaults(store, [DAILY_PAGES_MOVE])
    await move.idle()
    await unlink(file(daily))
    store.set({ windows: [{ id: 'w0', roots: [daily] }, { id: 'w1', roots: [] }] } as unknown as Partial<AppState>)
    move.pulled(daily)
    await move.idle()
    await expect(stat(file(daily))).rejects.toThrow()
    move.stop()
  })

  it('a vault whose first pull is not done gets its file when the pull is done', async () => {
    const daily = await vault('Daily')
    const store = fakeStore({ ...ON }, [[daily]])
    let pulled = false
    const move = moveSettingsIntoVaults(store, [DAILY_PAGES_MOVE], async () => pulled)
    await move.idle()
    expect(await readdir(daily)).toEqual(['Daily'])
    pulled = true
    move.pulled(daily)
    await move.idle()
    expect(await held(daily)).toMatchObject({ version: 1, enabled: true })
    move.stop()
  })
})

describe('watchDailyPages (the menu)', () => {
  it('on by the window\'s files, else the app value; a file change is heard', async () => {
    const a = await vault()
    const b = await vault()
    await put(b, '{"enabled":true,"folder":""}')
    const store = fakeStore({ ...OFF }, [[a, b]])
    let hear: ((c: VaultConfigChange) => void) | null = null
    const changed = vi.fn()
    const watch = watchDailyPages(store, changed, (root, l) => {
      if (root === b) hear = l
      return () => undefined
    })
    await vi.waitFor(() => expect(watch.on([a, b], OFF)).toBe(true))
    expect(watch.on([a], OFF)).toBe(false)
    expect(watch.on([a], ON)).toBe(true)
    await put(b, '{"enabled":false}')
    hear!({ root: b, name: 'daily-pages.json' })
    await vi.waitFor(() => expect(watch.on([a, b], ON)).toBe(false))
    expect(changed).toHaveBeenCalled()
    watch.stop()
  })
})
