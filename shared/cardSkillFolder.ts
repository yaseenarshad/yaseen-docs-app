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

/** The skill's folder of formats: one page for each format (YAZ-5114). */
export const CARD_SKILL_FORMATS = 'formats'

/** What the format hint (YAZ-5114) needs: the `formats` folder of the skill in use, and its format names. */
export interface CardSkillFormats {
  folder: string
  formats: string[]
}

/** The format names from the file names of the `formats` folder: each `.md` page without `.md`, a dot file skipped, A to Z. */
export function cardFormatNames(files: readonly string[]): string[] {
  return files
    .filter((name) => name.toLowerCase().endsWith('.md') && !name.startsWith('.'))
    .map((name) => name.slice(0, -3))
    .filter((name) => name.trim() !== '')
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
}
