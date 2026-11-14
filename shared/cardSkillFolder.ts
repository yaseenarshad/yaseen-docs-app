/**
 * Which card skill a vault uses (YAZ-5059 suggestion 18, YAZ-5110): the user's own version wins. "Duplicate" (YAZ-5059
 * decision 5) copies the app's skill into the vault as a top-level `Card skill` folder; when that folder is there,
 * `yaseendocs card guide` and the format hint read it, else the app's copy in the profile. Pure: the caller says
 * whether a folder exists, so the command (on disk) and the renderer (from its index) share the one rule.
 */

/** The name of the user's own copy of the card skill, at the top of a vault. */
export const CARD_SKILL_FOLDER_NAME = 'Card skill'
/** The skill's start page, in the app's copy and in the user's: what `yaseendocs card guide` prints. */
export const CARD_SKILL_START_PAGE = 'Start here.md'

/**
 * The card skill folder for `vault` (its root folder; null outside a vault): `<vault>/Card skill` when `isFolder` says
 * it exists, else `appCopy`. Joined with the vault path's own separator.
 */
export function cardSkillFolder(vault: string | null, appCopy: string, isFolder: (path: string) => boolean): string {
  if (vault === null) return appCopy
  const sep = vault.includes('\\') && !vault.includes('/') ? '\\' : '/'
  const own = `${vault.endsWith(sep) ? vault.slice(0, -1) : vault}${sep}${CARD_SKILL_FOLDER_NAME}`
  return isFolder(own) ? own : appCopy
}
