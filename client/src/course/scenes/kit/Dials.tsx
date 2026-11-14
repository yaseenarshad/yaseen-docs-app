/**
 * DIALS (YAZ-5121, chapter 9): `Gauge` (a meter whose needle swings: what you kept, against how sure you felt) and
 * `ClockArc` (a clock face with arcs on it: "fifteen to twenty minutes a day"). Drawings, pure functions of the beat.
 */
import { clamp, ease, lerp, type Beat } from './beat'
import './kit.css'

const rad = (deg: number): number => (deg * Math.PI) / 180

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(rad(a0))
  const y0 = cy + r * Math.sin(rad(a0))
  const x1 = cx + r * Math.cos(rad(a1))
  const y1 = cy + r * Math.sin(rad(a1))
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** A half-round meter: `value` 0..1 (left to right); the needle swings to it from `from` over `swing`. */
export function Gauge({ beat, p, value, from = 0.5, swing, label, low = 'Low', high = 'High' }: { beat: Beat; p: number; value: number; from?: number; swing: number; label: string; low?: string; high?: string }) {
  const s = beat.reduced ? (swing > 0 ? 1 : 0) : ease.back(clamp(swing))
  const v = lerp(from, value, s)
  const a = 180 + 180 * clamp(v, -0.05, 1.05)
  return (
    <svg className="kit-gauge" viewBox="0 0 240 160" aria-hidden="true" style={{ opacity: clamp(p * 2) }}>
      <path className="kit-gauge__track" d={arcPath(120, 120, 90, 180, 360)} />
      <path className="kit-gauge__low" d={arcPath(120, 120, 90, 180, 240)} />
      <line className="kit-gauge__needle" x1={120} y1={120} x2={120 + 78 * Math.cos(rad(a))} y2={120 + 78 * Math.sin(rad(a))} />
      <circle className="kit-gauge__pin" cx={120} cy={120} r={7} />
      <text className="kit-svg-page" x={30} y={146} textAnchor="middle">
        {low}
      </text>
      <text className="kit-svg-page" x={210} y={146} textAnchor="middle">
        {high}
      </text>
      <text className="kit-svg-label" x={120} y={156} textAnchor="middle">
        {label}
      </text>
    </svg>
  )
}

/** A clock face (one hour round); each arc from `from` to `to` minutes is drawn over its `p`. */
export function ClockArc({ beat, p, arcs, label, labelP = 0 }: { beat: Beat; p: number; arcs: readonly { from: number; to: number; p: number; tone?: 'accent' | 'soft' }[]; label?: string; labelP?: number }) {
  return (
    <svg className="kit-clock" viewBox="0 0 240 240" aria-hidden="true" style={{ opacity: clamp(p * 2) }}>
      <circle className="kit-clock__face" cx={120} cy={120} r={100} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = rad(-90 + i * 30)
        return <line key={i} className="kit-clock__tick" x1={120 + 88 * Math.cos(a)} y1={120 + 88 * Math.sin(a)} x2={120 + 96 * Math.cos(a)} y2={120 + 96 * Math.sin(a)} />
      })}
      {arcs.map((arc, i) => {
        const q = beat.reduced ? (arc.p > 0 ? 1 : 0) : ease.inOut(clamp(arc.p))
        if (q <= 0) return null
        const a0 = -90 + arc.from * 6
        const a1 = lerp(a0, -90 + arc.to * 6, q)
        if (a1 - a0 < 0.5) return null
        return <path key={i} className={`kit-clock__arc kit-clock__arc--${arc.tone ?? 'accent'}`} d={arcPath(120, 120, 74, a0, a1)} />
      })}
      {label !== undefined && (
        <text className="kit-clock__label" x={120} y={130} textAnchor="middle" opacity={clamp(labelP * 2)}>
          {label}
        </text>
      )}
    </svg>
  )
}
