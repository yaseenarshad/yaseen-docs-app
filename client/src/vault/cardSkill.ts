import { AGENT_PROMPT } from '../course/prompt'

/**
 * The card skill in the window (YAZ-5059 decisions 2 to 4, YAZ-5108): the words the app says about the app's own vault,
 * in one place for App, the sidebar and their tests.
 */

/** The row's name at the bottom of the sidebar. */
export const CARD_SKILL_NAME = 'Card skill'

/** The notice after "Hide card skill" (decision 4). It has one button, "Open Settings", and stays until used or closed. */
export const CARD_SKILL_HIDDEN = 'Card skill hidden. Turn it on again in Settings › Review.'

/** A file action in the card skill (Rename, Move, Delete, New, Paste): the app refuses it, with no allowance. */
export const CARD_SKILL_READ_ONLY = 'The card skill is read only. Duplicate it into your vault to change it.'

/**
 * "Copy prompt for your agent" (YAZ-5109; suggestion 19): the course's one sentence (`AGENT_PROMPT`, issue 6F uses it
 * too) with the path of the skill folder in its quotes.
 */
export const cardSkillPrompt = (folder: string): string => AGENT_PROMPT.replace('{path}', folder)

/** "Duplicate into <vault>…" when the vault has its `Card skill` already: the sheet asks before a second copy. */
export const cardSkillAgain = (vault: string): string => `Card skill is already in ${vault}. Make a second copy? The app keeps using the first one.`

/** A duplicate that landed: where it is. */
export const cardSkillDuplicated = (vault: string, folder: string): string => `Duplicated the card skill into ${vault}: "${folder}". You can change it there.`

/** "Duplicate into <vault>…" into a read-only vault (YAZ-5204): nothing is written, and this one line says why. */
export const cardSkillReadOnlyVault = (vault: string): string => `${vault} is read only, so the card skill was not duplicated. Turn that off in Settings, or pick another vault.`
