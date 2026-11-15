/**
 * The app's own vault (YAZ-5059 decision 2, YAZ-5108): the card skill's copy in the profile, `<userData>/card-skill`
 * (`desktop/src/main/cardSkill.ts`). A window shows it as one more vault, but it is never a vault of the person: it is
 * not in `WindowEntry.roots`, it does not count in `MAX_WINDOW_ROOTS`, and it never goes into Recent vaults or the ⌘O
 * list. Main names it once the copy is made (`index.ts`); a window learns it from `window:identity` (`cardSkill`).
 *
 * One value per process: the guards in `types.ts` (`addRecentRoot`, `listVaults`) and in main (`windows.ts` `recordUsed`) read it, so a
 * path that names the copy never lands in a list the person keeps.
 */

/** Trailing slash off, as `types.ts` `stripSlash` (kept here: `types.ts` imports this module). */
const stripSlash = (p: string): string => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

let cardSkill: string | null = null

/** The card skill's copy for this process, or null to forget it (a test, a copy that failed). */
export function setCardSkillVault(path: string | null): void {
  cardSkill = path === null ? null : stripSlash(path)
}

/** The card skill's copy, or null when this process does not know one. */
export const cardSkillVault = (): string | null => cardSkill

/** `path` is the app's own vault itself. */
export const isAppVault = (path: string): boolean => cardSkill !== null && stripSlash(path) === cardSkill

/** `path` is the app's own vault or a path inside it. */
export const inAppVault = (path: string): boolean => cardSkill !== null && (stripSlash(path) === cardSkill || path.startsWith(`${cardSkill}/`))
