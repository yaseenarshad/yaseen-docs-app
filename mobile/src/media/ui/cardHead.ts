import { cardBand } from '@client/editor/card/cardBand'
import { cardHeadMarkEls } from '@client/review/cardHeadMarks'
import type { CardReview } from '@shared/cardLine'
import type { CardTitleAt } from '@shared/cardTitleAt'
import type { ReviewSettings } from '@shared/reviews'

/**
 * A CARD'S HEAD AND TITLE BAND ON THE PHONE, as the Mac draws them read (`cardBlockView.ts`, `cardEmbed.ts`,
 * `cardTitle.ts`, `cardBand.ts` on the Mac's latest branch):
 *  - The head (`.card__head`): the card ID first (small and grey), then the marks every card head has
 *    (`cardHeadMarks`, YAZ-5915): "Archived", or with Review on "New" / "Due in 3 days"; with Review on the title rule
 *    ("Title hidden in review", "Title always (default)", YAZ-5913: the title still shows here); "To fix".
 *  - Under it, the title band (`.card-band`): the title off the card line, bold, a long title wraps. Read, a
 *    card with no title has NO band: the ID in the head names it ("Untitled card" is Edit card's grey hint only).
 *  - Card look › Card title size lives in the Mac's settings folder, which never reaches the phone: the band
 *    takes Default, 1.125× the card's text (`card.css`, `--card-title-size` unset).
 * No React and no HTML: every word goes in with `textContent`.
 */

export interface CardMarks {
  id: string | null
  /** The title off the card line ('' for none). */
  title: string
  off?: boolean
  notitle?: boolean
  titleAt?: CardTitleAt | null
  fix?: boolean
  reviews?: readonly CardReview[]
}


function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  return el
}

/**
 * The head's parts after what leads it: the ID, then the marks (`cardHeadMarks`) in one `.card__marks`, which a narrow
 * card cuts before the ID. `review`: the vault's review settings (Review off or absent: only Archived and To fix).
 */
export function headMarks(marks: CardMarks, review?: ReviewSettings): HTMLElement[] {
  const out: HTMLElement[] = []
  if (marks.id !== null) out.push(span('card__id', marks.id))
  const els = cardHeadMarkEls(marks, review)
  if (els.length > 0) {
    const box = document.createElement('span')
    box.className = 'card__marks'
    box.append(...els)
    out.push(box)
  }
  return out
}

/** A page's own card's head, or null when it has nothing to say (no ID, no mark). */
export function cardHead(marks: CardMarks, review?: ReviewSettings): HTMLElement | null {
  const parts = headMarks(marks, review)
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
