import { stat } from 'node:fs/promises'
import path from 'node:path'
import { DAILY_PAGES_FILE } from '@shared/dailyPagesFile'
import { isRecord } from '@shared/guards'
import { placeVaults, type AppState, type SettingsState } from '@shared/types'
import { readConfigDetailed, writeConfig } from './vaultConfig'

/**
 * THE MAC WRITES THE VAULT'S DAILY PAGES FILE (YAZ-5476, under Yaseen's "save as much in the vault"):
 * `<root>/.yaseendocs/daily-pages.json`, the file the phone reads (`shared/dailyPagesFile.ts`, YAZ-5470) to show its
 * Today button and find the daily notes.
 *
 * Daily pages stay a setting of the app (`SettingsState.dailyPages` and the three rows under it, YAZ-3607): one switch
 * and one folder, found in whichever vault of a window holds it (`dailyPageVault`). This file MIRRORS them, per vault:
 *
 *  - Daily pages on, and the vault holds the folder (a folder on disk; '' = the vault folder, in every vault):
 *    `{ enabled: true, folder, format, dayFolder }`.
 *  - Otherwise: the file is turned off (`enabled: false`), but only where it says on. A vault that never had one gets none.
 *
 * Written only when the value changes, through the vault-config door (`writeConfig`, as favorites and link pills are), so
 * every window hears it and GitHub sync carries it. A file that is not JSON is left as it is.
 */

export type DailyFields = Pick<SettingsState, 'dailyPages' | 'dailyPageFolder' | 'dailyPageFormat' | 'dailyPageDayFolder'>

export interface DailyPagesFileValue {
  enabled: boolean
  folder: string
  format: string
  dayFolder: boolean
}

export type DailyPagesWrite = 'written' | 'unchanged' | 'not-needed' | 'malformed'

/** The file's value for a vault: on when Daily pages are on and the vault holds the folder. */
export function dailyPagesValue(s: DailyFields, holds: boolean): DailyPagesFileValue {
  return { enabled: s.dailyPages && holds, folder: s.dailyPageFolder, format: s.dailyPageFormat, dayFolder: s.dailyPageDayFolder }
}

/** The vault at `root` holds the daily pages folder: '' is the vault folder; else a folder on disk inside the vault. */
export async function holdsDailyFolder(root: string, folder: string): Promise<boolean> {
  if (folder === '') return true
  if (folder.split('/').some((part) => part === '' || part === '.' || part === '..')) return false
  return stat(path.join(root, folder)).then(
    (s) => s.isDirectory(),
    () => false,
  )
}

const sameValue = (now: unknown, want: DailyPagesFileValue): boolean =>
  isRecord(now) && Object.keys(now).length === 4 && now.enabled === want.enabled && now.folder === want.folder && now.format === want.format && now.dayFolder === want.dayFolder

/** Brings `<root>/.yaseendocs/daily-pages.json` in line with the settings; writes only a change. */
export async function writeDailyPagesFile(root: string, s: DailyFields): Promise<DailyPagesWrite> {
  const want = dailyPagesValue(s, s.dailyPages && (await holdsDailyFolder(root, s.dailyPageFolder)))
  const now = await readConfigDetailed(root, DAILY_PAGES_FILE)
  if (now.state === 'malformed') return 'malformed'
  const saysOn = now.state === 'ok' && isRecord(now.value) && now.value.enabled === true
  if (!want.enabled && !saysOn) return 'not-needed'
  if (now.state === 'ok' && sameValue(now.value, want)) return 'unchanged'
  await writeConfig(root, DAILY_PAGES_FILE, want)
  return 'written'
}

/**
 * Keeps every open vault's file in line: at start, when a Daily pages setting changes, and when a vault opens. Writes
 * one after another, never two at once. Returns `stop`, and `idle` (resolves when no write waits: for tests).
 */
export function keepDailyPagesFiles(
  store: { get(): AppState; onChange(listener: (state: AppState) => void): () => void },
  write: (root: string, s: DailyFields) => Promise<DailyPagesWrite> = writeDailyPagesFile,
): { stop: () => void; idle: () => Promise<void> } {
  let last = ''
  let chain: Promise<void> = Promise.resolve()
  const sync = (state: AppState): void => {
    const { dailyPages, dailyPageFolder, dailyPageFormat, dailyPageDayFolder } = state.settings
    const fields: DailyFields = { dailyPages, dailyPageFolder, dailyPageFormat, dailyPageDayFolder }
    const roots = [...new Set(state.windows.flatMap((w) => placeVaults(state.folders, w.roots)))].sort()
    const key = JSON.stringify([fields, roots])
    if (key === last) return
    last = key
    chain = chain.then(async () => {
      for (const root of roots) {
        await write(root, fields).catch((err: unknown) => console.warn(`[dailyPages] could not write ${DAILY_PAGES_FILE} in ${root}: ${String(err)}`))
      }
    })
  }
  const stop = store.onChange(sync)
  sync(store.get())
  return { stop, idle: () => chain }
}
