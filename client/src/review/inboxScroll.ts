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
import type { Span } from '../editor/find/leastScroll'
import { cssZoom } from '../lib/cssZoom'

/** Where a word may sit before the view moves: the top two thirds of the room. */
export const READ_LINE = 2 / 3
/** Where a move puts the word: a third of the way down the room. */
export const LAND_LINE = 1 / 3
/** Fraction of visible height per Up/Down press (YAZ-6057), matching Space's ~1/3-viewport glide. */
export const ARROW_SCROLL_FRACTION = 0.35
/** Minimum step (CSS px) per Up/Down press on shorter windows. */
export const ARROW_SCROLL_MIN_PX = 180
/** Fraction of visible room per Space page-down after the final reveal (YAZ-6058), keeping ~30% reading overlap. */
export const SPACE_PAGE_FRACTION = 0.7

const arrowState = new WeakMap<HTMLElement, { target: number; at: number }>()
const ARROW_CHAIN_MS = 300

function scrollViewTo(view: HTMLElement, top: number): void {
  const smooth = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
  if (typeof view.scrollTo === 'function') view.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  else view.scrollTop = top
}

/** The scroll (screen px, + is down) that shows `thing` with room below it in `room`; 0 when it shows so already. */
export function readingScroll(thing: Span, room: Span, gap = 6): number {
  const height = room.end - room.start
  if (height <= 0) return 0
  if (thing.start < room.start + gap) return thing.start - room.start - gap
  if (thing.end > room.start + height * READ_LINE) return thing.start - (room.start + height * LAND_LINE)
  return 0
}

/** The part of the Inbox's view (`.card-inbox`) that shows the card: under its sticky top row, down to the view's bottom (YAZ-6055: the dock sits in normal flow below the card, not sticky over it). */
export function inboxRoom(view: HTMLElement): Span {
  const box = view.getBoundingClientRect()
  const top = view.querySelector('.card-inbox__top')?.getBoundingClientRect().bottom ?? box.top
  return { start: Math.max(box.top, top), end: box.bottom }
}

/**
 * Round 5 (Yaseen: "Yes, build it" — Space never shows a blank you cannot see): a blank is IN VIEW when all of it lies
 * in the room, between the top row's bottom edge and the buttons' top edge. A blank cut by either edge is not.
 */
export const inRoom = (thing: Span, room: Span): boolean => thing.start >= room.start && thing.end <= room.end

/** Moves the Inbox's view by `dy` screen px: a glide, or at once with Reduce motion. The target is absolute, so a call during a glide lands right. */
export function glideView(view: HTMLElement, dy: number): void {
  arrowState.delete(view)
  scrollViewTo(view, view.scrollTop + dy / cssZoom(view))
}

/**
 * Smooth-scrolls `view` by a larger step on Up/Down (YAZ-6057). Chains target while held so repeats never stall.
 * Returns `true` when the view moved, or `false` when already at the top/bottom edge (YAZ-6393).
 */
export function arrowGlide(view: HTMLElement, delta: -1 | 1): boolean {
  const max = Math.max(0, view.scrollHeight - view.clientHeight)
  if (max < 1) return false
  const step = Math.max(ARROW_SCROLL_MIN_PX, Math.round(view.clientHeight * ARROW_SCROLL_FRACTION))
  const now = Date.now()
  const prev = arrowState.get(view)
  const base = prev !== undefined && now - prev.at <= ARROW_CHAIN_MS ? prev.target : view.scrollTop
  const target = Math.min(max, Math.max(0, base + delta * step))
  if (Math.abs(target - view.scrollTop) < 1 && (prev === undefined || Math.abs(target - prev.target) < 1)) return false
  arrowState.set(view, { target, at: now })
  scrollViewTo(view, target)
  return true
}

/**
 * On a final blank reveal (YAZ-6058), smooth-scroll to the bottom only when the bottom is already close
 * (<= half a viewport away), so Forgot / Remembered appear without skipping past unread text.
 */
export function glideToBottomIfNear(view: HTMLElement): void {
  const max = Math.max(0, view.scrollHeight - view.clientHeight)
  const remaining = max - view.scrollTop
  if (remaining < 1 || remaining > view.clientHeight * 0.5) return
  arrowState.delete(view)
  scrollViewTo(view, max)
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
  // YAZ-6058: at the end, page down smoothly (~70% of visible room per Space) so long tails/Side 2 are read in chunks,
  // snapping cleanly to the very bottom (showing Forgot / Remembered) once within ~1.2× a page step.
  const remaining = Math.max(0, view.scrollHeight - view.clientHeight - view.scrollTop) * cssZoom(view)
  if (remaining < 1) return 0
  const page = Math.max(ARROW_SCROLL_MIN_PX, Math.round((room.end - room.start) * SPACE_PAGE_FRACTION))
  return remaining <= page * 1.2 ? remaining : page
}
