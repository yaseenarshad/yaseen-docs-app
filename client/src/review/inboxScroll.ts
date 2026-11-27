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
import type { SpaceBehavior } from '@shared/reviews'
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
/** Fraction of visible room per Space page-down after the final reveal in jump mode (YAZ-6058), keeping ~30% reading overlap. */
export const SPACE_PAGE_FRACTION = 0.7
/** Bottom breathing room (~1.5 lines) below a blank inside the viewport before Space reveals it in scroll mode (YAZ-6591). */
export const BLANK_BOTTOM_MARGIN_PX = 32

const scrollState = new WeakMap<HTMLElement, { from: number; target: number; at: number }>()
const CHAIN_MS = 300

function scrollViewTo(view: HTMLElement, top: number): void {
  const smooth = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
  if (typeof view.scrollTo === 'function') view.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  else view.scrollTop = top
}

/**
 * The scrollTop `view` will land at when a smooth glide is in flight (within `CHAIN_MS`), else its live `scrollTop`.
 * Ignores stale targets if `view.scrollTop` moved outside the in-flight range (e.g. manual scroll or reset).
 */
export function effectiveScrollTop(view: HTMLElement, now = Date.now()): number {
  const prev = scrollState.get(view)
  if (prev === undefined || now - prev.at > CHAIN_MS) return view.scrollTop
  const lo = Math.min(prev.from, prev.target) - 1
  const hi = Math.max(prev.from, prev.target) + 1
  if (view.scrollTop < lo || view.scrollTop > hi) {
    scrollState.delete(view)
    return view.scrollTop
  }
  const max = Math.max(0, view.scrollHeight - view.clientHeight)
  return Math.min(max, Math.max(0, prev.target))
}

/** Clears any pending smooth-scroll target (e.g. when resetting `scrollTop` to 0 on a new card or restart). */
export function resetScrollChain(view: HTMLElement): void {
  scrollState.delete(view)
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

/** Moves the Inbox's view by `dy` screen px: a glide, or at once with Reduce motion. Chains onto any pending glide target so rapid Space presses never stall. */
export function glideView(view: HTMLElement, dy: number): void {
  const max = Math.max(0, view.scrollHeight - view.clientHeight)
  const now = Date.now()
  const base = effectiveScrollTop(view, now)
  const target = Math.min(max, Math.max(0, base + dy / cssZoom(view)))
  scrollState.set(view, { from: view.scrollTop, target, at: now })
  scrollViewTo(view, target)
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
  const base = effectiveScrollTop(view, now)
  const target = Math.min(max, Math.max(0, base + delta * step))
  if (Math.abs(target - view.scrollTop) < 1 && Math.abs(target - base) < 1) return false
  scrollState.set(view, { from: view.scrollTop, target, at: now })
  scrollViewTo(view, target)
  return true
}

/**
 * On a final blank reveal (YAZ-6058), smooth-scroll to the bottom only when the bottom is already close
 * (<= half a viewport away), so Forgot / Remembered appear without skipping past unread text.
 */
export function glideToBottomIfNear(view: HTMLElement): void {
  const max = Math.max(0, view.scrollHeight - view.clientHeight)
  const now = Date.now()
  const base = effectiveScrollTop(view, now)
  const remaining = max - base
  if (remaining < 1 || remaining > view.clientHeight * 0.5) return
  scrollState.set(view, { from: view.scrollTop, target: max, at: now })
  scrollViewTo(view, max)
}

/**
 * What the next Space acts on (round 6): the marked blank (its number), the next side, or the end (nothing left).
 */
export type SpaceTarget = number | 'side' | 'end'

export interface SpaceMovePlan {
  target: SpaceTarget
  room: Span
  /** Measured span of the marked blank (screen px), shifted for any pending glide. */
  blank?: Span
  /** Measured bottom edge of the card panel/body (screen px), shifted for any pending glide. */
  edge?: number
  /** Remaining downward scroll range (screen px) from the effective scroll top. */
  remainingDown: number
  /** Remaining upward scroll range (screen px, non-negative) from the effective scroll top. */
  remainingUp: number
  /** Visible scroll container height (screen px), used for the ~35% reading step. */
  viewportHeight: number
  mode: SpaceBehavior
}

function stepDown(wanted: number, step: number): number {
  if (wanted <= 0) return wanted
  return wanted <= step * 1.2 ? wanted : step
}

/**
 * Shared pure reading-scroll planner for Desktop Inbox, Desktop Card Preview, and Mobile Review (YAZ-6598).
 * Returns the clamped screen-px scroll delta for `target`, or `0` when Space / tap should reveal instead of scrolling.
 */
export function planSpaceMove({ target, room, blank, edge, remainingDown, remainingUp, viewportHeight, mode }: SpaceMovePlan): number {
  const height = room.end - room.start
  if (height <= 0) return 0
  const readStep = Math.max(ARROW_SCROLL_MIN_PX, Math.round(viewportHeight * ARROW_SCROLL_FRACTION))
  let dy = 0

  if (typeof target === 'number') {
    if (blank === undefined) return 0
    if (mode === 'scroll') {
      const hasBottomRoom = blank.end <= room.end - BLANK_BOTTOM_MARGIN_PX || (blank.end <= room.end && remainingDown < 1)
      if (blank.start >= room.start && hasBottomRoom) return 0
      let wanted = readingScroll(blank, room)
      if (wanted === 0 && blank.end > room.end - BLANK_BOTTOM_MARGIN_PX) {
        wanted = blank.end - (room.end - BLANK_BOTTOM_MARGIN_PX)
      }
      dy = stepDown(wanted, readStep)
    } else {
      dy = inRoom(blank, room) ? 0 : readingScroll(blank, room)
    }
  } else if (target === 'side') {
    if (edge === undefined) return 0
    const wanted = readingScroll({ start: edge, end: edge }, room)
    dy = mode === 'scroll' ? stepDown(wanted, readStep) : wanted
  } else {
    if (remainingDown < 1) return 0
    const page = mode === 'scroll' ? readStep : Math.max(ARROW_SCROLL_MIN_PX, Math.round(height * SPACE_PAGE_FRACTION))
    dy = stepDown(remainingDown, page)
  }

  if (dy === 0) return 0
  const move = Math.min(Math.max(dy, -Math.max(0, remainingUp)), Math.max(0, remainingDown))
  return Math.abs(move) < 1 ? 0 : move
}

/**
 * The move (screen px) a Space makes INSTEAD of showing, in the Inbox's view `view`; 0 when it may show.
 * Evaluates against `effectiveScrollTop(view)` so rapid Space presses during smooth scrolling chain cleanly.
 */
export function spaceMove(view: HTMLElement, target: SpaceTarget, mode: SpaceBehavior = 'scroll'): number {
  const room = inboxRoom(view)
  if (room.end - room.start <= 0) return 0
  const zoom = cssZoom(view)
  const base = effectiveScrollTop(view)
  const pendingShift = (view.scrollTop - base) * zoom
  const remainingDown = Math.max(0, view.scrollHeight - view.clientHeight - base) * zoom
  const remainingUp = Math.max(0, base) * zoom
  const viewportHeight = view.clientHeight > 0 ? view.clientHeight * zoom : room.end - room.start

  let blank: Span | undefined
  let edge: number | undefined
  if (typeof target === 'number') {
    const r = view.querySelector(`[data-hidden="${target}"]`)?.getBoundingClientRect()
    if (r === undefined) return 0
    blank = { start: r.top + pendingShift, end: r.bottom + pendingShift }
  } else if (target === 'side') {
    const bottom = view.querySelector('.card-inbox__panel')?.getBoundingClientRect().bottom
    if (bottom === undefined) return 0
    edge = bottom + pendingShift
  }

  return planSpaceMove({ target, room, blank, edge, remainingDown, remainingUp, viewportHeight, mode })
}
