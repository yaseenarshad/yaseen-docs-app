/**
 * Which hidden words of an Inbox card show, and which blank is marked next (YAZ-5049 round 4, Yaseen: "mouse behavior
 * and spacebar behavior is a little bit different"). Pure.
 *
 * - Space shows the MARKED blank (the one "Mark the next hidden word" colours, `data-next`); with none left on the
 *   sides that show, the next side.
 * - A click on a blank shows THAT word, wherever it is.
 * - After either, the mark goes to the next blank still hidden after that word, in reading order; with none after it,
 *   to the first one still hidden before it. With Space alone this is the next word in page order, as before.
 * - Round 6 (Yaseen: "click on a hidden word in order to be able to hide it again"): a click on a SHOWN word hides it
 *   again, and it becomes the marked blank, so the next Space shows it first. The sides that show stay.
 * - THE TITLE'S OWN STEP (YAZ-5709): with After the first click the title is the first Space or tap, by itself; with
 *   Before Side 2 it is the Space or tap just before Side 2 (a one-sided card: the last one, after every hidden word).
 *   A click on a blank shows that word only: the title still waits for its own step (`nextStep`).
 */
import type { TitleStep } from '@shared/cardTitleShows'

/** Words are numbered over the whole card, in page order; `open` holds the shown ones, sorted. */
export interface Reveal {
  /** How many sides show, from the first. */
  sides: number
  /** The shown words' numbers, sorted. */
  open: readonly number[]
  /** The marked blank, or null: the first hidden word of the sides that show. */
  next: number | null
  /** The title's own step has come (YAZ-5709: After the first click, Before Side 2). */
  titled: boolean
}

export const START: Reveal = { sides: 1, open: [], next: null, titled: false }

/** The first hidden word below `upTo` (the words of the sides that show), or null. */
export function firstHidden(open: readonly number[], upTo: number): number | null {
  for (let n = 0; n < upTo; n++) if (!open.includes(n)) return n
  return null
}

/** The blank marked next: the stored mark while it is still hidden, else the first hidden word. Null: none on the sides that show. */
export function markOf(r: Reveal, upTo: number): number | null {
  return r.next !== null && r.next < upTo && !r.open.includes(r.next) ? r.next : firstHidden(r.open, upTo)
}

/** `word` shows (a click, or Space on the mark); the mark goes after it, else before it. A word that shows already: no change. */
export function reveal(r: Reveal, word: number, upTo: number): Reveal {
  if (r.open.includes(word) || word < 0 || word >= upTo) return r
  const open = [...r.open, word].sort((a, b) => a - b)
  let next: number | null = null
  for (let n = word + 1; n < upTo && next === null; n++) if (!open.includes(n)) next = n
  if (next === null) next = firstHidden(open, word)
  return { ...r, open, next }
}

/** `word`, shown, hides again (round 6) and is marked next. A word that is hidden already: no change. */
export function hide(r: Reveal, word: number): Reveal {
  if (!r.open.includes(word)) return r
  return { ...r, open: r.open.filter((n) => n !== word), next: word }
}

/**
 * The next plain step (Space, a tap on the card; the Mac and the phone alike), or null at the end. `counts` are each
 * side's hidden words; `title` where the title is its own step (`titleStepOf`, YAZ-5709):
 *  - 'first' (After the first click): the title, by itself, before anything else.
 *  - 'side2' (Before Side 2): the title, by itself, just before Side 2, also on a card of 3 sides; a one-sided card:
 *    after every hidden word (none: the one step).
 * Otherwise the marked blank, else the next side.
 */
export function nextStep(r: Reveal, counts: readonly number[], title: TitleStep): Reveal | null {
  if (title === 'first' && !r.titled) return { ...r, titled: true }
  const upTo = counts.slice(0, r.sides).reduce((a, b) => a + b, 0)
  const m = markOf(r, upTo)
  if (m !== null) return reveal(r, m, upTo)
  if (r.sides < counts.length) return title === 'side2' && r.sides === 1 && !r.titled ? { ...r, titled: true } : { ...r, sides: r.sides + 1, next: null }
  return title !== null && !r.titled ? { ...r, titled: true } : null
}

/** The words shown as the render takes them: the run from the first word, then the rest (`CardShow.shown`, `picked`). */
export function shownParts(open: readonly number[]): { shown: number; picked: number[] } {
  let shown = 0
  while (open.includes(shown)) shown++
  return { shown, picked: open.filter((n) => n > shown) }
}
