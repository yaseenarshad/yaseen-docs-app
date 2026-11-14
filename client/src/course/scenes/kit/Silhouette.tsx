/**
 * A PERSON, AND WHAT THEY KNOW (YAZ-5121, chapter 5 on): the outline of a person (head and shoulders, one line, drawn
 * in as `draw` goes 0 → 1) and lights inside it. The main light travels from `from` (a point of the 300 × 340 view)
 * to its place in the head as `arrive` goes 0 → 1, then stays as a small steady light; `warm` lets its glow fill the
 * outline ("part of who you are"); `others` lights a few more small, faint lights (the other things you know).
 *
 * A drawing, clearly a drawing. The light breathes with the clip's time while it plays (it stops on pause; with
 * reduced motion it is still, and it does not travel: it fades in at its place).
 */
import { clamp, ease, lerp, type Beat } from './beat'
import './screens.css'

/** The outline: the shoulders, then the head. */
const SHOULDERS = 'M34 336 C36 262 88 226 150 226 C212 226 264 262 266 336'
const HEAD = 'M150 54 C184 54 206 80 206 114 C206 150 182 178 150 178 C118 178 94 150 94 114 C94 80 116 54 150 54 Z'

/** Where the main light settles, and the small lights of `others`. */
export const SILHOUETTE_LIGHT: readonly [number, number] = [150, 112]
const OTHERS: readonly [number, number, number][] = [
  [124, 94, 0.0],
  [178, 100, 0.15],
  [132, 140, 0.3],
  [170, 136, 0.42],
  [150, 280, 0.55],
  [112, 290, 0.66],
  [190, 292, 0.78],
  [156, 80, 0.88],
]

export function Silhouette({ beat, draw, arrive, warm = 0, others = 0, from = [150, 400] }: { beat: Beat; draw: number; arrive: number; warm?: number; others?: number; from?: readonly [number, number] }) {
  const d = beat.reduced ? (draw > 0 ? 1 : 0) : ease.inOut(clamp(draw))
  const lineOpacity = beat.reduced ? clamp(draw * 1.5) : clamp(draw * 4)
  const a = clamp(arrive)
  const m = beat.reduced ? 1 : ease.inOut(a)
  const x = lerp(from[0], SILHOUETTE_LIGHT[0], m)
  const y = lerp(from[1], SILHOUETTE_LIGHT[1], m)
  const breathe = beat.reduced || !beat.playing ? 0 : Math.sin(beat.t * 2.1) * 0.06
  const w = clamp(warm)
  return (
    <svg className="kit-person" viewBox="0 0 300 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <radialGradient id="kit-person-light">
          <stop offset="0" style={{ stopColor: 'var(--kit-gold)', stopOpacity: 0.95 }} />
          <stop offset="0.35" style={{ stopColor: 'var(--kit-gold)', stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: 'var(--kit-gold)', stopOpacity: 0 }} />
        </radialGradient>
        <clipPath id="kit-person-clip">
          <path d={`${HEAD} ${SHOULDERS} L266 340 L34 340 Z`} />
        </clipPath>
      </defs>
      {/* The warmth: the light's glow, filling the outline. */}
      <g clipPath="url(#kit-person-clip)" opacity={w * 0.55}>
        <circle cx={SILHOUETTE_LIGHT[0]} cy={SILHOUETTE_LIGHT[1] + 40} r={lerp(40, 260, beat.reduced ? (w > 0 ? 1 : 0) : ease.out(w))} fill="url(#kit-person-light)" />
      </g>
      <path className="kit-person__line" d={SHOULDERS} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - d} opacity={lineOpacity} />
      <path className="kit-person__line" d={HEAD} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - clamp(d * 1.2 - 0.1)} opacity={lineOpacity} />
      {OTHERS.map(([ox, oy, at], i) => {
        const p = clamp((clamp(others) - at) * 4)
        return p > 0 ? <circle key={i} className="kit-person__other" cx={ox} cy={oy} r={2.6} opacity={p * 0.55} /> : null
      })}
      {a > 0 && (
        <g opacity={beat.reduced ? a : clamp(a * 3)}>
          <circle cx={x} cy={y} r={lerp(26, 34, w) * (1 + breathe)} fill="url(#kit-person-light)" />
          <circle className="kit-person__light" cx={x} cy={y} r={lerp(7, 5.5, m) * (1 + breathe * 0.5)} />
        </g>
      )}
    </svg>
  )
}
