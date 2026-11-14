/**
 * The Inbox's reading scroll (YAZ-5049 round 2, Yaseen: "i uncovered 'intelligence' and i can't see the surrounding…
 * it needs to be enough that they can see whats next"). Round 1 used ⌘F's least scroll, which leaves the word on the
 * view's last line: nothing of what comes next shows. Reading goes down, so the rule keeps room BELOW the word:
 *
 * - The word shows in the view's top two thirds: nothing moves (most Spaces: the view stays still while you read).
 * - It is lower, or below the view: the view glides so the word sits a third of the way down — the upper part, never
 *   the centre — and two thirds of the view show what comes next. One move then lasts for a third of a view of Spaces.
 * - It is above the view (you scrolled down past it): the least scroll that shows it, a small gap kept, as ⌘F.
 *
 * The room is what you see of the card: the Inbox's view less its sticky top row and its sticky buttons at the bottom.
 *
 * Round 3 (Yaseen: "the thing it should be following is the NEXT fill in"): `CardInbox` aims this rule at the blank the
 * next Space shows (`data-next`), a new side's first blank, and at the end (no blank left) brings the card's end in by
 * ⌘F's rule over the last word and the end, so the last word stays in sight.
 */
import type { Span } from '../editor/find/leastScroll'
import { cssZoom } from '../lib/cssZoom'

/** Where a word may sit before the view moves: the top two thirds of the room. */
export const READ_LINE = 2 / 3
/** Where a move puts the word: a third of the way down the room. */
export const LAND_LINE = 1 / 3

/** The scroll (screen px, + is down) that shows `thing` with room below it in `room`; 0 when it shows so already. */
export function readingScroll(thing: Span, room: Span, gap = 6): number {
  const height = room.end - room.start
  if (height <= 0) return 0
  if (thing.start < room.start + gap) return thing.start - room.start - gap
  if (thing.end > room.start + height * READ_LINE) return thing.start - (room.start + height * LAND_LINE)
  return 0
}

/** The part of the Inbox's view (`.card-inbox`) that shows the card: under its sticky top row, over its sticky buttons. */
export function inboxRoom(view: HTMLElement): Span {
  const box = view.getBoundingClientRect()
  const top = view.querySelector('.card-inbox__top')?.getBoundingClientRect().bottom ?? box.top
  const dock = view.querySelector('.card-inbox__dock')?.getBoundingClientRect().top ?? box.bottom
  return { start: Math.max(box.top, top), end: Math.min(box.bottom, dock) }
}

/**
 * Round 5 (Yaseen: "Yes, build it" — Space never shows a blank you cannot see): a blank is IN VIEW when all of it lies
 * in the room, between the top row's bottom edge and the buttons' top edge. A blank cut by either edge is not.
 */
export const inRoom = (thing: Span, room: Span): boolean => thing.start >= room.start && thing.end <= room.end

/** Moves the Inbox's view by `dy` screen px: a glide, or at once with Reduce motion. The target is absolute, so a call during a glide lands right. */
export function glideView(view: HTMLElement, dy: number): void {
  const top = view.scrollTop + dy / cssZoom(view)
  const smooth = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
  if (typeof view.scrollTo === 'function') view.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  else view.scrollTop = top
}
