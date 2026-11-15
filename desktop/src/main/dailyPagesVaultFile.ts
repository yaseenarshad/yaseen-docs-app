import { stat } from 'node:fs/promises'
import path from 'node:path'
import { DAILY_PAGES_FILE, DAILY_PAGES_VERSION } from '@shared/dailyPagesFile'
import { isRecord } from '@shared/guards'
import { placeVaults, type AppState, type SettingsState } from '@shared/types'
import { readConfigDetailed, writeConfig } from './vaultConfig'

/**
 * THE MAC WRITES THE VAULT'S DAILY PAGES FILE (YAZ-5476, under Yaseen's "save as much in the vault"):
 * `<root>/.yaseendocs/daily-pages.json`, the file the phone reads (`shared/dailyPagesFile.ts`, YAZ-5470) to show its
 * Today button and find the daily notes.
 *
 * Daily pages stay a setting of the app (`SettingsState.dailyPages` and the three rows under it, YAZ-3607): one switch
 * and one folder, found in whichever vault of a window holds it (`dailyPageVault`). The app value stays the source and
 * the fallback; this file MIRRORS it, per vault:
 *
 *  - Daily pages on, and the vault holds the folder (a folder on disk; '' = the vault folder, in every vault):
 *    `{ version: 1, enabled: true, folder, format, dayFolder }`.
 *  - Otherwise: the file is turned off (`enabled: false`), but only where it says on.
 *
 * The rules of the vault settings move (`vault-settings-scope.md` § 6, as `textFormattingMove.ts`):
 *  - A NEW file (a seed) only when the vault has none, the value is not the default (Daily pages on), and the vault's
 *    first pull is done (`canSeed`: its sync pass ended `synced`, or its sync is off), so two Macs never both create it.
 *  - A root that is not a folder now (a drive not connected) is skipped: `writeConfig` would make the folder again.
 *  - A file that is not JSON is left as it is. A write keeps the top-level keys it does not know.
 *  - Written only when the value changes, through the vault-config door (`writeConfig`, as favorites and link pills
 *    are), so every window hears it and GitHub sync carries it.
 */

export type DailyFields = Pick<SettingsState, 'dailyPages' | 'dailyPageFolder' | 'dailyPageFormat' | 'dailyPageDayFolder'>

export interface DailyPagesFileValue {
  version: typeof DAILY_PAGES_VERSION
  enabled: boolean
  folder: string
  format: string
  dayFolder: boolean
}

export type DailyPagesWrite = 'written' | 'unchanged' | 'not-needed' | 'not-yet' | 'unreachable' | 'malformed'

/** The file's value for a vault: on when Daily pages are on and the vault holds the folder. */
export function dailyPagesValue(s: DailyFields, holds: boolean): DailyPagesFileValue {
  return { version: DAILY_PAGES_VERSION, enabled: s.dailyPages && holds, folder: s.dailyPageFolder, format: s.dailyPageFormat, dayFolder: s.dailyPageDayFolder }
}

/** The vault at `root` holds the daily pages folder: '' is the vault folder; else a folder on disk inside the vault. */
export async function holdsDailyFolder(root: string, folder: string): Promise<boolean> {
  if (folder === '') return true
  if (folder.split('/').some((part) => part === '' || part === '.' || part === '..')) return false
  return isFolder(path.join(root, folder))
}

const isFolder = (at: string): Promise<boolean> =>
  stat(at).then(
    (s) => s.isDirectory(),
    () => false,
  )

const KEYS = ['version', 'enabled', 'folder', 'format', 'dayFolder'] as const
const sameValue = (now: Record<string, unknown>, want: DailyPagesFileValue): boolean => KEYS.every((k) => now[k] === want[k])

/**
 * Brings `<root>/.yaseendocs/daily-pages.json` in line with the settings; writes only a change. `canSeed`: the vault's
 * first pull is done, so a file it lacks may be made (an update of a file it has needs no wait).
 */
export async function writeDailyPagesFile(root: string, s: DailyFields, canSeed: (root: string) => Promise<boolean> = async () => true): Promise<DailyPagesWrite> {
  if (!(await isFolder(root))) return 'unreachable'
  const want = dailyPagesValue(s, s.dailyPages && (await holdsDailyFolder(root, s.dailyPageFolder)))
  const now = await readConfigDetailed(root, DAILY_PAGES_FILE)
  if (now.state === 'malformed') return 'malformed'
  if (now.state === 'absent') {
    if (!want.enabled) return 'not-needed'
    if (!(await canSeed(root))) return 'not-yet'
    await writeConfig(root, DAILY_PAGES_FILE, want)
    return 'written'
  }
  const held = isRecord(now.value) ? now.value : {}
  if (!want.enabled && held.enabled !== true) return 'not-needed'
  if (sameValue(held, want)) return 'unchanged'
  await writeConfig(root, DAILY_PAGES_FILE, { ...held, ...want })
  return 'written'
}

export interface DailyPagesKeeper {
  stop: () => void
  /** The vault's first pull is done (its sync pass ended `synced`): a seed that waited for it is tried again. */
  pulled: (root: string) => void
  /** Resolves when no write waits: for tests. */
  idle: () => Promise<void>
}

/**
 * Keeps every open vault's file in line: at start, when a Daily pages setting changes, when a vault opens, and when a
 * vault's first pull is done. Writes one after another, never two at once.
 */
export function keepDailyPagesFiles(
  store: { get(): AppState; onChange(listener: (state: AppState) => void): () => void },
  canSeed: (root: string) => Promise<boolean> = async () => true,
  write: (root: string, s: DailyFields, canSeed: (root: string) => Promise<boolean>) => Promise<DailyPagesWrite> = writeDailyPagesFile,
): DailyPagesKeeper {
  let last = ''
  let chain: Promise<void> = Promise.resolve()
  let fields: DailyFields | null = null
  let open: readonly string[] = []
  const run = (roots: readonly string[], s: DailyFields): void => {
    chain = chain.then(async () => {
      for (const root of roots) {
        await write(root, s, canSeed).catch((err: unknown) => console.warn(`[dailyPages] could not write ${DAILY_PAGES_FILE} in ${root}: ${String(err)}`))
      }
    })
  }
  const sync = (state: AppState): void => {
    const { dailyPages, dailyPageFolder, dailyPageFormat, dailyPageDayFolder } = state.settings
    const next: DailyFields = { dailyPages, dailyPageFolder, dailyPageFormat, dailyPageDayFolder }
    const roots = [...new Set(state.windows.flatMap((w) => placeVaults(state.folders, w.roots)))].sort()
    const key = JSON.stringify([next, roots])
    if (key === last) return
    last = key
    fields = next
    open = roots
    run(roots, next)
  }
  const stop = store.onChange(sync)
  sync(store.get())
  return {
    stop,
    pulled: (root) => {
      if (fields !== null && open.includes(root)) run([root], fields)
    },
    idle: () => chain,
  }
}
