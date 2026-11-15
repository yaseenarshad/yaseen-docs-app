import { stat } from 'node:fs/promises'
import path from 'node:path'
import { DAILY_PAGES_FILE, DAILY_PAGES_KEYS, dailyPagesFile, dailyPagesOfSettings, readDailyPagesFile, windowDailyPages, type DailyPagesSettings } from '@shared/dailyPagesFile'
import { placeVaults, type AppState, type SettingsState } from '@shared/types'
import { readConfigDetailed, subscribeConfig } from './vaultConfig'
import { seedVaultPart, type MoveStep, type SeedResult, type SeedStore } from './vaultSettingsMove'

/**
 * DAILY PAGES LIVE IN THE VAULT (YAZ-5491; YAZ-5476 made the file, YAZ-5470 the phone's reader): `<root>/.yaseendocs/
 * daily-pages.json` is the ONE source. Settings › Daily pages writes it (the renderer, `useDailyPages`), and the menu
 * item, ⌘D, Go to, the hotkeys row, the CLI and the window's choice of vault read it (`windowDailyPages`).
 *
 * YAZ-5476 mirrored the app setting into every open vault on every change. That had three gaps, closed here by a
 * ONE-TIME MOVE in its place (`seedVaultPart`, the rules of `textFormattingMove.ts`):
 *  - A `''` folder (the vault folder) wrote an "on" file into EVERY vault. Now only the vault that holds the daily
 *    folder for its window is seeded: the first of the window's vaults that holds it ('' is the first vault), and only
 *    when no vault of that window has a file.
 *  - A deleted file came back at the next change. Now a vault is seeded once per Mac (`seededVaultConfig`).
 *  - Two Macs with different app values flipped the file back and forth. Now only a person's change in Settings writes
 *    it, and the seed waits for the vault's first pull and never writes over a file.
 * The app value stays: the fallback for a window with no file, and for the CLI on a vault with no file.
 */

export type DailyFields = Pick<SettingsState, 'dailyPages' | 'dailyPageFolder' | 'dailyPageFormat' | 'dailyPageDayFolder'>

/** The vault at `root` holds the daily pages folder: '' is the vault folder; else a folder on disk inside the vault. */
export async function holdsDailyFolder(root: string, folder: string): Promise<boolean> {
  if (folder === '') return true
  if (folder.split('/').some((part) => part === '' || part === '.' || part === '..')) return false
  return stat(path.join(root, folder)).then(
    (s) => s.isDirectory(),
    () => false,
  )
}

/** A vault's file as the Mac reads it: null when there is none; one that is not valid JSON says off. */
export async function readDailyPages(root: string): Promise<DailyPagesSettings | null> {
  const read = await readConfigDetailed(root, DAILY_PAGES_FILE).catch(() => ({ state: 'absent' as const }))
  if (read.state === 'absent') return null
  return readDailyPagesFile(read.state === 'ok' ? read.value : null)
}

/**
 * The one-time move for ONE window's vaults (in the window's order): the app value goes into the vault that holds the
 * daily folder, when Daily pages are on and no vault of the window has a file. 'default' when there is nothing to move.
 */
export async function seedWindowDailyPages(roots: readonly string[], s: DailyFields, store: SeedStore, canSeed?: (root: string) => Promise<boolean>): Promise<{ root: string | null; result: SeedResult }> {
  if (!s.dailyPages) return { root: null, result: 'default' }
  const files = await Promise.all(roots.map(readDailyPages))
  const withFile = roots.filter((_, i) => files[i] !== null)
  // A vault of the window has a file: the window reads the files; noted so a later deletion is not undone.
  for (const root of withFile) store.markSeededConfig(root, DAILY_PAGES_FILE)
  if (withFile.length > 0) return { root: null, result: 'present' }
  let holder: string | null = null
  for (const root of roots) {
    if (await holdsDailyFolder(root, s.dailyPageFolder)) {
      holder = root
      break
    }
  }
  if (holder === null) return { root: null, result: 'default' }
  return { root: holder, result: await seedVaultPart(holder, DAILY_PAGES_FILE, dailyPagesFile(dailyPagesOfSettings(s)), DAILY_PAGES_KEYS, store, canSeed) }
}

/** The move of Daily pages (`moveSettingsIntoVaults`): a change of the switch or the folder runs it again. */
export const DAILY_PAGES_MOVE: MoveStep = {
  name: DAILY_PAGES_FILE,
  key: (s) => [s.dailyPages, s.dailyPageFolder],
  run: (roots, s, store, canSeed) => seedWindowDailyPages(roots, s, store, canSeed),
}

/**
 * Main's own view of the open vaults' files, for File › Open Today's Daily Page (the menu shows it for the window in
 * front, by `windowDailyPages`). Read when a vault opens, again when its file changes; `onChange` hears a change.
 */
export interface DailyPagesWatch {
  /** Daily pages are on for a window of these vaults (in its order). */
  on: (roots: readonly string[], app: DailyFields) => boolean
  stop: () => void
}

export function watchDailyPages(store: { get(): AppState; onChange(listener: (state: AppState) => void): () => void }, onChange: () => void, subscribe: typeof subscribeConfig = subscribeConfig): DailyPagesWatch {
  const files = new Map<string, DailyPagesSettings | null>()
  const subs = new Map<string, () => void>()
  const load = (root: string): void => {
    void readDailyPages(root).then((file) => {
      if (!subs.has(root)) return
      const was = files.get(root)
      files.set(root, file)
      if (JSON.stringify(was) !== JSON.stringify(file)) onChange()
    })
  }
  const sync = (state: AppState): void => {
    const roots = new Set(state.windows.flatMap((w) => placeVaults(state.folders, w.roots)))
    for (const [root, off] of subs) {
      if (roots.has(root)) continue
      off()
      subs.delete(root)
      files.delete(root)
    }
    for (const root of roots) {
      if (subs.has(root)) continue
      subs.set(
        root,
        subscribe(root, (c) => {
          if (c.name === DAILY_PAGES_FILE) load(root)
        }),
      )
      load(root)
    }
  }
  const stopStore = store.onChange(sync)
  sync(store.get())
  return {
    on: (roots, app) => windowDailyPages(roots.map((root) => ({ root, file: files.get(root) ?? null })), dailyPagesOfSettings(app)).settings.enabled,
    stop: () => {
      stopStore()
      for (const off of subs.values()) off()
      subs.clear()
    },
  }
}
