import { MOBILE_SETTINGS_FILE, sanitizeMobileSettings, withMobileSetting, type MobileSettingKey } from '@shared/mobileSettings'

/**
 * THE PHONE'S FIRST WRITE OF A VAULT SETTINGS FILE (YAZ-5592): Settings › "This vault on mobile" (Folding, Sticky
 * headings) writes `.yaseendocs/mobile.json` (`shared/mobileSettings.ts`). It goes the comments' safe path, as a page
 * setting does (`settingWrite.ts`): the list (IndexedDB, so a change is never lost), the send on the FRESH file (a sync
 * pass first), one commit with compare-and-swap, again on the newest file when the branch moved (a Mac's change of the
 * same file is kept: only this key is set, every other key stays), the dot.
 *
 * IDEMPOTENT: an entry says what the setting must BECOME, so a retry that finds it so writes nothing (`already`). A file
 * that is there and is not a JSON object is refused (`invalid`): nothing is written over it. No file: it is made. Pure.
 */
export interface VaultSetting {
  /** Which vault file: `mobile.json`. */
  file: 'mobile'
  key: MobileSettingKey
  on: boolean
}

/** The file's path in the vault (the vault-config door's folder). Spelled out: `@shared/types` is a large module. */
export const MOBILE_SETTINGS_PATH = `.yaseendocs/${MOBILE_SETTINGS_FILE}`

export type VaultSettingResult = { kind: 'set'; content: string } | { kind: 'already' } | { kind: 'refused'; why: 'invalid' }

/** A waiting entry's setting is the vault's (this file), not a page's. */
export const isVaultSetting = (setting: unknown): setting is VaultSetting => typeof setting === 'object' && setting !== null && (setting as { file?: unknown }).file === 'mobile'

/** What the file says now (null: no file; a file that does not read: the defaults). */
export function readMobileText(content: string | null): ReturnType<typeof sanitizeMobileSettings> {
  if (content === null) return sanitizeMobileSettings(undefined)
  try {
    return sanitizeMobileSettings(JSON.parse(content))
  } catch {
    return sanitizeMobileSettings(undefined)
  }
}

/** `content` (the file now; null: none) with `setting` set, or why not. */
export function applyVaultSetting(content: string | null, setting: VaultSetting): VaultSettingResult {
  if (readMobileText(content)[setting.key] === setting.on) return { kind: 'already' }
  try {
    return { kind: 'set', content: withMobileSetting(content, setting.key, setting.on) }
  } catch {
    return { kind: 'refused', why: 'invalid' }
  }
}
