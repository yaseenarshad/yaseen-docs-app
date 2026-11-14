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
 */

/** Words are numbered over the whole card, in page order; `open` holds the shown ones, sorted. */
export interface Reveal {
  /** How many sides show, from the first. */
  sides: number
  /** The shown words' numbers, sorted. */
  open: readonly number[]
  /** The marked blank, or null: the first hidden word of the sides that show. */
  next: number | null
}

export const START: Reveal = { sides: 1, open: [], next: null }

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
  return { sides: r.sides, open, next }
}

/** `word`, shown, hides again (round 6) and is marked next. A word that is hidden already: no change. */
export function hide(r: Reveal, word: number): Reveal {
  if (!r.open.includes(word)) return r
  return { sides: r.sides, open: r.open.filter((n) => n !== word), next: word }
}

/** The words shown as the render takes them: the run from the first word, then the rest (`CardShow.shown`, `picked`). */
export function shownParts(open: readonly number[]): { shown: number; picked: number[] } {
  let shown = 0
  while (open.includes(shown)) shown++
  return { shown, picked: open.filter((n) => n > shown) }
}
