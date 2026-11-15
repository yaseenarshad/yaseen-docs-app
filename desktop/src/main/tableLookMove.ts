import { TABLE_LOOK_FILE, TABLE_LOOK_KEYS, tableLookFile, tableLookOf } from '@shared/tableLook'
import type { SettingsState } from '@shared/types'
import type { SlotTimeToMove } from './store'
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

/**
 * YAZ-5602 round 2: Time in slot and Show seconds left the app settings for table-look.json (`look.slotTime`,
 * `look.slotSeconds`). The value this Mac set before (`store.slotTimeToMove`, read once at start) moves once into each
 * vault: with the rest of the look into a vault that has no file (`TABLE_LOOK_MOVE`'s part), else into the `look` of a
 * file that has neither key, beside its other keys (its own mark, `table-look.json#slot`). The defaults move nothing.
 */
export function tableLookMoves(slot: SlotTimeToMove): MoveStep[] {
  const withSlot = (s: Partial<SettingsState>) => ({ ...s, ...slot })
  const slotPart = (): Record<string, unknown> | null => {
    const look = tableLookOf(slot).look
    return look === undefined ? null : { ...tableLookFile({ look }) }
  }
  return [
    { name: TABLE_LOOK_MOVE.name, key: (s) => tableLookPart(withSlot(s)), run: (roots, s, store, canSeed) => TABLE_LOOK_MOVE.run(roots, withSlot(s) as SettingsState, store, canSeed) },
    {
      name: 'Time in slot',
      key: () => slotPart(),
      run: async (roots, _s, store, canSeed) => {
        const part = slotPart()
        for (const root of roots) await seedVaultPart(root, TABLE_LOOK_FILE, part, ['look.slotTime', 'look.slotSeconds'], store, canSeed, `${TABLE_LOOK_FILE}#slot`)
      },
    },
  ]
}
