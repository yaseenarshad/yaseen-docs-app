/**
 * THE FIRST CARD'S FILE (YAZ-5121, for issue 6F, YAZ-5124): chapter 2 makes a real card file from what the person typed,
 * through the `host` seam (`courseHost.ts`). The scenes never write a file themselves.
 *
 * The frame's `CourseHost` has `courseCards()` (the folder, or why the course only shows) but no way to write a card
 * yet; issue 6F adds it. This file names the one call the scene makes, `makeCard(folder, draft)`, and reads it from the
 * host when the host has it. Until then the scene shows the host's own "only shows" line. 6F: give the real host this
 * method (or rename it here, in one place).
 */
import { SHOW_ONLY_NOT_YET, type CourseHost } from '../courseHost'

/** What the person made in chapter 2. `text` is the card's Markdown: the front, `---`, the back (when there is one). */
export interface CourseCardDraft {
  title: string
  text: string
  answer: 'forgot' | 'remembered'
}

export type MadeCard = { path: string } | { showOnly: string }

export interface CourseCardMaker {
  makeCard(folder: string, draft: CourseCardDraft): Promise<MadeCard>
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

/** Make the card through the host: the folder first, then the file. Any failure is a line for the person. */
export async function makeFirstCard(host: CourseHost, draft: CourseCardDraft): Promise<MadeCard> {
  try {
    const folder = await host.courseCards()
    if ('showOnly' in folder) return folder
    const maker = (host as CourseHost & Partial<CourseCardMaker>).makeCard
    if (typeof maker !== 'function') return { showOnly: SHOW_ONLY_NOT_YET }
    return await maker.call(host, folder.path, draft)
  } catch {
    return { showOnly: 'The course could not make the file. Your card is here in the course only.' }
  }
}
