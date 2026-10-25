/**
 * THE SETTINGS FOLDER'S RULES (YAZ-3276 D3). Pure: `desktop/src/main/settingsFolder.ts` reads and writes the files.
 *
 * Each Mac writes only `settings-<Mac ID>.json`, so a sync tool never has two writers on one file and git
 * never gets a conflict. The newest file wins as a whole: one person rarely changes settings on two Macs
 * between two syncs, and when they do, the older change goes back where they can see it (the accepted case).
 */
import { isFiniteNumber, isRecord } from './guards'
import { LOCAL_SETTINGS, type SettingsState } from './types'

/** `settings-<12 a-z 0-9>.json` only (the `macId` shape): a copy (`settings-x 2.json`, `.sync-conflict-…`) never counts. */
export const SETTINGS_FILE_RE = /^settings-[0-9a-z]{12}\.json$/

export const settingsFileName = (macId: string): string => `settings-${macId}.json`

/** One Mac's file in the settings folder. */
export interface SettingsFile {
  /** The host name, for a person who reads the folder. The rules never use it. */
  name: string
  /** When that Mac's settings were saved: the `settingsSavedAt` it had. */
  savedAt: number
  /** The fields that travel. A field can be missing, or one that this build can't read. */
  settings: Partial<Record<keyof SettingsState, unknown>>
}

/** True for a field that goes into the folder (D1): all of them but `LOCAL_SETTINGS`. */
export const travels = (key: string): boolean => !(LOCAL_SETTINGS as readonly string[]).includes(key)

/** True when a field that travels is different. A change of a local field is not a new save. */
export const travellingChanged = (a: SettingsState, b: SettingsState): boolean =>
  (Object.keys(b) as (keyof SettingsState)[]).some((key) => travels(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key]))

/** The fields of `settings` that travel: what this Mac writes in its file. */
const travellingSettings = (settings: SettingsState): Partial<SettingsState> =>
  Object.fromEntries(Object.entries(settings).filter(([key]) => travels(key))) as Partial<SettingsState>

/** A file's text as a file, or null when it is not one: bad JSON (a half-synced file), or no `savedAt`. */
export function parseSettingsFile(text: string): SettingsFile | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || !isFiniteNumber(raw.savedAt) || !isRecord(raw.settings)) return null
  return { name: typeof raw.name === 'string' ? raw.name : '', savedAt: raw.savedAt, settings: raw.settings }
}

/** The pretty-printed text of this Mac's file. The same settings and time give the same text, so a write can be skipped. */
export const settingsFileText = (name: string, savedAt: number, settings: SettingsState): string =>
  `${JSON.stringify({ name, savedAt, settings: travellingSettings(settings) }, null, 2)}\n`

/** The file with the highest `savedAt` above `savedAt`, or null: a tie or an older file changes nothing. */
export const newestFile = (files: readonly SettingsFile[], savedAt: number): SettingsFile | null =>
  files.reduce<SettingsFile | null>((best, file) => (file.savedAt > (best?.savedAt ?? savedAt) ? file : best), null)
