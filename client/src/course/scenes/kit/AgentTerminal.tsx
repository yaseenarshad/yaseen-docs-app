/**
 * THE AGENT'S WINDOW (YAZ-5121, chapters 7 and 8): a terminal with the person's own AI agent in it, as a drawing. The
 * app runs no agent; this is only a picture of the one the person uses, so it names no product. Each line types in
 * from its own progress `p`, so the window is a pure function of its beat (pause stops the typing, a seek redraws it).
 *
 * - `kind`: `in` (what the person types, after "›"), `out` (the agent's words), `file` (a file it reads or writes),
 *   `ok` (done), `dim`.
 * - Reduced motion: a line shows whole once it starts.
 * - Dark in both themes, as a terminal is; its colours are its own.
 */
import type { CSSProperties } from 'react'
import { clamp, type Beat } from './beat'
import './kit68.css'

export interface TermLine {
  text: string
  /** 0..1: how much of the line is typed. */
  p: number
  kind?: 'in' | 'out' | 'file' | 'ok' | 'dim' | 'warn'
}

export function AgentTerminal({ beat, lines, title = 'your agent', caret = true, style, className }: { beat: Beat; lines: readonly TermLine[]; title?: string; caret?: boolean; style?: CSSProperties; className?: string }) {
  const started = lines.filter((l) => l.p > 0)
  const last = started[started.length - 1]
  return (
    <div className={`kit-term${className === undefined ? '' : ` ${className}`}`} style={style} role="img" aria-label={`A terminal window: ${title}`}>
      <div className="kit-term__bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      <div className="kit-term__body" aria-hidden="true">
        {started.map((line, i) => {
          const text = beat.reduced ? line.text : line.text.slice(0, Math.round(line.text.length * clamp(line.p)))
          return (
            <p key={i} className={`kit-term__line kit-term__line--${line.kind ?? 'out'}`}>
              {line.kind === 'in' && <b>› </b>}
              {line.kind === 'file' && <b>⎘ </b>}
              {line.kind === 'ok' && <b>✓ </b>}
              {text}
              {caret && line === last && <span className="kit-term__caret" />}
            </p>
          )
        })}
        {started.length === 0 && caret && (
          <p className="kit-term__line kit-term__line--in">
            <b>› </b>
            <span className="kit-term__caret" />
          </p>
        )}
      </div>
    </div>
  )
}
