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
 */
import type { Span } from '../editor/find/leastScroll'

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
