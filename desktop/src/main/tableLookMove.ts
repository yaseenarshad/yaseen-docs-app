import { TABLE_LOOK_FILE, TABLE_LOOK_KEYS, tableLookFile, tableLookOf } from '@shared/tableLook'
import type { SettingsState } from '@shared/types'
import { seedVaultPart, type MoveStep } from './vaultSettingsMove'

/**
 * YAZ-5487: the app's 21 table settings (the look and the new-table defaults) move once into EACH open vault's
 * `.yaseendocs/table-look.json`, by the vault settings rules (`seedVaultPart`, as `CARD_LOOK_MOVE`): they were the look
 * of every vault, so every vault starts with it; only after the vault's first pull; never over a file that has any of
 * its keys or is not valid JSON; the defaults move nothing (a vault with no file reads the app's values, the same look);
 * once per vault. The app values stay: the fallback for a vault with no file and a window with no vault, and what older
 * builds read.
 */
export function tableLookPart(s: Partial<SettingsState>): Record<string, unknown> | null {
  const look = tableLookOf(s)
  return Object.keys(look).length === 0 ? null : { ...tableLookFile(look) }
}

const OWNS = TABLE_LOOK_KEYS.filter((k) => k !== 'version')

export const TABLE_LOOK_MOVE: MoveStep = {
  name: 'the table look',
  key: (s) => tableLookPart(s),
  run: async (roots, s, store, canSeed) => {
    const part = tableLookPart(s)
    for (const root of roots) await seedVaultPart(root, TABLE_LOOK_FILE, part, OWNS, store, canSeed)
  },
}
