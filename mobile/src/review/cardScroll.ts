import { SHOW_GAP, leastScroll, type Span } from '@client/editor/find/leastScroll'
import { glideView, inRoom, readingScroll } from '@client/review/inboxScroll'

/**
 * THE CARD'S READING SCROLL on the phone (YAZ-5415): the Mac Inbox's rules (`inboxScroll.ts`, YAZ-5049 rounds 2–6), on
 * the phone's card, which scrolls inside itself (the room is the card's own box).
 *
 *  - A tap never shows a part you cannot see: when the part the tap would show is not wholly in view, that tap only
 *    glides the card so the part sits a third of the way down (above the view: the least scroll). The next tap shows it.
 *  - The next side shows under the last one: its edge must sit in the room's top two thirds, else the card glides first.
 *  - The end: the card's end comes in by ⌘F's rule; in view, the tap bounces ✕ and ✓ (the screen does that).
 *  - Only a move the card can make: cut to how far it can still scroll; under one px is no move. No room laid out: none.
 *  - The glide is smooth, or at once with Reduce motion (`glideView`).
 */
export type TapTarget = number | 'side' | 'end'

const spanOf = (r: DOMRect): Span => ({ start: r.top, end: r.bottom })

/** What shows of the card's text: its box less its bottom padding (the fade and "↓ more" lie over that). */
function roomOf(view: HTMLElement): Span {
  const box = view.getBoundingClientRect()
  const pad = parseFloat(getComputedStyle(view).paddingBottom) || 0
  return { start: box.top, end: box.bottom - pad }
}

export function tapMove(view: HTMLElement, target: TapTarget): number {
  const room = roomOf(view)
  if (room.end - room.start <= 0) return 0
  let dy = 0
  if (typeof target === 'number') {
    const el = view.querySelector(`[data-hidden="${target}"]`)
    if (el === null) return 0
    const blank = spanOf(el.getBoundingClientRect())
    dy = inRoom(blank, room) ? 0 : readingScroll(blank, room)
  } else {
    const body = view.querySelector('.phone-card__body')
    if (body === null) return 0
    const edge = body.getBoundingClientRect().bottom
    dy = target === 'side' ? readingScroll({ start: edge, end: edge }, room) : leastScroll({ start: edge, end: edge }, room, SHOW_GAP)
  }
  if (dy === 0) return 0
  const down = Math.max(0, view.scrollHeight - view.clientHeight - view.scrollTop)
  const move = Math.min(Math.max(dy, -view.scrollTop), down)
  return Math.abs(move) < 1 ? 0 : move
}

/** Glides the card by `dy` (smooth, or at once with Reduce motion). */
export const glideCard = (view: HTMLElement, dy: number): void => glideView(view, dy)

/** More of the card's TEXT lies below what shows (its padding is no text): the soft fade and "↓ more" show. */
export function moreBelow(view: HTMLElement): boolean {
  const body = view.querySelector('.phone-card__body')
  if (body === null) return false
  return body.getBoundingClientRect().bottom > roomOf(view).end + 2
}
