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
 *
 * Round 6 (Yaseen: "there are certain space clicks that are actually oriented towards just moving the screen"): the
 * word a Space just showed stays still, to study it. A Space never scrolls after it shows; when what it would show is
 * out of view, that Space only scrolls (`spaceMove`), and the next one shows. This replaces round 3's follow.
 */
import { SHOW_GAP, leastScroll, type Span } from '../editor/find/leastScroll'
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

/**
 * What the next Space acts on (round 6): the marked blank (its number), the next side, or the end (nothing left).
 */
export type SpaceTarget = number | 'side' | 'end'

/**
 * The move (screen px) a Space makes INSTEAD of showing, in the Inbox's view `view`; 0 when it may show.
 * - A blank not wholly in view (round 5): it comes a third of the way down (above the view: the least scroll).
 * - The next side: it shows under the card's bottom edge, so that edge must sit in the room's top two thirds, with room
 *   for the side under it; lower, it comes a third of the way down.
 * - The end: the card's end — the Reviews strip under it (YAZ-5105), else the card's bottom edge — comes in by ⌘F's
 *   rule. In view, the Space rings the buttons (round 3).
 * A view with no room laid out never moves.
 *
 * ONLY A MOVE THE VIEW CAN MAKE (fix, "my spacebar on inbox is no longer working"): the move is cut to how far the
 * view can still scroll, and a Space with no move left shows. A short card ends right where its buttons start, so its
 * end is always low in the room, and the view has nothing to scroll: a "side" Space glided nowhere, every time, and
 * the next side never showed.
 */
export function spaceMove(view: HTMLElement, target: SpaceTarget): number {
  return reachable(view, wantedMove(view, target))
}

/** The move cut to the view's scroll range (screen px); 0 under one px, where nothing would move. */
function reachable(view: HTMLElement, dy: number): number {
  if (dy === 0) return 0
  const zoom = cssZoom(view)
  const down = Math.max(0, view.scrollHeight - view.clientHeight - view.scrollTop) * zoom
  const up = -view.scrollTop * zoom
  const move = Math.min(Math.max(dy, up), down)
  return Math.abs(move) < 1 ? 0 : move
}

function wantedMove(view: HTMLElement, target: SpaceTarget): number {
  const room = inboxRoom(view)
  if (room.end - room.start <= 0) return 0
  if (typeof target === 'number') {
    const r = view.querySelector(`[data-hidden="${target}"]`)?.getBoundingClientRect()
    if (r === undefined) return 0
    const blank = { start: r.top, end: r.bottom }
    return inRoom(blank, room) ? 0 : readingScroll(blank, room)
  }
  const edge = view.querySelector('.card-inbox__panel')?.getBoundingClientRect().bottom
  if (target === 'side') return edge === undefined ? 0 : readingScroll({ start: edge, end: edge }, room)
  const strip = view.querySelector('.card-reviews--strip')?.getBoundingClientRect()
  const end = strip !== undefined ? { start: strip.top, end: strip.bottom } : edge !== undefined ? { start: edge, end: edge } : null
  return end === null ? 0 : leastScroll(end, room, SHOW_GAP)
}
