import { isRecord } from '@shared/guards'
import { VAULT_CONFIG_DIR } from '@shared/types'
import type { LegacySectionKey } from '@shared/vaultSettings'
import type { VaultStore } from '../store'

/**
 * UNIFIED VAULT SETTINGS READER FOR MOBILE (YAZ-6557 / YAZ-6546).
 *
 * Reads `<vault>/.yaseendocs/settings.json` ONCE and extracts any consolidated legacy section
 * (`textFormatting`, `tableLook`, `cardLook`, `linkPills`, `linkClick`, `dailyPages`, `folderPages`,
 * `newPlaces`, `showIds`, `review`, `unitWord`, `mobile`), falling back to reading the legacy
 * `.yaseendocs/<legacyFile>` ONLY when that section is absent in `settings.json` (or when
 * `settings.json` does not exist / is unreadable).
 *
 * Intentionally avoids a runtime import of `@shared/vaultSettings` so first-load modules
 * (`vaultTabs.ts`, `unitWord.ts`, `vaultData.ts`, `showIds.ts`) never pull lazy-only
 * `shared/dailyPagesFile.ts` into the mobile first-load bundle (`NOT_FIRST_LOAD`).
 */
export const VAULT_SETTINGS_PATH = `${VAULT_CONFIG_DIR}/settings.json`

export type VaultSettingsReader = Pick<VaultStore, 'read'>

/** Decode text or bytes stored in `VaultStore` to a UTF-8 string. */
export function decodeVaultText(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content)
}

/** Parse a JSON string or bytes, returning `undefined` when absent or not valid JSON. */
export function parseVaultJson(content: string | Uint8Array | null | undefined): unknown {
  if (content === null || content === undefined) return undefined
  try {
    return JSON.parse(decodeVaultText(content)) as unknown
  } catch {
    return undefined
  }
}

/** Read and parse `<vault>/.yaseendocs/settings.json` once; returns `null` when missing or not a JSON object. */
export async function readVaultSettingsDoc(store: VaultSettingsReader, vault: string): Promise<Record<string, unknown> | null> {
  try {
    const file = await store.read(vault, VAULT_SETTINGS_PATH)
    if (file === null) return null
    const parsed = parseVaultJson(file.content)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Extract a nested legacy section from a parsed `settings.json` object (matches `readVaultSection`). */
export function sectionFromDoc(doc: unknown, section: LegacySectionKey): Record<string, unknown> | null {
  if (!isRecord(doc)) return null
  const val = doc[section]
  return isRecord(val) ? val : null
}

/**
 * Read a single consolidated settings section from a pre-loaded `settings.json` `doc` (or load `settings.json`
 * once when `doc` is omitted), falling back to `.yaseendocs/<legacyFile>` ONLY if that section is absent in
 * `settings.json`. Returns `undefined` when neither source provides valid JSON.
 */
export async function readVaultSectionOrLegacy(
  store: VaultSettingsReader,
  vault: string,
  section: LegacySectionKey,
  legacyFile: string,
  doc?: Record<string, unknown> | null,
): Promise<unknown> {
  const unified = doc === undefined ? await readVaultSettingsDoc(store, vault) : doc
  const fromUnified = sectionFromDoc(unified, section)
  if (fromUnified !== null) return fromUnified
  try {
    const legacy = await store.read(vault, `${VAULT_CONFIG_DIR}/${legacyFile}`)
    return legacy === null ? undefined : parseVaultJson(legacy.content)
  } catch {
    return undefined
  }
}
