/**
 * THE REPORT CARD (YAZ-5121, chapter 7): a research review that GRADES things, drawn as a school report card. Each row
 * is one thing graded, with its grade as a stamp. Rows come in on their own progress; a stamp lands on its own; `lit`
 * lifts a row (look here), `dim` steps it back. The grades are the review's words, set as text.
 *
 * Reduced motion: rows and stamps cross-fade in place; a stamp does not turn or drop.
 */
import type { ReactNode } from 'react'
import { clamp, ease, lerp, type Beat } from './beat'
import './kit68.css'

export type Grade = 'High' | 'Moderate' | 'Low'

interface ReportRow {
  label: string
  grade: Grade
  /** 0..1: the row comes in. */
  p: number
  /** 0..1: its grade stamp lands. */
  stamp: number
  lit?: number
  dim?: number
}

const TONE: Record<Grade, string> = { High: 'ok', Moderate: 'muted', Low: 'danger' }

export function ReportCard({ beat, title, sub, rows, p = 1, children }: { beat: Beat; title: string; sub?: string; rows: readonly ReportRow[]; p?: number; children?: ReactNode }) {
  const q = clamp(p)
  return (
    <div className="kit-report" style={{ opacity: clamp(q * 2), transform: beat.reduced ? undefined : `translateY(${((1 - ease.out(q)) * 14).toFixed(2)}px)` }} role="table" aria-label={`${title}: ${rows.map((r) => `${r.label}, ${r.grade}`).join('; ')}`}>
      <div className="kit-report__head">
        <span className="kit-report__title">{title}</span>
        {sub !== undefined && <span className="kit-report__sub">{sub}</span>}
      </div>
      <div className="kit-report__rows">
        {rows.map((row) => {
          const r = clamp(row.p)
          const s = clamp(row.stamp)
          const lit = clamp(row.lit ?? 0)
          const dim = clamp(row.dim ?? 0)
          const drop = beat.reduced ? 1 : ease.back(s)
          return (
            <div
              key={row.label}
              className="kit-report__row"
              role="row"
              data-lit={lit > 0.5 ? 'true' : undefined}
              style={{
                opacity: r * lerp(1, 0.35, dim),
                transform: beat.reduced || lit === 0 ? undefined : `scale(${lerp(1, 1.04, ease.out(lit)).toFixed(4)})`,
                backgroundColor: lit > 0 ? `color-mix(in srgb, var(--accent-soft) ${(lit * 100).toFixed(0)}%, transparent)` : undefined,
              }}
            >
              <span className="kit-report__label" role="cell">
                {row.label}
              </span>
              <span
                className={`kit-report__stamp kit-tone--${TONE[row.grade]}`}
                role="cell"
                style={{ opacity: clamp(s * 2), transform: beat.reduced ? 'rotate(-6deg)' : `rotate(${lerp(-24, -6, drop).toFixed(2)}deg) scale(${lerp(1.8, 1, drop).toFixed(3)})` }}
              >
                {row.grade}
              </span>
            </div>
          )
        })}
      </div>
      {children}
    </div>
  )
}
