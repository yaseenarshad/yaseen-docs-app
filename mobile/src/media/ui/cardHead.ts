import { cardBand } from '@client/editor/card/cardBand'

/**
 * A CARD'S HEAD AND TITLE BAND ON THE PHONE (YAZ-5437), as the Mac draws them read (`cardBlockView.ts`, `cardEmbed.ts`,
 * `cardTitle.ts`, `cardBand.ts` on the Mac's latest branch):
 *  - The head (`.card__head`): the card ID first (small and grey), then "Archived" (`off`), then "Title hidden in review"
 *    (`notitle`, YAZ-5030: the title still shows here; only the Inbox's front waits with it).
 *  - Under it, the title band (`.card-band`, YAZ-5308 A3): the title off the card line, bold, a long title wraps. Read, a
 *    card with no title has NO band: the ID in the head names it ("Untitled card" is Edit card's grey hint only).
 *  - Card look › Card title size (YAZ-5387) lives in the Mac's settings folder, which never reaches the phone: the band
 *    takes Default, 1.125× the card's text (`card.css`, `--card-title-size` unset).
 * No React and no HTML: every word goes in with `textContent`.
 */

export interface CardMarks {
  id: string | null
  /** The title off the card line ('' for none). */
  title: string
  off?: boolean
  notitle?: boolean
}

/** The words "Title hidden in review" (the Mac's `cardBlockView.ts`). */
export const TITLE_HIDDEN = 'Title hidden in review'

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  return el
}

/** The head's marks after what leads it: the ID, "Archived", "Title hidden in review". */
export function headMarks(marks: CardMarks): HTMLElement[] {
  const out: HTMLElement[] = []
  if (marks.id !== null) out.push(span('card__id', marks.id))
  if (marks.off === true) out.push(span('card__state', 'Archived'))
  if (marks.notitle === true) out.push(span('card__state card__notitle', TITLE_HIDDEN))
  return out
}

/** A page's own card's head, or null when it has nothing to say (no ID, no mark). */
export function cardHead(marks: CardMarks): HTMLElement | null {
  const parts = headMarks(marks)
  if (parts.length === 0) return null
  const head = document.createElement('div')
  head.className = 'card__head'
  head.append(...parts)
  return head
}

/** The title band (the Mac's `cardBand`), or null for a card with no title. */
export function titleBand(title: string): HTMLElement | null {
  if (title.trim() === '') return null
  const inner = document.createElement('div')
  inner.className = 'card__title'
  const box = document.createElement('div')
  box.className = 'page-title'
  const text = document.createElement('div')
  text.className = 'page-title__text'
  text.setAttribute('role', 'heading')
  text.setAttribute('aria-level', '3')
  text.textContent = title
  box.append(text)
  inner.append(box)
  return cardBand(inner)
}
