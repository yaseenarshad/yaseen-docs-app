/**
 * THE HEAD (YAZ-5121; the kit's one head, YAZ-5128): the person, as a calm outline of a head in profile, facing right.
 * What they know goes inside it, in the same places in every chapter.
 *
 * - `p`: the outline draws in; `glow`: a soft light fills the mind.
 * - `dots`: cards in the mind (positions in 0..1 of the mind's area; chapter 6's card base); `noise`: 0..1 grey static
 *   over the mind (chapter 8: the flood of cards nobody thought through).
 * - `light`: one card that travels up into the mind (`arrive` 0 → 1) and stays there as a small steady light
 *   (chapter 5: "part of what you know"); it breathes while the clip plays.
 * - `children`: drawings inside the head, in the view's own units (600 × 340; the mind is about x 230 to 380, y 90 to
 *   220), clipped to the outline (chapter 10's web, the finale's card).
 * - Reduced motion: the outline and the dots cross-fade, the light fades in at its place; nothing travels.
 */
import { useId, type CSSProperties, type ReactNode } from 'react'
import { clamp, ease, lerp, type Beat } from './beat'
import './kit.css'

export interface HeadDot {
  x: number
  y: number
  /** 0..1: the dot comes in. Missing: shown. */
  p?: number
  tone?: 'accent' | 'grey' | 'fg'
  /** 0..1: a ring around the dot (look here). */
  ring?: number
}

/** The outline: the back of the head on the left, the face on the right, the neck at the bottom. */
const OUTLINE =
  'M232 336 C232 300 214 276 204 246 C184 194 190 124 242 88 C292 52 372 58 402 104 C416 126 418 142 420 162 L442 196 C440 202 432 204 426 206 C430 216 430 224 423 232 C430 240 426 252 410 258 C394 263 380 262 372 268 L370 336 Z'

/** The view around the outline. */
const VIEW = '176 48 284 292'

/** The mind's area: dots, static and the light go in it. */
const MIND = { x0: 232, x1: 378, y0: 100, y1: 214 }
const mindPoint = (x: number, y: number): [number, number] => [lerp(MIND.x0, MIND.x1, x), lerp(MIND.y0, MIND.y1, y)]
/** Where the light settles. */
const LIGHT_AT = mindPoint(0.52, 0.5)

/** Grey static: short strokes in the mind, the same each frame for the same `noise`. */
const NOISE = (() => {
  const out: { x: number; y: number; a: number }[] = []
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (let i = 0; i < 140; i++) out.push({ x: rnd(), y: rnd(), a: rnd() * 180 })
  return out
})()

export interface HeadProps {
  beat: Beat
  p?: number
  glow?: number
  dots?: readonly HeadDot[]
  noise?: number
  light?: { arrive: number }
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** Its words for a screen reader; absent: a drawing only. */
  label?: string
}

export function Head({ beat, p = 1, glow = 0, dots = [], noise = 0, light, children, className, style, label }: HeadProps) {
  const id = useId()
  const draw = beat.reduced ? (p > 0 ? 1 : 0) : ease.inOut(clamp(p))
  const g = clamp(glow)
  const shown = Math.round(NOISE.length * clamp(noise))
  const a = clamp(light?.arrive ?? 0)
  const m = beat.reduced ? 1 : ease.inOut(a)
  const breathe = beat.reduced || !beat.playing ? 0 : Math.sin(beat.t * 2.1) * 0.06
  const lx = LIGHT_AT[0]
  const ly = lerp(380, LIGHT_AT[1], m)
  return (
    <svg
      className={`kit-head${className === undefined ? '' : ` ${className}`}`}
      viewBox={VIEW}
      preserveAspectRatio="xMidYMid meet"
      style={{ ...style, opacity: (beat.reduced ? clamp(p) : clamp(p * 3)) * (style?.opacity === undefined ? 1 : Number(style.opacity)) }}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <defs>
        <clipPath id={`${id}clip`}>
          <path d={OUTLINE} />
        </clipPath>
        <radialGradient id={`${id}glow`}>
          <stop offset="0" className="kit-head__glow-in" />
          <stop offset="1" className="kit-head__glow-out" />
        </radialGradient>
      </defs>
      <path className="kit-head__fill" d={OUTLINE} opacity={draw} />
      <g clipPath={`url(#${id}clip)`}>
        {g > 0 && <circle cx={305} cy={160} r={lerp(40, 150, beat.reduced ? 1 : ease.out(g))} fill={`url(#${id}glow)`} opacity={g} />}
        {children}
        {NOISE.slice(0, shown).map((s, i) => {
          const [x, y] = mindPoint(s.x, s.y)
          return <line key={i} className="kit-head__noise" x1={x - 4} y1={y} x2={x + 4} y2={y} transform={`rotate(${s.a.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`} />
        })}
        {dots.map((d, i) => {
          const q = clamp(d.p ?? 1)
          if (q <= 0) return null
          const [x, y] = mindPoint(d.x, d.y)
          const ring = clamp(d.ring ?? 0)
          return (
            <g key={i} opacity={clamp(q * 2)}>
              {ring > 0 && <circle className="kit-head__ring" cx={x} cy={y} r={6 + 8 * ring} opacity={ring} />}
              <circle className={`kit-head__dot kit-head__dot--${d.tone ?? 'accent'}`} cx={x} cy={y} r={beat.reduced ? 5.5 : lerp(1.5, 5.5, ease.back(q))} />
            </g>
          )
        })}
      </g>
      <path className="kit-head__outline" d={OUTLINE} pathLength={1} strokeDasharray={1} strokeDashoffset={(1 - draw).toFixed(4)} />
      {a > 0 && (
        <g opacity={beat.reduced ? a : clamp(a * 3)}>
          <circle cx={lx} cy={ly} r={30 * (1 + breathe)} fill={`url(#${id}glow)`} />
          <circle className="kit-head__light" cx={lx} cy={ly} r={lerp(8, 6, m) * (1 + breathe * 0.5)} />
        </g>
      )}
    </svg>
  )
}
