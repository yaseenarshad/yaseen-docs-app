/**
 * THE GUIDED TOUR AS PURE LOGIC (YAZ-5123, issue 6E): "Try it in the app". The layer (`TourLayer.tsx`) feeds it what
 * happens (a click on a marked control, an app event, a frame with the target on screen or not, Skip, Esc) and draws
 * what it says. Nothing here reads the DOM or a clock.
 *
 * - A step ends only on the person's real action: a click on its target (`done: 'click'`), or its app event
 *   (`done: { event }`). Any other action does nothing.
 * - Typing (`card-text-changed`) ends its step after a short pause, so the person can finish the sentence.
 * - A path event counts only for the tour's own place: the Course Cards folder's menu, a card file in that folder.
 * - A target that is not on screen: the tour waits. After `SHOW_ME_AFTER_MS` it offers "Show me". Skip is always there.
 * - A tour whose precondition cannot be met (no Course Cards folder, no card yet) is `blocked`: one line, and the way
 *   back to the course.
 * - Skip on the last step, "Back to the course" and Esc leave the tour (`left`); the last step done finishes it.
 *
 * LIVE STEPS (YAZ-5366): the same engine runs a clip's live steps, with two more rules.
 * - `reached`: how many of the steps have had their moment (the clip's mark, or the end of its words). A step past it
 *   is not shown yet (`shownStep` is null: no light, no coach), but the person's real action still counts for it, so
 *   a person who is ahead of the voice is never left waiting for an action already done.
 * - A show step (`done: 'show'`) takes no action: it moves on when the next step's moment comes (`reach`).
 *
 * THE SAFE EXAMPLE (YAZ-5366): "Use an example" types only into Course Cards. `exampleSafe` says yes only for the name
 * box of the course's own folder (its menu was the last folder menu opened) and for the editor of a card file in that
 * folder (the last card file opened or made).
 */
import type { TourStep } from './tour'
import type { TourPlaces } from './tourBus'

type TourStatus = 'checking' | 'blocked' | 'running' | 'finished' | 'left'

export interface TourState {
  steps: readonly TourStep[]
  index: number
  status: TourStatus
  /** The one line of a blocked tour. */
  blocked: string | null
  /** The tour's places (the Course Cards folder, its Course page); null until the check is done. */
  places: TourPlaces
  /** The card file the person made or opened last in this tour, for "Show me". */
  lastCard: string | null
  /** Since when the step's target is not on screen (ms); null while it shows. */
  missingSince: number | null
  /** A typing step ends at this time, unless more typing comes first. */
  settleAt: number | null
  /** How many steps have had their moment (live steps); a tour has them all at once. */
  reached: number
  /** The folder whose menu was opened last, wherever it is (the safe example). */
  lastMenu: string | null
  /** The card file opened or made last, wherever it is (the safe example). */
  lastFile: string | null
}

export type TourAction =
  | { type: 'ready'; places: TourPlaces }
  | { type: 'blocked'; reason: string }
  | { type: 'click'; target: string }
  | { type: 'event'; name: string; detail?: string; at: number }
  | { type: 'frame'; at: number; onScreen: boolean }
  | { type: 'skip' }
  | { type: 'leave' }
  /** Live steps: this many steps have had their moment now. */
  | { type: 'reach'; count: number }

/** After this long with the target not on screen, the coach offers "Show me". */
export const SHOW_ME_AFTER_MS = 4000
/** A typing step ends after this long with no more typing. */
export const SETTLE_MS = 1800
/** Events that come in a stream (each typed letter): their step ends once the stream pauses. */
const SETTLE_EVENTS = new Set(['card-text-changed'])
/** Events about a path: they count only for the tour's folder (exactly), or for a file inside it. */
const FOLDER_EVENTS = new Set(['folder-menu-open'])
const FILE_IN_FOLDER_EVENTS = new Set(['card-file-created', 'card-file-open'])

export function startTour(steps: readonly TourStep[], reached = Number.POSITIVE_INFINITY): TourState {
  return { steps, index: 0, status: steps.length === 0 ? 'finished' : 'checking', blocked: null, places: { folder: null, page: null }, lastCard: null, missingSince: null, settleAt: null, reached, lastMenu: null, lastFile: null }
}

/** The step whose action the tour waits for now. */
export const currentStep = (s: TourState): TourStep | null => (s.status === 'running' ? (s.steps[s.index] ?? null) : null)
/** The step the layer lights now: the current step, once its moment has come. */
export const shownStep = (s: TourState): TourStep | null => (s.index < s.reached ? currentStep(s) : null)

/** Show steps whose next step's moment has come move on by themselves. */
const settleShows = (s: TourState): TourState => {
  let next = s
  while (next.status === 'running' && next.steps[next.index]?.done === 'show' && next.reached > next.index + 1) next = advance(next)
  return next
}
function advance(s: TourState): TourState {
  const index = s.index + 1
  return settleShows({ ...s, index, status: index >= s.steps.length ? 'finished' : 'running', missingSince: null, settleAt: null })
}

/** Pure: may "Use an example" type into this step's field? Only into Course Cards (see the head of this file). */
export function exampleSafe(s: TourState, step: TourStep): boolean {
  const folder = s.places.folder
  if (folder === null || step.example === undefined) return false
  if (step.target === 'new-card-name') return s.lastMenu === folder
  if (step.target === 'card-editor') return s.lastFile !== null && s.lastFile.startsWith(`${folder}/`)
  return false
}

/** Does this event, with its path, count for the tour's places? */
export function eventCounts(name: string, detail: string | undefined, places: TourPlaces): boolean {
  if (places.folder === null || detail === undefined) return true
  if (FOLDER_EVENTS.has(name)) return detail === places.folder
  if (FILE_IN_FOLDER_EVENTS.has(name)) return detail.startsWith(`${places.folder}/`)
  return true
}

export function tourStep(s: TourState, a: TourAction): TourState {
  if (s.status === 'finished' || s.status === 'left') return s
  if (a.type === 'leave') return { ...s, status: 'left' }
  if (s.status === 'checking') {
    if (a.type === 'ready') return settleShows({ ...s, status: 'running', places: a.places })
    if (a.type === 'blocked') return { ...s, status: 'blocked', blocked: a.reason }
    return s
  }
  if (a.type === 'reach') {
    const reached = Math.max(0, a.count)
    return reached === s.reached ? s : settleShows({ ...s, reached, missingSince: s.index < reached ? s.missingSince : null })
  }
  if (s.status === 'blocked') return s
  const step = s.steps[s.index]
  switch (a.type) {
    case 'click':
      return step.done === 'click' && a.target === step.target ? advance(s) : s
    case 'event': {
      // Where the person is, for the safe example: every folder menu and every card file, in the folder or not.
      const where =
        a.detail === undefined ? s
        : FOLDER_EVENTS.has(a.name) ? (s.lastMenu === a.detail ? s : { ...s, lastMenu: a.detail })
        : FILE_IN_FOLDER_EVENTS.has(a.name) ? (s.lastFile === a.detail ? s : { ...s, lastFile: a.detail })
        : s
      if (!eventCounts(a.name, a.detail, s.places)) return where
      const seen = a.detail !== undefined && FILE_IN_FOLDER_EVENTS.has(a.name) ? { ...where, lastCard: a.detail } : where
      if (step.done === 'click' || step.done === 'show' || step.done.event !== a.name) return seen
      return SETTLE_EVENTS.has(a.name) ? { ...seen, settleAt: a.at + SETTLE_MS } : advance(seen)
    }
    case 'frame': {
      if (s.settleAt !== null && a.at >= s.settleAt) return advance(s)
      // A step whose moment has not come is not looked for.
      const missingSince = a.onScreen || s.index >= s.reached ? null : (s.missingSince ?? a.at)
      return missingSince === s.missingSince ? s : { ...s, missingSince }
    }
    case 'skip':
      return s.index === s.steps.length - 1 ? { ...s, status: 'left' } : advance(s)
    default:
      return s
  }
}

/** Is the coach looking for the target (not on screen)? Does it offer "Show me" yet? */
export const lookingFor = (s: TourState): boolean => s.status === 'running' && s.index < s.reached && s.missingSince !== null
export const offersShowMe = (s: TourState, now: number): boolean => lookingFor(s) && now - (s.missingSince ?? now) >= SHOW_ME_AFTER_MS

// ---- geometry (pure) ----

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The space around the target that the hole and the ring leave free. */
const SPOT_PAD = 4
const GAP = 12
const MARGIN = 12

/** The hole around a box: padded, and kept inside the window. */
export function holeOf(b: Box, view: { width: number; height: number }, pad = SPOT_PAD): Box {
  const left = Math.max(0, b.left - pad)
  const top = Math.max(0, b.top - pad)
  const right = Math.min(view.width, b.left + b.width + pad)
  const bottom = Math.min(view.height, b.top + b.height + pad)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** One hole cut in the dim: a rounded box. */
export interface DimHole {
  x: number
  y: number
  width: number
  height: number
  r: number
}

/**
 * The dim's holes, one per box (empty ones left out). The layer cuts them with a mask, so the holes are a UNION
 * (YAZ-5403): a menu that opens over the lit control, or a lit row inside an open menu, stays bright where they overlap.
 * (An even-odd path filled the overlap again: the `/` menu over the lit card editor, and "New card" lit inside the
 * folder's menu, came out dark.)
 */
export function dimHoles(holes: readonly Box[], radius = 8): DimHole[] {
  return holes
    .filter((h) => h.width > 0 && h.height > 0)
    .map((h) => {
      const width = Math.round(h.width)
      const height = Math.round(h.height)
      return { x: Math.round(h.left), y: Math.round(h.top), width, height, r: Math.min(radius, width / 2, height / 2) }
    })
}

// ---- the arrow (YAZ-5405) ----

export type ArrowSide = 'left' | 'right' | 'top' | 'bottom'
export interface ArrowPlace {
  /** The side of the target the arrow sits on; it points from there at the target. */
  side: ArrowSide
  left: number
  top: number
  width: number
  height: number
}
/** The arrow's size along its line (`length`) and across it (`thick`), and its gap to the lit hole (past the ring). */
export const ARROW = { length: 44, thick: 28, gap: 12 }

/**
 * Where the red arrow goes (YAZ-5405): outside the lit hole, on the side with the most free room, pointing at it.
 * It stays in the window, and off every box in `avoid` (the coach card, the docked course, an open menu) when a side
 * allows; else on the roomiest side that fits. No side fits (a target that fills the window): null, the ring alone.
 */
export function arrowPlace(target: Box, view: { width: number; height: number }, avoid: readonly Box[] = []): ArrowPlace | null {
  const { length: L, thick: T, gap: G } = ARROW
  // The arrow's line goes through the middle of the target's part that is in the window.
  const midX = clamp((Math.max(0, target.left) + Math.min(view.width, target.left + target.width)) / 2, T / 2, view.width - T / 2)
  const midY = clamp((Math.max(0, target.top) + Math.min(view.height, target.top + target.height)) / 2, T / 2, view.height - T / 2)
  const sides: Array<ArrowPlace & { room: number }> = [
    { side: 'left', room: target.left, left: target.left - G - L, top: midY - T / 2, width: L, height: T },
    { side: 'right', room: view.width - (target.left + target.width), left: target.left + target.width + G, top: midY - T / 2, width: L, height: T },
    { side: 'top', room: target.top, left: midX - T / 2, top: target.top - G - L, width: T, height: L },
    { side: 'bottom', room: view.height - (target.top + target.height), left: midX - T / 2, top: target.top + target.height + G, width: T, height: L },
  ]
  const fits = (p: Box): boolean => p.left >= 0 && p.top >= 0 && p.left + p.width <= view.width && p.top + p.height <= view.height
  const clear = (p: Box): boolean => avoid.every((a) => !overlaps(p, a))
  const ranked = sides.filter(fits).sort((a, b) => b.room - a.room)
  const pick = ranked.find(clear) ?? ranked[0]
  if (pick === undefined) return null
  return { side: pick.side, left: Math.round(pick.left), top: Math.round(pick.top), width: pick.width, height: pick.height }
}

const overlaps = (a: Box, b: Box): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)))

/**
 * Where the coach card goes: near the target and never over it (below, above, right, left), or in a corner of the
 * window that it does not cover (bottom right first, as in the mockup). No target: bottom right.
 * `avoid` (YAZ-5365): the docked course's box; the coach card never sits under it either.
 */
export function coachPlace(target: Box | null, coach: { width: number; height: number }, view: { width: number; height: number }, avoid: Box | null = null): { left: number; top: number } {
  const free = (p: { left: number; top: number }): boolean => avoid === null || !overlaps({ ...p, ...coach }, avoid)
  const corner = (): { left: number; top: number } => {
    const corners = [
      { left: view.width - coach.width - MARGIN, top: view.height - coach.height - MARGIN },
      { left: MARGIN, top: view.height - coach.height - MARGIN },
      { left: view.width - coach.width - MARGIN, top: MARGIN },
      { left: MARGIN, top: MARGIN },
    ].map((c) => ({ left: Math.max(MARGIN, c.left), top: Math.max(MARGIN, c.top) }))
    return corners.find((c) => (target === null || !overlaps({ ...c, ...coach }, target)) && free(c)) ?? corners.find((c) => target === null || !overlaps({ ...c, ...coach }, target)) ?? corners[0]
  }
  if (target === null) return corner()
  const t = target
  const fitsX = (left: number) => left >= MARGIN && left + coach.width <= view.width - MARGIN
  const fitsY = (top: number) => top >= MARGIN && top + coach.height <= view.height - MARGIN
  const alongX = clamp(t.left, MARGIN, view.width - coach.width - MARGIN)
  const alongY = clamp(t.top, MARGIN, view.height - coach.height - MARGIN)
  const tries = [
    { left: alongX, top: t.top + t.height + GAP },
    { left: alongX, top: t.top - GAP - coach.height },
    { left: t.left + t.width + GAP, top: alongY },
    { left: t.left - GAP - coach.width, top: alongY },
  ]
  return tries.find((p) => fitsX(p.left) && fitsY(p.top) && !overlaps({ ...p, ...coach }, t) && free(p)) ?? corner()
}
