/**
 * SMALL DRAWINGS (YAZ-5121): the paper index card, a small card silhouette (many cards at once), turning gears (the
 * work behind the scenes), a medal (a prize: a plain disc with words, never a real medal's design or a logo), and the
 * memory orb (fragile, then stable). Each is a pure function of its beat and its progress values.
 */
import type { CSSProperties } from 'react'
import { clamp, ease, lerp, type Beat } from './beat'

/** The paper index card most people picture: ruled lines, a line or two by hand. */
export function IndexCard({ lines = [], style }: { lines?: readonly string[]; style?: CSSProperties }) {
  return (
    <div className="kit-index-card" style={style} aria-label={lines.length === 0 ? 'A paper index card' : `A paper index card: ${lines.join(' ')}`} role="img">
      {lines.map((line) => (
        <p key={line} className="kit-index-card__hand">
          {line}
        </p>
      ))}
    </div>
  )
}

/** A small card, in the app's colours: a title and a line with one blank. For a wall of many cards. */
export function MiniCard({ title, style }: { title: string; style?: CSSProperties }) {
  return (
    <span className="kit-mini" style={style}>
      <span className="kit-mini__title">{title}</span>
      <span className="kit-mini__line">
        <i style={{ width: '42%' }} />
        <b />
        <i style={{ width: '22%' }} />
      </span>
      <span className="kit-mini__line">
        <i style={{ width: '64%' }} />
      </span>
    </span>
  )
}

function gearPath(r: number, teeth: number): string {
  const pts: string[] = []
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (Math.PI * i) / teeth
    const a1 = (Math.PI * (i + 1)) / teeth
    const rr = i % 2 === 0 ? r : r * 0.82
    pts.push(`${(Math.cos(a0) * rr).toFixed(2)},${(Math.sin(a0) * rr).toFixed(2)}`, `${(Math.cos(a1) * rr).toFixed(2)},${(Math.sin(a1) * rr).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}
const BIG = gearPath(60, 12)
const SMALL = gearPath(38, 8)

/** Two gears that turn with the clip's time (they stop on pause; with reduced motion they stand still). */
export function Gears({ beat, p }: { beat: Beat; p: number }) {
  const turn = beat.reduced ? 0 : beat.t * 40
  return (
    <svg className="kit-gears" viewBox="-80 -80 220 160" aria-hidden="true" style={{ opacity: clamp(p) }}>
      <g transform={`rotate(${turn.toFixed(2)})`}>
        <path className="kit-gear" d={BIG} />
        <circle className="kit-gear__hole" r={14} />
      </g>
      <g transform={`translate(92 22) rotate(${(-turn * 1.5 + 11).toFixed(2)})`}>
        <path className="kit-gear kit-gear--small" d={SMALL} />
        <circle className="kit-gear__hole" r={9} />
      </g>
    </svg>
  )
}

/** A prize medal, drawn simply: a gold disc on a ribbon, the year on it. `p` drops it in; `shine` sweeps a light. */
export function Medal({ beat, p, shine = 0, year }: { beat: Beat; p: number; shine?: number; year: string }) {
  const q = clamp(p)
  const s = clamp(shine)
  return (
    <svg
      className="kit-medal"
      viewBox="-70 -120 140 200"
      aria-hidden="true"
      style={{ opacity: clamp(q * 2), transform: beat.reduced ? undefined : `translateY(${lerp(-30, 0, ease.out(q)).toFixed(2)}%) scale(${lerp(0.7, 1, ease.back(q)).toFixed(4)})` }}
    >
      <path className="kit-medal__ribbon" d="M-34 -120 H-10 L8 -40 H-10 Z" />
      <path className="kit-medal__ribbon kit-medal__ribbon--b" d="M34 -120 H10 L-8 -40 H10 Z" />
      <circle className="kit-medal__disc" cx={0} cy={10} r={52} />
      <circle className="kit-medal__rim" cx={0} cy={10} r={44} />
      <text className="kit-medal__year" x={0} y={20} textAnchor="middle">
        {year}
      </text>
      <clipPath id="kit-medal-clip">
        <circle cx={0} cy={10} r={52} />
      </clipPath>
      {s > 0 && s < 1 && !beat.reduced && <rect className="kit-medal__shine" x={lerp(-110, 70, ease.inOut(s))} y={-50} width={26} height={130} transform="rotate(20)" clipPath="url(#kit-medal-clip)" />}
    </svg>
  )
}

/**
 * The memory orb: a small light that starts faint and shaky (`stable` 0) and grows solid (`stable` 1). Its wobble
 * comes from the clip's time, so it stops on pause; with reduced motion it does not wobble.
 */
export function Orb({ beat, stable, glow = 0, size = 1 }: { beat: Beat; stable: number; glow?: number; size?: number }) {
  const s = clamp(stable)
  const wobble = beat.reduced ? 0 : (1 - s) * Math.sin(beat.t * 7.3) * 0.12
  const r = lerp(16, 30, s) * size
  return (
    <svg className="kit-orb" viewBox="-60 -60 120 120" aria-hidden="true">
      <circle className="kit-orb__halo" r={r * (1.9 + clamp(glow) * 0.6)} opacity={lerp(0.08, 0.22, s) + 0.15 * clamp(glow)} />
      <circle className="kit-orb__core" r={r * (1 + wobble)} opacity={lerp(0.35, 1, s)} />
      <circle className="kit-orb__ring" r={r + 6} strokeDasharray={s >= 1 ? undefined : `${lerp(3, 14, s).toFixed(1)} ${lerp(6, 0.01, s).toFixed(2)}`} opacity={lerp(0.5, 0.9, s)} />
    </svg>
  )
}
