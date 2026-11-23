import { FOLDER_PAGES_FILE, FOLDER_PAGES_KEYS, folderPagesFile, folderPagesOf } from '@shared/folderPages'
import type { SettingsState } from '@shared/types'
import { seedVaultPart, type MoveStep } from './vaultSettingsMove'

/**
 * YAZ-5489 (replaces YAZ-4585 D34, "the global side of a folder page"): the app's 27 folder page view and page defaults
 * move once into EACH open vault's `.yaseendocs/folder-pages.json`, by the vault settings rules (`seedVaultPart`, as
 * `CARD_LOOK_MOVE`): only after the vault's first pull; never over a file that has any of its keys or is not valid
 * JSON; the defaults move nothing (a vault with no file reads the app's values); once per vault. The personal parts
 * (week start, row band, keep pinned, ask before delete) never move. The app values stay: the fallback, and what older
 * builds read.
 */
export function folderPagesPart(s: Partial<SettingsState>): Record<string, unknown> | null {
  const file = folderPagesOf(s.folderPages ?? {})
  return Object.keys(file).length === 0 ? null : { ...folderPagesFile(file) }
}

const OWNS = FOLDER_PAGES_KEYS.filter((k) => k !== 'version')

export const FOLDER_PAGES_MOVE: MoveStep = {
  name: 'the folder page defaults',
  key: (s) => folderPagesPart(s),
  run: async (roots, s, store, canSeed) => {
    const part = folderPagesPart(s)
    for (const root of roots) await seedVaultPart(root, FOLDER_PAGES_FILE, part, OWNS, store, canSeed)
  },
}
