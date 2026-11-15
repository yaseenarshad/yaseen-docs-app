/**
 * The spelling rules both right-click menus share (YAZ-4464): which words the macOS checker is asked
 * about, and how long a right-click waits for its guesses.
 */

/**
 * A word the checker is asked about and "Add to dictionary" learns: 1 to 64 characters, no white space.
 * One rule for both doors, so a word that gets guesses can always be added (S10).
 */
export const isSpellWord = (word: string): boolean => /^\S{1,64}$/.test(word)

/**
 * How long a right-click on a word waits for its guesses (D2, idea 8): the helper starts at the first
 * ask, which can take most of a second on a busy Mac; then it answers in milliseconds. Past the wait
 * the menu opens with no guesses, so rows never move under the pointer.
 */
export const SPELL_WAIT_FIRST_MS = 1000
export const SPELL_WAIT_MS = 400

/**
 * A menu's wait for its guesses: `SPELL_WAIT_FIRST_MS` until the first answer comes, then `SPELL_WAIT_MS`
 * (S8: the long wait is for the helper's start, not for the first click). Past the wait, or on an error, null.
 */
export function createSpellWait() {
  let answered = false
  return <T>(guesses: Promise<T | null>): Promise<T | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<null>((resolve) => (timer = setTimeout(resolve, answered ? SPELL_WAIT_MS : SPELL_WAIT_FIRST_MS, null)))
    const answer = guesses.then(
      (value) => {
        answered = true
        return value
      },
      () => null,
    )
    return Promise.race([answer, late]).finally(() => clearTimeout(timer))
  }
}
