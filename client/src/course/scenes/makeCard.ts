/**
 * THE FIRST CARD'S FILE (YAZ-5121, with the host of YAZ-5124): chapter 2 makes a real card file from what the person
 * typed, through the one call of the `host` seam for it, `CourseHost.makeFirstCard` (`courseHost.ts`). The real host
 * (`vaultCourseHost`) makes "Course Cards", takes the title from the front (its title rule), writes a new card file each
 * time, and refuses in a vault where the course only shows. The scenes never write a file themselves.
 */
import type { CourseHost, FirstCardInput, MadeCard as HostMadeCard } from '../courseHost'

/** The card the host made, or the one line that says why the course only shows. */
export type MadeCard = HostMadeCard | { showOnly: string }

/** The line when the write failed (a full disk, a refused name): the card stays in the course only. */
export const COULD_NOT_MAKE = 'The course could not make the file. Your card is here in the course only.'

/** What the person typed, for the host: the front as plain words, where the hidden word stands in it, and the back. */
export function firstCardInput(words: readonly string[], hide: number, back: string): FirstCardInput {
  const front = words.join(' ')
  let start = 0
  for (let i = 0; i < hide && i < words.length; i++) start += words[i].length + 1
  const word = words[hide] ?? ''
  const core = /^(.*?)([.,!?;:)"”’]*)$/.exec(word)?.[1] ?? word
  return { front, hidden: { start, end: start + core.length }, back: back.trim() }
}

/** The card's Markdown: the front with the hidden word in `{{ }}`, then the back on its own side. */
export function draftText(words: readonly string[], hide: number, back: string): string {
  const front = words
    .map((w, i) => {
      if (i !== hide) return w
      const [, core, tail] = /^(.*?)([.,!?;:)"”’]*)$/.exec(w) ?? [w, w, '']
      return core === '' ? w : `{{${core}}}${tail}`
    })
    .join(' ')
  return back.trim() === '' ? front : `${front}\n---\n${back.trim()}`
}

/** A title from the front: its first words, without the braces (the real New card takes a typed name). */
export function draftTitle(front: string): string {
  const words = front.replace(/\{\{|\}\}/g, '').replace(/[.!?]+$/, '').split(/\s+/).filter((w) => w !== '')
  const title = words.slice(0, 6).join(' ')
  return words.length > 6 ? `${title}…` : title || 'My first card'
}

/** Make the card through the host. Any failure is a line for the person. */
export async function makeFirstCard(host: CourseHost, input: FirstCardInput): Promise<MadeCard> {
  try {
    return await host.makeFirstCard(input)
  } catch {
    return { showOnly: COULD_NOT_MAKE }
  }
}
