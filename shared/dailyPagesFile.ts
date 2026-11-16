/**
 * THE VAULT'S DAILY PAGES, AS A FILE (YAZ-5470): `.yaseendocs/daily-pages.json`. The Mac keeps Daily pages
 * (`SettingsState.dailyPages`, `dailyPageFolder`, `dailyPageFormat`, `dailyPageDayFolder`; YAZ-3607) in its own settings,
 * not in the vault, and finds the vault of the daily pages by the folder (`dailyPageVault`). The phone has only the vault,
 * so it reads this file: the same four settings, for this vault.
 *
 *   { "version": 1, "enabled": true, "folder": "Daily", "format": "YYYY-MM-DD", "dayFolder": false }
 *
 * YAZ-5476: the Mac writes it (`desktop/src/main/dailyPagesVaultFile.ts`) and keeps any other top-level key. `version`
 * is the file's shape; a reader of this shape reads any version (a newer one adds keys, never changes these).
 *
 * No file, `enabled` not true, or a style the Mac could not use: Daily pages are off in this vault.
 */
import { DEFAULT_DAILY_PAGE_FORMAT, isValidDailyPageFormat } from './dailyPage'
import { isRecord } from './guards'

export const DAILY_PAGES_FILE = 'daily-pages.json'
/** The shape of the file the Mac writes. */
export const DAILY_PAGES_VERSION = 1

export interface VaultDailyPages {
  /** The daily pages folder, vault-relative ('' = the vault folder): the Mac's `dailyPageFolder`. */
  folder: string
  /** The name style (`shared/dailyPage.ts`): the Mac's `dailyPageFormat`. */
  format: string
  /** A folder for each day: the Mac's `dailyPageDayFolder`. */
  dayFolder: boolean
}

/** The file's settings, or null when Daily pages are off in this vault (or the file cannot be read as theirs). */
export function sanitizeDailyPages(raw: unknown): VaultDailyPages | null {
  if (!isRecord(raw) || raw.enabled !== true) return null
  const folder = typeof raw.folder === 'string' ? raw.folder.replace(/^\/+|\/+$/g, '') : ''
  const format = raw.format === undefined ? DEFAULT_DAILY_PAGE_FORMAT : raw.format
  if (typeof format !== 'string' || !isValidDailyPageFormat(format) || folder.split('/').some((p) => p === '..' || p.startsWith('.'))) return null
  return { folder, format, dayFolder: raw.dayFolder === true }
}

/**
 * YAZ-5491: THE FILE IS THE ONE SOURCE ON THE MAC TOO. Settings › Daily pages, File › Open Today's Daily Page, ⌘D,
 * Go to, the hotkeys row, the CLI and the window's choice of vault read the vault's file; Settings writes it. The app
 * value (`SettingsState.dailyPages` and the three rows under it) is only the fallback: for a window none of whose vaults
 * has the file yet (before the one-time move, `desktop/src/main/dailyPagesVaultFile.ts`), and for the CLI on a vault
 * with no file.
 */

/** The four settings of one vault, as the Mac reads them: off is a value too, so Settings can show what it turns on. */
export interface DailyPagesSettings {
  enabled: boolean
  folder: string
  format: string
  dayFolder: boolean
}

/** The top-level keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const DAILY_PAGES_KEYS: readonly string[] = ['version', 'enabled', 'folder', 'format', 'dayFolder']

/** Off, with the app's own folder and style: a file that is not valid JSON reads as this. */
export const DAILY_PAGES_OFF: DailyPagesSettings = /*#__PURE__*/ Object.freeze({ enabled: false, folder: '', format: DEFAULT_DAILY_PAGE_FORMAT, dayFolder: false })

const safeFolder = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const folder = v.replace(/^\/+|\/+$/g, '')
  return folder.split('/').some((p) => p === '..' || p.startsWith('.')) ? null : folder
}

/**
 * The file as the Mac uses it. Each field falls back alone (text-formatting S95): a bad folder is the vault folder, a
 * style the Mac cannot use is the default style, and anything but `true` is off. Unknown keys and `version` are ignored.
 */
export function readDailyPagesFile(raw: unknown): DailyPagesSettings {
  const r = isRecord(raw) ? raw : {}
  return {
    enabled: r.enabled === true,
    folder: safeFolder(r.folder) ?? '',
    format: typeof r.format === 'string' && isValidDailyPageFormat(r.format) ? r.format : DEFAULT_DAILY_PAGE_FORMAT,
    dayFolder: r.dayFolder === true,
  }
}

/** What a writer puts in the file: every field, so the phone (`sanitizeDailyPages`) reads it as it always has. */
export const dailyPagesFile = (s: DailyPagesSettings): Record<string, unknown> => ({ version: DAILY_PAGES_VERSION, enabled: s.enabled, folder: s.folder, format: s.format, dayFolder: s.dayFolder })

export const sameDailyPages = (a: DailyPagesSettings, b: DailyPagesSettings): boolean => a.enabled === b.enabled && a.folder === b.folder && a.format === b.format && a.dayFolder === b.dayFolder

/** The app's four fields (`SettingsState`), by the names they have there. */
export interface DailyPagesFields {
  dailyPages: boolean
  dailyPageFolder: string
  dailyPageFormat: string
  dailyPageDayFolder: boolean
}

/** The app value as a vault value: the fallback, and what the one-time move writes. */
export const dailyPagesOfSettings = (s: DailyPagesFields): DailyPagesSettings => ({ enabled: s.dailyPages, folder: s.dailyPageFolder, format: s.dailyPageFormat, dayFolder: s.dailyPageDayFolder })

/** `settings` with the four fields of `d`; the same object when they are already those. */
export function withDailyPages<T extends DailyPagesFields>(settings: T, d: DailyPagesSettings): T {
  if (sameDailyPages(dailyPagesOfSettings(settings), d)) return settings
  return { ...settings, dailyPages: d.enabled, dailyPageFolder: d.folder, dailyPageFormat: d.format, dailyPageDayFolder: d.dayFolder } as T
}

/**
 * A window's daily pages, from its vaults' files (in the window's order) and the app value:
 *  - The first vault whose file says on: its settings, in that vault (`root`).
 *  - Else, with a file in any vault: off. Settings shows the active vault's file (else the first file's) and acts there.
 *  - Else, no file at all: the app value, and the vault is found by the folder at the click (`dailyPageVault`), as
 *    before the move. `root` is null.
 * `file` null: the vault has no file. A file that is not valid JSON counts as a file that says off (`DAILY_PAGES_OFF`).
 */
export interface WindowDailyPages {
  settings: DailyPagesSettings
  /** The vault whose file this is; null for the app value. */
  root: string | null
}

export function windowDailyPages(vaults: ReadonlyArray<{ root: string; file: DailyPagesSettings | null }>, app: DailyPagesSettings, active: string | null = null): WindowDailyPages {
  const on = vaults.find((v) => v.file?.enabled === true)
  if (on !== undefined) return { settings: on.file!, root: on.root }
  const held = vaults.filter((v) => v.file !== null)
  if (held.length === 0) return { settings: app, root: null }
  const shown = held.find((v) => v.root === active) ?? held[0]
  return { settings: shown.file!, root: shown.root }
}
