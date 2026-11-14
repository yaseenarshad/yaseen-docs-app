import { SAME_WORD, UNIT_WORD_FILE, sanitizeUnitWord, unitTextOf, unitWordOf, type UnitText } from '@client/vault/unitWordText'
import { VAULT_CONFIG_DIR } from '@shared/types'
import type { VaultStore } from '../store'

/**
 * The vault's word for "page" (YAZ-5036; round 15, item 5): the phone reads `.yaseendocs/unit-word.json` from the
 * vault's stored files (3B downloads `.yaseendocs/`) and uses THE Mac's helper (`unitTextOf`, from
 * `client/src/vault/unitWordText.ts`), so "page" in a label becomes the vault's word, as on the Mac. "Card" never changes.
 */
export const UNIT_WORD_PATH = `${VAULT_CONFIG_DIR}/${UNIT_WORD_FILE}`

/** The helper of a vault: the identity with no file, a file that does not parse, or the default word. */
export async function readUnitWord(store: VaultStore, vault: string): Promise<UnitText> {
  const file = await store.read(vault, UNIT_WORD_PATH)
  if (file === null) return SAME_WORD
  const text = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
  try {
    return unitTextOf(unitWordOf(sanitizeUnitWord(JSON.parse(text))))
  } catch {
    return SAME_WORD
  }
}

export { SAME_WORD, type UnitText }
