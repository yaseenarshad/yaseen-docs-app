import { keepUnknownKeys } from './configMerge'
import { isRecord } from './guards'

/**
 * THE VAULT'S MOBILE SETTINGS (YAZ-5592), `<vault>/.yaseendocs/mobile.json`: how the vault reads on a phone or a tablet
 * (the `mobile/` app), the same for every phone that opens the vault. Read through the vault-config door like the other
 * settings files; the phone's Settings › "This vault on mobile" writes it (the phone's first write of a vault settings
 * file: its comments' safe path, `mobile/src/comments/mobileWrite.ts`). The Mac does not show it yet. Pure: no fs, no DOM.
 *
 *  - `folding` (default on): the pages fold (YAZ-5568). A page's own `folding: true | false` wins.
 *  - `stickyHeadings` (default on): the heading of the section being read sticks at the top (YAZ-5591). A page's own
 *    `sticky-headings: true | false` wins.
 *
 * The file holds only what differs from the defaults, beside a version: `{ "version": 1, "stickyHeadings": false }`. A
 * key left out is the default; a value that is not a boolean is the default too. Every other top-level key of the file
 * (a later build's) is kept on a write (`keepUnknownKeys`).
 */
export const MOBILE_SETTINGS_FILE = 'mobile.json'
export const MOBILE_SETTINGS_VERSION = 1

export interface MobileSettings {
  folding: boolean
  stickyHeadings: boolean
}
export type MobileSettingKey = keyof MobileSettings

export const DEFAULT_MOBILE_SETTINGS: Readonly<MobileSettings> = Object.freeze({ folding: true, stickyHeadings: true })
/** The keys this build's writer owns: every other key of the file is kept on a write. */
export const MOBILE_SETTINGS_KEYS: readonly string[] = ['version', 'folding', 'stickyHeadings']
const SETTING_KEYS: readonly MobileSettingKey[] = ['folding', 'stickyHeadings']

/** What the file holds, the default for anything else (no file, not JSON, not an object, not a boolean). */
export function sanitizeMobileSettings(raw: unknown): MobileSettings {
  const held = isRecord(raw) ? raw : {}
  const out = { ...DEFAULT_MOBILE_SETTINGS }
  for (const key of SETTING_KEYS) if (typeof held[key] === 'boolean') out[key] = held[key]
  return out
}

/** The file's value for `settings`: the version, and only what differs from the defaults. */
export function mobileSettingsValue(settings: MobileSettings): Record<string, unknown> {
  const out: Record<string, unknown> = { version: MOBILE_SETTINGS_VERSION }
  for (const key of SETTING_KEYS) if (settings[key] !== DEFAULT_MOBILE_SETTINGS[key]) out[key] = settings[key]
  return out
}

/**
 * The file's text with `key` set to `on`, from the file's text now (null: no file). Every other key stays: the other
 * setting as the file says it, and each key this build does not know, as it is. A version the file holds that is newer
 * than this build's stays. Pretty-printed as the Mac's vault-config door writes (`JSON.stringify(value, null, 2)` and a
 * line end). Throws on a file that is there and is not a JSON object: nothing is written over it.
 */
export function withMobileSetting(text: string | null, key: MobileSettingKey, on: boolean): string {
  let raw: unknown = undefined
  if (text !== null && text.trim() !== '') {
    raw = JSON.parse(text)
    if (!isRecord(raw)) throw new Error(`${MOBILE_SETTINGS_FILE} is not a JSON object`)
  }
  const value = mobileSettingsValue({ ...sanitizeMobileSettings(raw), [key]: on })
  const version = isRecord(raw) && typeof raw.version === 'number' && raw.version > MOBILE_SETTINGS_VERSION ? raw.version : MOBILE_SETTINGS_VERSION
  // The file's own key order first (its unknown keys where they stood), then any key that is new.
  const merged = keepUnknownKeys(raw, { ...value, version }, MOBILE_SETTINGS_KEYS) as Record<string, unknown>
  const order = isRecord(raw) ? Object.keys(raw).filter((k) => Object.hasOwn(merged, k)) : []
  const out: Record<string, unknown> = {}
  for (const k of [...order, ...Object.keys(merged)]) if (!Object.hasOwn(out, k)) out[k] = merged[k]
  return `${JSON.stringify(out, null, 2)}\n`
}
