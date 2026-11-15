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
