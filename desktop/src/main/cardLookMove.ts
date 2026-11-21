import { CARD_LOOK_FILE, CARD_LOOK_KEYS, cardLookFile, cardLookOf } from '@shared/cardLook'
import type { SettingsState } from '@shared/types'
import { seedVaultPart, type MoveStep } from './vaultSettingsMove'

/**
 * YAZ-5484 (replaces YAZ-5005's one card look for the whole app): the app's 13 Card look settings move once into EACH
 * open vault's `.yaseendocs/card-look.json`, by the vault settings rules (`seedVaultPart`): they were the look of every
 * vault, so every vault starts with it; only after the vault's first pull; never over a file that has any of its keys
 * or is not valid JSON; the defaults move nothing (a vault with no file reads the app's values, the same look); once
 * per vault. The app values stay: the fallback for a vault with no file and a window with no vault, and what older
 * builds read.
 */
export function cardLookPart(s: Partial<SettingsState>): Record<string, unknown> | null {
  const look = cardLookOf(s)
  return Object.keys(look).length === 0 ? null : { ...cardLookFile(look) }
}

const OWNS = CARD_LOOK_KEYS.filter((k) => k !== 'version')

export const CARD_LOOK_MOVE: MoveStep = {
  name: 'the card look',
  key: (s) => cardLookPart(s),
  run: async (roots, s, store, canSeed) => {
    const part = cardLookPart(s)
    for (const root of roots) await seedVaultPart(root, CARD_LOOK_FILE, part, OWNS, store, canSeed)
  },
}
