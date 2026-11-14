/**
 * TIME (YAZ-5121): `Timeline` (a card's next dates on one line: 2 days, 11 days, 6 weeks, 5 months) and `Calendar`
 * (a month of days; cards land on their own dates; today lights). Simple drawings, in the app's colours.
 */
import { clamp, ease, lerp, type Beat } from './beat'

export interface Stop {
  /** Days from today. */
  day: number
  label: string
}

/**
 * Today on the left; each stop lands on the line when its `land[i]` goes 0 → 1. Positions are on a log scale of
 * days, so 2 days and 5 months both fit. `draw` brings in the line.
 */
export function Timeline({ beat, stops, land, draw = 1, span }: { beat: Beat; stops: readonly Stop[]; land: readonly number[]; draw?: number; span?: number }) {
  const w = 600
  const y = 70
  const l = 40
  const r = 560
  const max = span ?? Math.max(...stops.map((s) => s.day), 1)
  const xOf = (day: number): number => lerp(l, r, Math.log1p(day) / Math.log1p(max))
  const d = beat.reduced ? (draw > 0 ? 1 : 0) : ease.inOut(clamp(draw))
  return (
    <svg className="kit-timeline" viewBox={`0 0 ${w} 120`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <line className="kit-ax" x1={l} y1={y} x2={lerp(l, r, d)} y2={y} opacity={clamp(draw * 2)} />
      <g opacity={clamp(draw * 2)}>
        <circle className="kit-dot" cx={l} cy={y} r={6} />
        <text className="kit-svg-label" x={l} y={y - 18} textAnchor="middle">
          Today
        </text>
      </g>
      {stops.map((s, i) => {
        const p = clamp(land[i] ?? 0)
        const x = xOf(s.day)
        const dy = beat.reduced ? 0 : -18 * (1 - ease.out(p))
        return (
          <g key={s.label} opacity={clamp(p * 2.5)}>
            <circle className="kit-dot" cx={x} cy={y + dy} r={5.5} />
            {!beat.reduced && p > 0.5 && p < 1 && <circle className="kit-ring" cx={x} cy={y} r={5 + 14 * (p - 0.5) * 2} opacity={0.6 * (1 - (p - 0.5) * 2)} />}
            <text className="kit-svg-label" x={x} y={y + 30} textAnchor="middle">
              {s.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export interface CalendarChip {
  /** The day of the month, 1 to 31. */
  day: number
  /** 0..1: the chip lands on its day. */
  p: number
  label?: string
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * A month (30 days, starting on a Monday) with `today` outlined. Each chip is a small card that lands on its day.
 * `glowToday` lights today's cell; `fade` dims the rest of the month.
 */
export function Calendar({ beat, today, chips, glowToday = 0, draw = 1, dim = 0, title = 'November' }: { beat: Beat; today: number; chips: readonly CalendarChip[]; glowToday?: number; draw?: number; dim?: number; title?: string }) {
  const cell = 52
  const gap = 6
  const cols = 7
  const top = 46
  const w = cols * cell + (cols - 1) * gap
  const h = top + 5 * (cell + gap)
  const pos = (day: number): [number, number] => [((day - 1) % cols) * (cell + gap), top + Math.floor((day - 1) / cols) * (cell + gap)]
  const g = clamp(glowToday)
  return (
    <svg className="kit-calendar" viewBox={`-4 -4 ${w + 8} ${h + 8}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{ opacity: clamp(draw * 2) }}>
      <text className="kit-svg-label" x={0} y={16}>
        {title}
      </text>
      {WEEKDAYS.map((d, i) => (
        <text key={i} className="kit-svg-page" x={i * (cell + gap) + cell / 2} y={38} textAnchor="middle">
          {d}
        </text>
      ))}
      {Array.from({ length: 30 }, (_, i) => {
        const [x, y] = pos(i + 1)
        const isToday = i + 1 === today
        return (
          <g key={i} opacity={isToday ? 1 : 1 - 0.6 * clamp(dim)}>
            <rect className={`kit-cal__day${isToday ? ' is-today' : ''}`} x={x} y={y} width={cell} height={cell} rx={8} style={isToday && g > 0 ? { fillOpacity: 0.15 + 0.6 * g } : undefined} />
            <text className="kit-svg-page" x={x + 8} y={y + 16}>
              {i + 1}
            </text>
          </g>
        )
      })}
      {chips.map((c, i) => {
        const p = clamp(c.p)
        const [x, y] = pos(c.day)
        const dy = beat.reduced ? 0 : -24 * (1 - ease.out(p))
        return (
          <g key={i} opacity={clamp(p * 2)} transform={`translate(${x + 10} ${y + 22 + dy})`}>
            <rect className="kit-cal__chip" width={cell - 20} height={22} rx={4} />
            <line className="kit-cal__chip-line" x1={6} y1={8} x2={cell - 28} y2={8} />
            <line className="kit-cal__chip-line" x1={6} y1={14} x2={(cell - 28) * 0.6} y2={14} />
          </g>
        )
      })}
    </svg>
  )
}
