/**
 * BELIEF AGAINST FACT (YAZ-5121, chapter 9): two drawings for "your gut is a poor judge of your own memory".
 *
 * - `Crowd`: a row of people (Kornell 2009: for nine of ten, spacing won; seven of ten were sure it had lost). `won`
 *   of them light up over `wonP`; then `doubt` of them raise a sign over `doubtP`, under one bracket with `doubtText`.
 * - `GuessBars`: what people guessed against what they kept (Karpicke & Roediger 2008): bars that rise on their words,
 *   and a dashed line at the guess; `missP` marks the gap between the guess and each bar.
 */
import { clamp, ease, lerp, type Beat } from './beat'
import './kit.css'

const STEP = 46

export function Crowd({ beat, count = 10, appear, won = 0, wonP = 0, doubt = 0, doubtP = 0, doubtText, wonText, wonTextP = 0 }: { beat: Beat; count?: number; appear: number; won?: number; wonP?: number; doubt?: number; doubtP?: number; doubtText?: string; wonText?: string; wonTextP?: number }) {
  const w = count * STEP
  const top = 96
  return (
    <svg className="kit-crowd" viewBox={`-10 0 ${w + 20} 214`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const p = beat.reduced ? (appear > 0 ? 1 : 0) : clamp(appear * (count + 3) - i)
        const lit = i < won ? (beat.reduced ? (wonP > 0 ? 1 : 0) : clamp(wonP * (won + 2) - i)) : 0
        const sign = i < doubt ? (beat.reduced ? (doubtP > 0 ? 1 : 0) : clamp(doubtP * (doubt + 2) - i)) : 0
        const x = i * STEP + STEP / 2
        const lift = beat.reduced ? 1 : ease.back(sign)
        return (
          <g key={i} className="kit-crowd__person" data-lit={lit > 0.5 ? 'true' : undefined} opacity={clamp(p * 2)} transform={`translate(${x} ${top + (beat.reduced ? 0 : (1 - ease.out(p)) * 10)})`}>
            <circle className="kit-crowd__head" cy={18} r={9} style={{ fillOpacity: lerp(0.25, 1, lit) }} />
            <path className="kit-crowd__body" d="M-15 72 Q-15 34 0 34 Q15 34 15 72 Z" style={{ fillOpacity: lerp(0.25, 1, lit) }} />
            {sign > 0 && (
              <g opacity={clamp(sign * 2)} transform={`translate(0 ${(lerp(14, 0, lift)).toFixed(2)})`}>
                <line className="kit-crowd__stick" x1={12} y1={44} x2={12} y2={-8} />
                <rect className="kit-crowd__sign" x={0} y={-26} width={24} height={18} rx={3} />
                <path className="kit-crowd__sign-x" d="M8 -21 16 -13M16 -21 8 -13" />
              </g>
            )}
          </g>
        )
      })}
      {doubt > 0 && doubtText !== undefined && (
        <g opacity={clamp((doubtP - 0.4) * 3)}>
          <path className="kit-crowd__bracket" d={`M${STEP * 0.2} 50 V40 H${doubt * STEP - STEP * 0.2} V50`} />
          <text className="kit-svg-label kit-crowd__doubt" x={(doubt * STEP) / 2} y={30} textAnchor="middle">
            {doubtText}
          </text>
        </g>
      )}
      {won > 0 && wonText !== undefined && (
        <g opacity={clamp(wonTextP * 2)}>
          <path className="kit-crowd__bracket kit-crowd__bracket--won" d={`M${STEP * 0.2} 176 V184 H${won * STEP - STEP * 0.2} V176`} />
          <text className="kit-svg-label kit-svg-label--accent" x={(won * STEP) / 2} y={206} textAnchor="middle">
            {wonText}
          </text>
        </g>
      )}
    </svg>
  )
}

/** Guess against fact: bars (0..100) that rise over `bars[i].p`; the guess's dashed line over `guessP`. */
export function GuessBars({ beat, guess, guessLabel, guessP, bars, missP = 0 }: { beat: Beat; guess: number; guessLabel: string; guessP: number; bars: readonly { label: string; value: number; text: string; p: number }[]; missP?: number }) {
  const base = 230
  const top = 30
  const yOf = (v: number): number => lerp(base, top, v / 100)
  const gy = yOf(guess)
  const gd = beat.reduced ? (guessP > 0 ? 1 : 0) : ease.inOut(clamp(guessP))
  const m = clamp(missP)
  return (
    <svg className="kit-guess" viewBox="0 0 460 270" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${guessLabel}. ${bars.map((b) => `${b.label}: ${b.text}`).join('. ')}`}>
      <line className="kit-ax" x1={40} y1={base} x2={420} y2={base} />
      {bars.map((bar, i) => {
        const x = 130 + i * 170
        const h = beat.reduced ? (bar.p > 0 ? 1 : 0) : ease.out(clamp(bar.p))
        const y = lerp(base, yOf(bar.value), h)
        return (
          <g key={bar.label} opacity={clamp(bar.p * 3)}>
            <rect className={`kit-guess__bar${i === 0 ? '' : ' kit-guess__bar--b'}`} x={x - 34} y={y} width={68} height={base - y} rx={6} />
            <text className="kit-guess__value" x={x} y={y - 10} textAnchor="middle">
              {bar.text}
            </text>
            <text className="kit-svg-page" x={x} y={base + 22} textAnchor="middle">
              {bar.label}
            </text>
            {m > 0 && (
              <g opacity={m}>
                <line className="kit-guess__miss" x1={x + 48} y1={gy} x2={x + 48} y2={yOf(bar.value)} />
                <path className="kit-guess__miss" d={`M${x + 43} ${yOf(bar.value) + (bar.value > guess ? 7 : -7)} L${x + 48} ${yOf(bar.value)} L${x + 53} ${yOf(bar.value) + (bar.value > guess ? 7 : -7)}`} />
              </g>
            )}
          </g>
        )
      })}
      <g opacity={clamp(guessP * 3)}>
        <line className="kit-guess__line" x1={40} y1={gy} x2={lerp(40, 420, gd)} y2={gy} />
        <text className="kit-guess__label" x={420} y={gy - 8} textAnchor="end">
          {guessLabel}
        </text>
      </g>
    </svg>
  )
}
