/**
 * The clips that wait for the person (YAZ-5120): the clips whose comment in `script.ts` says "WAITS:". Such a clip
 * does not end when its words end: the player holds at its end until the clip's scene says the step is done
 * (`SceneProps.done`), or the person presses Next. The comments are not in the built script, so the list is here; a
 * test (`waits.test.ts`) reads `script.ts` and fails when the two differ.
 */
export const WAITING_CLIPS: ReadonlySet<string> = new Set([
  // Chapter 2: the person makes a card in the course.
  'c2-07', // types the front
  'c2-08', // taps the word to hide
  'c2-28', // types a line on the back (or skips)
  'c2-10', // taps the card to check
  'c2-11', // picks Forgot or Remembered
  // Chapter 7: picks the better of two cards.
  'c7-08',
  // Chapter 8: the AI step (issue 6F).
  'c8-11', // pastes their own text or uses the example
  'c8-12', // copies the prompt
  'c8-13', // the agent writes card files in Course Cards
])
