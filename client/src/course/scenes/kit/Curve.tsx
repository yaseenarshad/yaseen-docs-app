/**
 * THE CURVE (YAZ-5121): the forgetting curve, as in the approved sample. Memory falls after you learn; a review lifts it
 * back to the top, and after each review it falls more slowly (its stability grows). The 90% line is where the app
 * brings a card back. `Ridge` is the other graph of chapter 1: memory kept against the gap before the review, with
 * its best moment in the middle.
 *
 * Both are inline SVG in a fixed viewBox (600 × 340) that scales with the stage. Every value is a prop: the scene
 * moves `cursor` (the day the curve has reached) and `jumps` (each review's lift, 0..1) from its beat. With reduced
 * motion the scene's `moved()` already snaps them; the curve then fades in place.
 */
import type { ReactNode } from 'react'
import { clamp, ease, lerp, type Beat } from './beat'

export const VIEW = { w: 600, h: 340, l: 64, r: 572, t: 34, b: 284 }

/** What memory falls to with no review at all: it never quite reaches nothing. */
export const FLOOR = 0.2
/** The first stability, in days (the sample's). */
export const S0 = 1.6

/** Memory `dt` days after a review whose stability is `s`: 1 at the review, falling toward `FLOOR`. */
export const memory = (dt: number, s: number): number => FLOOR + (1 - FLOOR) * Math.exp(-Math.max(0, dt) / s)

/** The day (after the review) when memory falls to `level`. */
export const dayAt = (level: number, s: number): number => -s * Math.log((level - FLOOR) / (1 - FLOOR))

export interface Review {
  day: number
  /** The stability after this review, in days. */
  s: number
  label?: string
}

/** The sample's reviews: the next day, then a day, a week and a month apart (s2b's "A day. A week. A month."). */
export const SAMPLE_REVIEWS: readonly Review[] = [
  { day: 1, s: 6, label: 'review' },
  { day: 2, s: 18.7, label: 'a day' },
  { day: 9, s: 117, label: 'a week' },
  { day: 39, s: 400, label: 'a month' },
]

export interface Axis {
  /** The days across the full width. */
  days: number
  /** 1: even; under 1 stretches the first days (the sample's 0.55 for a month). */
  warp?: number
}

export const xOf = (axis: Axis, day: number): number => VIEW.l + (VIEW.r - VIEW.l) * Math.pow(clamp(day / axis.days, 0, 1.2), axis.warp ?? 1)
/** The y of memory `r`; `lo` is the memory at the bottom of the axis (0, or 0.8 to look closely at the top). */
export const yOf = (r: number, lo = 0): number => VIEW.b - ((VIEW.b - VIEW.t) * (r - lo)) / (1 - lo)

/** The curve's points up to day `cursor`: falls, and a lift at each review as far as its jump has gone. */
export function curvePoints(axis: Axis, cursor: number, reviews: readonly Review[] = [], jumps: readonly number[] = [], s0 = S0, lo = 0): [number, number][] {
  const pts: [number, number][] = []
  let start = 0
  let s = s0
  const seg = (a: number, b: number): void => {
    const n = Math.max(2, Math.ceil(Math.abs(xOf(axis, b) - xOf(axis, a)) / 3))
    for (let i = 0; i <= n; i++) {
      const day = a + (b - a) * (i / n)
      pts.push([xOf(axis, day), yOf(memory(day - start, s), lo)])
    }
  }
  for (let k = 0; k < reviews.length; k++) {
    const r = reviews[k]
    const j = jumps[k] ?? 0
    if (!(j > 0) || cursor < r.day - 1e-6) break
    seg(start, r.day)
    const before = memory(r.day - start, s)
    pts.push([xOf(axis, r.day), yOf(before + (1 - before) * j, lo)])
    if (j < 1) return pts
    start = r.day
    s = r.s
  }
  seg(start, Math.max(start, cursor))
  return pts
}

export const pathOf = (pts: readonly [number, number][]): string => (pts.length === 0 ? '' : `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}`)

export interface CurveProps {
  beat: Beat
  axis: Axis
  /** 0..1: the axes, the "Today" dot and the axis words. */
  axes: number
  /** The day the curve has reached (0: none drawn). */
  cursor: number
  reviews?: readonly Review[]
  jumps?: readonly number[]
  s0?: number
  /** 0..1: the curve with no review, dashed, behind. */
  ghost?: number
  /** 0..1: the dotted 90% line, "The card comes back here". */
  line90?: number
  /** Day ticks on the x axis, with their opacity. */
  ticks?: readonly { day: number; label: string; p: number }[]
  /** Points as dots (an old study's), as [day, memory 0..1], with their opacity. */
  dots?: { points: readonly (readonly [number, number])[]; p: number }
  /** Words on the stage, at a day and a memory level. */
  notes?: readonly { day: number; r: number; text: string; p: number; tone?: 'accent' | 'muted' | 'strong'; anchor?: 'start' | 'middle' | 'end' }[]
  /** 0..1: the main curve's opacity (default 1). */
  opacity?: number
  /** 0..1: the curve glows (it is the one to look at). */
  glow?: number
  yLabel?: string
  xLabel?: string
  /** The memory at the bottom of the y axis (default 0). */
  lo?: number
  /** The "Today" dot at the top left (default shown). */
  today?: boolean
  children?: ReactNode
}

export function Curve({ beat, axis, axes, cursor, reviews = [], jumps = [], s0 = S0, ghost = 0, line90 = 0, ticks = [], dots, notes = [], opacity = 1, glow = 0, yLabel = 'How much you remember', xLabel = 'Days', lo = 0, today = true, children }: CurveProps) {
  const pts = cursor > 0 ? curvePoints(axis, cursor, reviews, jumps, s0, lo) : []
  const head = pts.length > 0 ? pts[pts.length - 1] : null
  const a = clamp(axes)
  return (
    <svg className="kit-curve" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g opacity={a}>
        <line className="kit-ax" x1={VIEW.l} y1={VIEW.b} x2={VIEW.r} y2={VIEW.b} />
        <line className="kit-ax" x1={VIEW.l} y1={VIEW.t - 8} x2={VIEW.l} y2={VIEW.b} />
        <line className="kit-grid" x1={VIEW.l} y1={yOf(1, lo)} x2={VIEW.r} y2={yOf(1, lo)} />
        <text className="kit-svg-note" x={VIEW.l - 24} y={(VIEW.t + VIEW.b) / 2} textAnchor="middle" transform={`rotate(-90 ${VIEW.l - 24} ${(VIEW.t + VIEW.b) / 2})`}>
          {yLabel}
        </text>
        <text className="kit-svg-note" x={VIEW.r} y={VIEW.b + 40} textAnchor="end">
          {xLabel}
        </text>
      </g>
      {ticks.map((tick) => (
        <g key={tick.label} opacity={clamp(tick.p) * a}>
          <line className="kit-ax" x1={xOf(axis, tick.day)} y1={VIEW.b} x2={xOf(axis, tick.day)} y2={VIEW.b + 4} />
          <text className="kit-svg-note" x={xOf(axis, tick.day)} y={VIEW.b + 20} textAnchor="middle">
            {tick.label}
          </text>
        </g>
      ))}
      {line90 > 0 && (
        <g opacity={clamp(line90)}>
          <line className="kit-line90" x1={VIEW.l} y1={yOf(0.9, lo)} x2={lerp(VIEW.l, VIEW.r, beat.reduced ? 1 : ease.out(clamp(line90)))} y2={yOf(0.9, lo)} />
          <text className="kit-svg-note kit-svg-note--accent" x={VIEW.r} y={yOf(0.9, lo) - 8} textAnchor="end">
            90%
          </text>
        </g>
      )}
      {ghost > 0 && <path className="kit-ghost" d={pathOf(curvePoints(axis, axis.days, [], [], s0, lo))} opacity={0.6 * clamp(ghost)} />}
      {dots !== undefined && (
        <g opacity={clamp(dots.p)}>
          {dots.points.map(([day, r], i) => (
            <circle key={i} className="kit-dot-old" cx={xOf(axis, day)} cy={yOf(r, lo)} r={5} />
          ))}
        </g>
      )}
      {glow > 0 && <path className="kit-curve-glow" d={pathOf(pts)} opacity={0.35 * clamp(glow)} />}
      <path className="kit-curve-line" d={pathOf(pts)} opacity={clamp(opacity)} />
      {reviews.map((r, i) => {
        const j = jumps[i] ?? 0
        if (!(j > 0) || cursor < r.day) return null
        const x = xOf(axis, r.day)
        return (
          <g key={r.day}>
            <circle className="kit-dot" cx={x} cy={yOf(1, lo)} r={4.5 * (beat.reduced ? 1 : ease.back(clamp(j)))} />
            {r.label !== undefined && (
              <text className="kit-svg-label" x={x} y={yOf(1, lo) - 13} textAnchor="middle" opacity={clamp(j * 1.5) * a}>
                {r.label}
              </text>
            )}
          </g>
        )
      })}
      <g opacity={today ? a : 0}>
        <circle className="kit-dot" cx={xOf(axis, 0)} cy={yOf(1, lo)} r={5} />
        <text className="kit-svg-label" x={xOf(axis, 0)} y={yOf(1, lo) - 13} textAnchor="middle">
          Today
        </text>
      </g>
      {head !== null && cursor > 0.05 && <circle className="kit-dot-hollow" cx={head[0]} cy={head[1]} r={4.5} opacity={clamp(opacity)} />}
      {notes.map((n) => (
        <text key={n.text} className={`kit-svg-label${n.tone === 'accent' ? ' kit-svg-label--accent' : n.tone === 'muted' ? ' kit-svg-note' : ''}`} x={xOf(axis, n.day)} y={yOf(n.r, lo)} textAnchor={n.anchor ?? 'middle'} opacity={clamp(n.p)}>
          {n.text}
        </text>
      ))}
      {children}
    </svg>
  )
}

/** The ridge's shape: memory kept against the gap (0..1 across), its peak at `peakAt`. */
export const ridgeAt = (x: number, peakAt = 0.36): number => {
  const k = peakAt
  const v = Math.pow(x / k, 1.4) * Math.exp(1.4 * (1 - x / k))
  return 0.18 + 0.74 * v
}

/**
 * THE RIDGE: one study's graph, drawn simply. Too early or too late, and you keep less; the best gap is the peak.
 * `draw` draws the line left to right; `early`, `late` and `peak` bring in their markers.
 */
export function Ridge({ beat, draw, early = 0, late = 0, peak = 0, peakAt = 0.36 }: { beat: Beat; draw: number; early?: number; late?: number; peak?: number; peakAt?: number }) {
  const n = 60
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const x = i / n
    pts.push([lerp(VIEW.l, VIEW.r, x), yOf(ridgeAt(x, peakAt))])
  }
  const d = beat.reduced ? (draw > 0 ? 1 : 0) : ease.inOut(clamp(draw))
  const at = (x: number): [number, number] => [lerp(VIEW.l, VIEW.r, x), yOf(ridgeAt(x, peakAt))]
  const marker = (x: number, p: number, text: string, tone: 'danger' | 'accent') => {
    const [cx, cy] = at(x)
    return (
      <g opacity={clamp(p * 2)}>
        <circle className={tone === 'accent' ? 'kit-dot' : 'kit-dot-danger'} cx={cx} cy={cy} r={(tone === 'accent' ? 7 : 5) * (beat.reduced ? 1 : ease.back(clamp(p)))} />
        {tone === 'accent' && !beat.reduced && <circle className="kit-ring" cx={cx} cy={cy} r={7 + 16 * ease.out(clamp(p))} opacity={0.6 * (1 - clamp(p))} />}
        <text className={`kit-svg-label${tone === 'accent' ? ' kit-svg-label--accent' : ''}`} x={cx} y={cy - 16} textAnchor="middle">
          {text}
        </text>
      </g>
    )
  }
  return (
    <svg className="kit-curve" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g opacity={clamp(draw * 3)}>
        <line className="kit-ax" x1={VIEW.l} y1={VIEW.b} x2={VIEW.r} y2={VIEW.b} />
        <line className="kit-ax" x1={VIEW.l} y1={VIEW.t - 8} x2={VIEW.l} y2={VIEW.b} />
        <text className="kit-svg-note" x={VIEW.l - 24} y={(VIEW.t + VIEW.b) / 2} textAnchor="middle" transform={`rotate(-90 ${VIEW.l - 24} ${(VIEW.t + VIEW.b) / 2})`}>
          Memory kept
        </text>
        <text className="kit-svg-note" x={VIEW.l} y={VIEW.b + 22} textAnchor="start">
          Short gap
        </text>
        <text className="kit-svg-note" x={VIEW.r} y={VIEW.b + 22} textAnchor="end">
          Long gap
        </text>
        <text className="kit-svg-note" x={(VIEW.l + VIEW.r) / 2} y={VIEW.b + 40} textAnchor="middle">
          The gap before the review
        </text>
      </g>
      {peak > 0 && <line className="kit-line90" x1={at(peakAt)[0]} y1={VIEW.b} x2={at(peakAt)[0]} y2={at(peakAt)[1]} opacity={clamp(peak)} />}
      <path className="kit-curve-line" d={pathOf(pts)} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - d} />
      {marker(0.07, early, 'Too early', 'danger')}
      {marker(0.9, late, 'Too late', 'danger')}
      {marker(peakAt, peak, 'The best moment', 'accent')}
    </svg>
  )
}
