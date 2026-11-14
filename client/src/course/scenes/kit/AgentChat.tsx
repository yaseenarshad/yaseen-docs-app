/**
 * THE AGENT'S CHAT (YAZ-5121, chapters 9 to 11): the person's own AI agent, in its own window (not the app: the app
 * has no AI inside). The person's lines and the agent's come in as they are typed. A PROPOSAL is the handmade part:
 * the agent shows one change with its reason, a highlighter sweeps it as the person reads, and the person says Yes or
 * Skip. Nothing changes until then. Made-up words only; no product's name or look.
 *
 * - `lines[i].p`: 0..1, how much of it is typed (an agent line fades in instead: it arrives whole).
 * - `ask`: a proposal under the line: `title`, `reason`, `read` (the sweep), `answer` ('yes' | 'skip') and `answerP`.
 */
import type { CSSProperties } from 'react'
import { clamp, ease, rise, type Beat } from './beat'
import './kitMore.css'

export interface ChatAsk {
  title: string
  reason?: string
  read?: number
  answer?: 'yes' | 'skip'
  answerP?: number
  /** The labels of the two buttons. */
  yes?: string
  skip?: string
}

export interface ChatLine {
  who: 'you' | 'agent'
  text: string
  p: number
  ask?: ChatAsk
}

/** Part of a text, typed so far (with reduced motion: all of it once it starts). */
export const typedText = (b: Beat, text: string, p: number): string => (b.reduced ? (p > 0 ? text : '') : text.slice(0, Math.round(text.length * clamp(p))))

export function AgentChat({ beat, lines, title = 'Your agent', when, style }: { beat: Beat; lines: readonly ChatLine[]; title?: string; when?: string; style?: CSSProperties }) {
  return (
    <div className="kit-chat" style={style} role="img" aria-label={`${title}: ${lines.filter((l) => l.p > 0).map((l) => l.text).join(' ')}`}>
      <div className="kit-chat__bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span className="kit-chat__title">{title}</span>
        {when !== undefined && <span className="kit-chat__when">{when}</span>}
      </div>
      <div className="kit-chat__body">
        {lines.map((line, i) => {
          if (line.p <= 0) return null
          const typing = line.who === 'you' && line.p < 1 && !beat.reduced
          return (
            <div key={i} className={`kit-chat__line kit-chat__line--${line.who}`} style={line.who === 'agent' ? rise(beat, line.p * 1.5, 6) : undefined}>
              {line.who === 'you' && <span className="kit-chat__prompt">›</span>}
              <span className="kit-chat__text">
                {line.who === 'you' ? typedText(beat, line.text, line.p) : line.text}
                {typing && <span className="kit-caret" />}
              </span>
              {line.ask !== undefined && <Proposal beat={beat} ask={line.ask} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Proposal({ beat, ask }: { beat: Beat; ask: ChatAsk }) {
  const read = beat.reduced ? (clamp(ask.read ?? 0) > 0 ? 1 : 0) : ease.inOut(clamp(ask.read ?? 0))
  const a = clamp(ask.answerP ?? 0)
  const chosen = a > 0.3 ? ask.answer : undefined
  return (
    <div className="kit-chat__ask" data-answer={chosen}>
      <span className="kit-chat__ask-title">
        <mark style={{ backgroundSize: `${(read * 100).toFixed(1)}% 100%` }}>{ask.title}</mark>
      </span>
      {ask.reason !== undefined && <span className="kit-chat__reason">{ask.reason}</span>}
      <span className="kit-chat__buttons">
        <span className="kit-chat__btn kit-chat__btn--yes" data-on={chosen === 'yes' ? 'true' : undefined}>
          {chosen === 'yes' ? '✓ ' : ''}
          {ask.yes ?? 'Yes'}
        </span>
        <span className="kit-chat__btn" data-on={chosen === 'skip' ? 'true' : undefined}>
          {ask.skip ?? 'Skip'}
        </span>
      </span>
    </div>
  )
}
