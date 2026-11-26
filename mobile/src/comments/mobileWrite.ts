import { isRecord } from '@shared/guards'
import { MOBILE_SETTINGS_FILE, sanitizeMobileSettings, type MobileSettingKey } from '@shared/mobileSettings'
import { VAULT_SETTINGS_FILE, VAULT_SETTINGS_VERSION, readVaultSection, withMobileSettingInVaultSettings } from '@shared/vaultSettings'

/**
 * THE PHONE'S WRITE OF VAULT MOBILE SETTINGS (YAZ-5592, unified in YAZ-6557 / YAZ-6546): Settings › "This vault on
 * mobile" (Folding, Sticky headings, Wide tables, Title room) writes the `mobile` section of `.yaseendocs/settings.json`
 * (`withMobileSettingInVaultSettings`), preserving every other key and section of `settings.json`. It goes the
 * comments' safe path, as a page setting does (`settingWrite.ts`): IndexedDB outbox, compare-and-swap commit on the
 * fresh file, retry on race, never losing another device's changes.
 *
 * IDEMPOTENT: an entry says what the setting must BECOME, so a retry that finds it so writes nothing (`already`). A
 * `settings.json` that exists and is not a JSON object is refused (`invalid`): nothing is written over it. No file: it
 * is created. Pure.
 */
export interface VaultSetting {
  /** Which vault section: `mobile` inside `settings.json`. */
  file: 'mobile'
  key: MobileSettingKey
  on: boolean
}

/** The unified vault settings file path where mobile writes go (`.yaseendocs/settings.json`). */
export const MOBILE_SETTINGS_PATH = `.yaseendocs/${VAULT_SETTINGS_FILE}`
/** Legacy mobile settings file path (`.yaseendocs/mobile.json`), read as fallback when `settings.json` has no `mobile` section. */
export const LEGACY_MOBILE_SETTINGS_PATH = `.yaseendocs/${MOBILE_SETTINGS_FILE}`

export type VaultSettingResult = { kind: 'set'; content: string } | { kind: 'already' } | { kind: 'refused'; why: 'invalid' }

/** A waiting entry's setting is the vault's mobile setting, not a page's. */
export const isVaultSetting = (setting: unknown): setting is VaultSetting => typeof setting === 'object' && setting !== null && (setting as { file?: unknown }).file === 'mobile'

/**
 * What the vault's mobile settings say now: reads `settings.json`'s `mobile` section first, falling back to legacy
 * `mobile.json` (`legacyContent`) when `settings.json` is absent or has no `mobile` section.
 */
export function readMobileText(content: string | null, legacyContent: string | null = null): ReturnType<typeof sanitizeMobileSettings> {
  if (content !== null && content.trim() !== '') {
    try {
      const section = readVaultSection(JSON.parse(content), 'mobile')
      if (section !== null) return sanitizeMobileSettings(section)
    } catch {
      // Fall through to legacy / defaults when `settings.json` is unreadable.
    }
  }
  if (legacyContent !== null && legacyContent.trim() !== '') {
    try {
      return sanitizeMobileSettings(JSON.parse(legacyContent))
    } catch {
      return sanitizeMobileSettings(undefined)
    }
  }
  return sanitizeMobileSettings(undefined)
}

/**
 * `content` (current `.yaseendocs/settings.json`; null: none yet) with `setting` applied to its `mobile` section,
 * preserving every other key in `settings.json` (and seeding from `legacyContent` if `settings.json` has no `mobile`
 * section yet), or why not.
 */
export function applyVaultSetting(content: string | null, setting: VaultSetting, legacyContent: string | null = null): VaultSettingResult {
  let parsed: unknown = undefined
  if (content !== null && content.trim() !== '') {
    try {
      parsed = JSON.parse(content)
    } catch {
      return { kind: 'refused', why: 'invalid' }
    }
    if (!isRecord(parsed)) return { kind: 'refused', why: 'invalid' }
  }
  const hasSection = readVaultSection(parsed, 'mobile') !== null
  if (readMobileText(content, hasSection ? null : legacyContent)[setting.key] === setting.on) return { kind: 'already' }
  try {
    let base = content
    if (!hasSection && legacyContent !== null && legacyContent.trim() !== '') {
      try {
        const legacyParsed: unknown = JSON.parse(legacyContent)
        if (isRecord(legacyParsed)) {
          base = JSON.stringify(parsed !== undefined ? { ...parsed, mobile: legacyParsed } : { version: VAULT_SETTINGS_VERSION, mobile: legacyParsed })
        }
      } catch {
        // Ignore malformed legacy mobile.json when seeding; proceed with `content`.
      }
    }
    return { kind: 'set', content: withMobileSettingInVaultSettings(base, setting.key, setting.on) }
  } catch {
    return { kind: 'refused', why: 'invalid' }
  }
}
