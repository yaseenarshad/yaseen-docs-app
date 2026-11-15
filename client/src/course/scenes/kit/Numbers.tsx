/**
 * NUMBERS (YAZ-5121): `Counter` (a number that counts to its value), `Bars` (bars that rise on their words: "80
 * percent … 36 percent"), `Tally` (a wall of small tiles or people that fill in: "317 experiments", "nine of ten").
 * Each is a pure function of its beat and the progress it is given.
 */
import { clamp, ease, lerp, moved, since, type Beat } from './beat'

/** A number that counts from `from` to `to` over `p` (reduced motion: the value at once). */
export function Counter({ beat, p, to, from = 0, decimals = 0, suffix = '', prefix = '' }: { beat: Beat; p: number; to: number; from?: number; decimals?: number; suffix?: string; prefix?: string }) {
  const q = beat.reduced ? (p > 0 ? 1 : 0) : ease.out(clamp(p))
  const v = lerp(from, to, q)
  return (
    <span className="kit-counter">
      {prefix}
      {v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  )
}

export interface Bar {
  label: string
  /** 0 to 100. */
  value: number
  tone?: 'accent' | 'muted' | 'ok' | 'danger'
  /** The page under the bar's label. */
  page?: string
}

/**
 * Bars that rise one by one. `at`: the fraction of the clip where each bar starts (default: the clip's marks, in
 * order); each rises over `seconds`. The value counts up with it.
 */
export function Bars({ beat, bars, at, seconds = 1.1, unit = '%' }: { beat: Beat; bars: readonly Bar[]; at?: readonly number[]; seconds?: number; unit?: string }) {
  return (
    <div className="kit-bars" role="img" aria-label={bars.map((b) => `${b.label}: ${b.value}${unit}`).join('. ')}>
      {bars.map((bar, i) => {
        const p = since(beat, at?.[i] ?? beat.marks[i] ?? i / bars.length, seconds)
        const h = moved(beat, p, ease.out)
        return (
          <div key={bar.label} className={`kit-bar kit-tone--${bar.tone ?? 'accent'}`} style={{ opacity: clamp(0.25 + p * 3) }}>
            <span className="kit-bar__value">
              <Counter beat={beat} p={p} to={bar.value} suffix={unit} />
            </span>
            <span className="kit-bar__track">
              <span className="kit-bar__fill" style={{ height: `${(bar.value * h).toFixed(2)}%` }} />
            </span>
            <span className="kit-bar__label">{bar.label}</span>
            {bar.page !== undefined && <span className="kit-bar__note">{bar.page}</span>}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A wall of `count` tiles that fill in over `fill` (0..1), in reading order; from `win` (0..1) they take the accent,
 * from the first tile on. `shape="person"` draws small people, for "nine of ten"; `lit` of them are lit.
 */
export function Tally({ beat, count, fill, win = 0, columns, shape = 'tile', lit }: { beat: Beat; count: number; fill: number; win?: number; columns?: number; shape?: 'tile' | 'person'; lit?: number }) {
  const cols = columns ?? (shape === 'person' ? Math.min(count, 10) : Math.ceil(Math.sqrt(count * 1.9)))
  const rows = Math.ceil(count / cols)
  const cell = shape === 'person' ? 28 : 10
  const gap = shape === 'person' ? 8 : 3
  const w = cols * cell + (cols - 1) * gap
  const h = rows * (shape === 'person' ? cell * 1.5 : cell) + (rows - 1) * gap
  const shown = beat.reduced ? (fill > 0 ? count : 0) : Math.round(count * clamp(fill))
  const fade = beat.reduced ? clamp(fill * 2) : 1
  const won = beat.reduced ? (win > 0 ? count : 0) : Math.round(count * ease.inOut(clamp(win)))
  const tiles = []
  for (let i = 0; i < count; i++) {
    const x = (i % cols) * (cell + gap)
    const y = Math.floor(i / cols) * ((shape === 'person' ? cell * 1.5 : cell) + gap)
    const on = i < shown
    const accent = lit !== undefined ? i < lit && on && win > 0 : i < won
    const cls = `kit-tally__${shape}${on ? ' is-on' : ''}${accent ? ' is-won' : ''}`
    tiles.push(
      shape === 'person' ? (
        <g key={i} className={cls} transform={`translate(${x} ${y})`}>
          <circle cx={cell / 2} cy={cell * 0.32} r={cell * 0.22} />
          <path d={`M${cell * 0.14} ${cell * 1.4} Q${cell * 0.14} ${cell * 0.66} ${cell / 2} ${cell * 0.66} Q${cell * 0.86} ${cell * 0.66} ${cell * 0.86} ${cell * 1.4} Z`} />
        </g>
      ) : (
        <rect key={i} className={cls} x={x} y={y} width={cell} height={cell} rx={2} />
      ),
    )
  }
  return (
    <svg className="kit-tally" viewBox={`-2 -2 ${w + 4} ${h + 4}`} style={{ opacity: fade }} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {tiles}
    </svg>
  )
}
