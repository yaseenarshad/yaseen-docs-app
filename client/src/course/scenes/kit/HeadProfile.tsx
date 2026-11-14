/**
 * THE HEAD IN PROFILE (YAZ-5121, chapters 6 to 8): "your card base is your knowledge base". A calm outline of a head,
 * facing right, with a map of small dots where the mind is: each dot is a card, in the same places as the card base
 * beside it. A dot is a pure function of its own progress; `static` fills the head with grey noise (chapter 8: the
 * flood of cards nobody thought through).
 *
 * - `dots`: positions in 0..1 of the mind's area; `p` brings each in; `tone` accent (yours), grey (not thought
 *   through) or fg.
 * - `p`: the outline draws in; `glow`: a soft light behind the mind; `noise`: 0..1 grey static over the mind.
 * - Reduced motion: the outline and the dots cross-fade; nothing travels.
 */
import type { CSSProperties } from 'react'
import { clamp, ease, lerp, type Beat } from './beat'
import './kit68.css'

export interface HeadDot {
  x: number
  y: number
  /** 0..1: the dot comes in. Missing: shown. */
  p?: number
  tone?: 'accent' | 'grey' | 'fg'
  /** 0..1: a ring around the dot (look here). */
  ring?: number
}

/** The outline: the back of the head on the left, the face on the right, the neck below. */
const OUTLINE =
  'M64 214 C66 196 66 182 58 168 C38 150 30 124 32 96 C35 50 72 18 118 18 C160 18 186 50 186 88 C186 100 188 108 195 120 C199 127 196 132 188 134 C191 141 188 147 182 149 C186 155 184 162 177 164 C180 176 173 186 158 186 C147 186 140 189 138 200 L137 214'

/** The mind's area, in the outline's view: the dots are placed in it. */
const MIND = { x0: 54, x1: 160, y0: 44, y1: 136 }

/** A dot's place in the outline's view. */
export const mindPoint = (x: number, y: number): [number, number] => [lerp(MIND.x0, MIND.x1, x), lerp(MIND.y0, MIND.y1, y)]

/** Grey static: short strokes in the mind, the same each frame for the same `noise`. */
function noiseStrokes(n: number): { x: number; y: number; a: number }[] {
  const out: { x: number; y: number; a: number }[] = []
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (let i = 0; i < n; i++) out.push({ x: rnd(), y: rnd(), a: rnd() * 180 })
  return out
}
const NOISE = noiseStrokes(140)

export function HeadProfile({ beat, p = 1, dots = [], glow = 0, noise = 0, style, label }: { beat: Beat; p?: number; dots?: readonly HeadDot[]; glow?: number; noise?: number; style?: CSSProperties; label?: string }) {
  const draw = beat.reduced ? (p > 0 ? 1 : 0) : ease.inOut(clamp(p))
  const g = clamp(glow)
  const shown = Math.round(NOISE.length * clamp(noise))
  return (
    <svg className="kit-head" viewBox="0 0 220 224" style={{ ...style, opacity: beat.reduced ? clamp(p) : clamp(p * 3) * (style?.opacity === undefined ? 1 : Number(style.opacity)) }} role={label === undefined ? undefined : 'img'} aria-label={label} aria-hidden={label === undefined ? true : undefined}>
      {g > 0 && <ellipse className="kit-head__glow" cx={107} cy={90} rx={lerp(40, 68, g)} ry={lerp(34, 56, g)} opacity={0.32 * g} />}
      <path className="kit-head__outline" d={OUTLINE} pathLength={1} strokeDasharray={1} strokeDashoffset={(1 - draw).toFixed(4)} />
      {shown > 0 &&
        NOISE.slice(0, shown).map((s, i) => {
          const [x, y] = mindPoint(s.x, s.y)
          return <line key={`n${i}`} className="kit-head__noise" x1={x - 3} y1={y} x2={x + 3} y2={y} transform={`rotate(${s.a.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`} />
        })}
      {dots.map((d, i) => {
        const q = clamp(d.p ?? 1)
        if (q <= 0) return null
        const [x, y] = mindPoint(d.x, d.y)
        const r = beat.reduced ? 4 : lerp(1, 4, ease.back(q))
        const ring = clamp(d.ring ?? 0)
        return (
          <g key={i} opacity={clamp(q * 2)}>
            {ring > 0 && <circle className="kit-head__ring" cx={x} cy={y} r={4 + 6 * ring} opacity={ring} />}
            <circle className={`kit-head__dot kit-head__dot--${d.tone ?? 'accent'}`} cx={x} cy={y} r={r} />
          </g>
        )
      })}
    </svg>
  )
}
