import { SAME_WORD, UNIT_WORD_FILE, sanitizeUnitWord, unitTextOf, unitWordOf, type UnitText } from '@shared/unitWord'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { readVaultSectionOrLegacy } from '../settings/readVaultSettings'
import type { VaultStore } from '../store'

/**
 * The vault's word for "page" (round 15, item 5; unified in YAZ-6557): the phone reads `unitWord` from
 * `.yaseendocs/settings.json` (falling back to `.yaseendocs/unit-word.json`) and uses THE shared helper
 * (`unitTextOf`, from `@shared/unitWord`), so "page" in a label becomes the vault's word, as on the Mac. "Card" never changes.
 */
export const UNIT_WORD_PATH = `${VAULT_CONFIG_DIR}/${UNIT_WORD_FILE}`

/** The helper of a vault: the identity with no file, a file that does not parse, or the default word. */
export async function readUnitWord(store: VaultStore, vault: string): Promise<UnitText> {
  const raw = await readVaultSectionOrLegacy(store, vault, 'unitWord', UNIT_WORD_FILE)
  if (raw === undefined) return SAME_WORD
  return unitTextOf(unitWordOf(sanitizeUnitWord(raw)))
}

export { SAME_WORD, type UnitText }
