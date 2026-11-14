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
}

export type TourAction =
  | { type: 'ready'; places: TourPlaces }
  | { type: 'blocked'; reason: string }
  | { type: 'click'; target: string }
  | { type: 'event'; name: string; detail?: string; at: number }
  | { type: 'frame'; at: number; onScreen: boolean }
  | { type: 'skip' }
  | { type: 'leave' }

/** After this long with the target not on screen, the coach offers "Show me". */
export const SHOW_ME_AFTER_MS = 4000
/** A typing step ends after this long with no more typing. */
export const SETTLE_MS = 1800
/** Events that come in a stream (each typed letter): their step ends once the stream pauses. */
const SETTLE_EVENTS = new Set(['card-text-changed'])
/** Events about a path: they count only for the tour's folder (exactly), or for a file inside it. */
const FOLDER_EVENTS = new Set(['folder-menu-open'])
const FILE_IN_FOLDER_EVENTS = new Set(['card-file-created', 'card-file-open'])

export function startTour(steps: readonly TourStep[]): TourState {
  return { steps, index: 0, status: steps.length === 0 ? 'finished' : 'checking', blocked: null, places: { folder: null, page: null }, lastCard: null, missingSince: null, settleAt: null }
}

export const currentStep = (s: TourState): TourStep | null => (s.status === 'running' ? (s.steps[s.index] ?? null) : null)

const advance = (s: TourState): TourState => {
  const index = s.index + 1
  return { ...s, index, status: index >= s.steps.length ? 'finished' : 'running', missingSince: null, settleAt: null }
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
    if (a.type === 'ready') return { ...s, status: 'running', places: a.places }
    if (a.type === 'blocked') return { ...s, status: 'blocked', blocked: a.reason }
    return s
  }
  if (s.status === 'blocked') return s
  const step = s.steps[s.index]
  switch (a.type) {
    case 'click':
      return step.done === 'click' && a.target === step.target ? advance(s) : s
    case 'event': {
      if (!eventCounts(a.name, a.detail, s.places)) return s
      const seen = a.detail !== undefined && FILE_IN_FOLDER_EVENTS.has(a.name) ? { ...s, lastCard: a.detail } : s
      if (step.done === 'click' || step.done.event !== a.name) return seen
      return SETTLE_EVENTS.has(a.name) ? { ...seen, settleAt: a.at + SETTLE_MS } : advance(seen)
    }
    case 'frame': {
      if (s.settleAt !== null && a.at >= s.settleAt) return advance(s)
      const missingSince = a.onScreen ? null : (s.missingSince ?? a.at)
      return missingSince === s.missingSince ? s : { ...s, missingSince }
    }
    case 'skip':
      return s.index === s.steps.length - 1 ? { ...s, status: 'left' } : advance(s)
    default:
      return s
  }
}

/** Is the coach looking for the target (not on screen)? Does it offer "Show me" yet? */
export const lookingFor = (s: TourState): boolean => s.status === 'running' && s.missingSince !== null
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

/** The dim: the whole window with a hole for each box (even-odd fill). */
export function dimPath(view: { width: number; height: number }, holes: readonly Box[], radius = 8): string {
  const parts = [`M0 0H${view.width}V${view.height}H0Z`]
  for (const h of holes) {
    if (h.width <= 0 || h.height <= 0) continue
    const r = Math.min(radius, h.width / 2, h.height / 2)
    const x = Math.round(h.left)
    const y = Math.round(h.top)
    const w = Math.round(h.width)
    const ht = Math.round(h.height)
    parts.push(`M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + ht - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + ht}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + ht - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`)
  }
  return parts.join('')
}

const overlaps = (a: Box, b: Box): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)))

/**
 * Where the coach card goes: near the target and never over it (below, above, right, left), or in a corner of the
 * window that it does not cover (bottom right first, as in the mockup). No target: bottom right.
 */
export function coachPlace(target: Box | null, coach: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } {
  const corner = (): { left: number; top: number } => {
    const corners = [
      { left: view.width - coach.width - MARGIN, top: view.height - coach.height - MARGIN },
      { left: MARGIN, top: view.height - coach.height - MARGIN },
      { left: view.width - coach.width - MARGIN, top: MARGIN },
      { left: MARGIN, top: MARGIN },
    ].map((c) => ({ left: Math.max(MARGIN, c.left), top: Math.max(MARGIN, c.top) }))
    return corners.find((c) => target === null || !overlaps({ ...c, ...coach }, target)) ?? corners[0]
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
  return tries.find((p) => fitsX(p.left) && fitsY(p.top) && !overlaps({ ...p, ...coach }, t)) ?? corner()
}
