import { SPECIAL } from '@shared/ipc'
import { handle } from './envelope'

/** The note menu's spelling rows (YAZ-4464): the preload asks here on macOS only; a word is the whole argument. */
export function registerSpellerIpc(speller: { guesses(word: string): Promise<string[] | null> }): void {
  handle(SPECIAL.spellGuesses, async (word: unknown) => (typeof word === 'string' ? speller.guesses(word) : null))
}
