import { SPECIAL } from '@shared/ipc'
import { handle } from './envelope'

/**
 * The page menu's spelling rows (YAZ-4464): the preload asks here on macOS only; a word is the whole argument.
 * Off macOS it answers null and starts nothing (S10): there is no helper there. The word rule is the speller's (`isSpellWord`).
 */
export function registerSpellerIpc(speller: { guesses(word: string): Promise<string[] | null> }, platform: NodeJS.Platform = process.platform): void {
  handle(SPECIAL.spellGuesses, async (word: unknown) => (platform === 'darwin' && typeof word === 'string' ? speller.guesses(word) : null))
}
