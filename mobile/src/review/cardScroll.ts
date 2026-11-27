import type { Span } from '@client/editor/find/leastScroll'
import type { SpaceBehavior } from '@shared/reviews'
import { effectiveScrollTop, glideView, planSpaceMove, resetScrollChain } from '@client/review/inboxScroll'

/**
 * THE CARD'S READING SCROLL on the phone: shares the Mac Inbox's pure planner (`planSpaceMove` in `inboxScroll.ts`,
 * YAZ-6598) on the phone's Review page (YAZ-5716: the stage scrolls the card and the hint line under it as one page,
 * as the Mac's Inbox view; the room is the stage's box above the hint line, which stays at its foot).
 *
 *  - In `scroll` mode (default): walks down in ~35% reading steps and requires 32 px bottom breathing room below a
 *    blank before revealing while scroll room remains.
 *  - In `jump` mode: jumps straight to off-screen blanks/sides and pages in ~70% chunks at the end.
 *  - Shares the 300 ms pending-target chainer (`effectiveScrollTop` / `glideView`) so rapid taps never stall.
 */
export type TapTarget = number | 'side' | 'end'

/** What shows of the card's text: the page's box less its bottom padding and the hint line at its foot (the fade and
 * "↓ more" lie just above that line). */
function roomOf(view: HTMLElement): Span {
  const box = view.getBoundingClientRect()
  const pad = parseFloat(getComputedStyle(view).paddingBottom) || 0
  const hint = view.querySelector(':scope > .review__foot')?.getBoundingClientRect().height ?? 0
  return { start: box.top, end: box.bottom - pad - hint }
}

export function tapMove(view: HTMLElement, target: TapTarget, mode: SpaceBehavior = 'scroll'): number {
  const room = roomOf(view)
  if (room.end - room.start <= 0) return 0
  const base = effectiveScrollTop(view)
  const pendingShift = view.scrollTop - base
  const remainingDown = Math.max(0, view.scrollHeight - view.clientHeight - base)
  const remainingUp = Math.max(0, base)
  const viewportHeight = view.clientHeight > 0 ? view.clientHeight : room.end - room.start

  let blank: Span | undefined
  let edge: number | undefined
  if (typeof target === 'number') {
    const el = view.querySelector(`[data-hidden="${target}"]`)
    if (el === null) return 0
    const r = el.getBoundingClientRect()
    blank = { start: r.top + pendingShift, end: r.bottom + pendingShift }
  } else if (target === 'side') {
    const body = view.querySelector('.phone-card__body')
    if (body === null) return 0
    edge = body.getBoundingClientRect().bottom + pendingShift
  }

  return planSpaceMove({ target, room, blank, edge, remainingDown, remainingUp, viewportHeight, mode })
}

/** Glides the card by `dy` (smooth, or at once with Reduce motion), chaining rapid taps. */
export const glideCard = (view: HTMLElement, dy: number): void => glideView(view, dy)

/** Clears any pending smooth-scroll chain when jumping back to top on a new card. */
export const resetCardScroll = (view: HTMLElement): void => resetScrollChain(view)

/** More of the card's TEXT lies below what shows (its padding is no text): the soft fade and "↓ more" show. */
export function moreBelow(view: HTMLElement): boolean {
  const body = view.querySelector('.phone-card__body')
  if (body === null) return false
  return body.getBoundingClientRect().bottom > roomOf(view).end + 2
}
