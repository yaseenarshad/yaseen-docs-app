/**
 * A SHORT TALK WITH YOUR AGENT (YAZ-5121, chapter 4 on): any coding agent's chat, drawn plainly (no product's look,
 * no logo): what you type, then the agent's reply and the steps it shows. For "Or just tell your agent: …".
 *
 * `messages`: in order; each has its own progress `p` (0 hidden, 1 shown). A message `from: 'you'` types itself in
 * while `p` goes from 0 to 1 (reduced motion: it shows whole); the agent's lines fade in.
 */
import { clamp, ease, lerp, type Beat } from './beat'
import { Caret } from './AppFrame'
import './screens.css'

export interface ChatMessage {
  from: 'you' | 'agent'
  text: string
  p: number
  /** A quiet step line under an agent message ("Edited Food basics.md"). */
  step?: string
}

export function ChatPreview({ beat, messages, title = 'Your agent' }: { beat: Beat; messages: readonly ChatMessage[]; title?: string }) {
  return (
    <div className="kit-chat" role="img" aria-label={`A chat with your agent: ${messages.map((m) => m.text).join(' ')}`}>
      <p className="kit-chat__title">{title}</p>
      <div className="kit-chat__list">
        {messages.map((m, i) => {
          const p = clamp(m.p)
          if (p <= 0) return null
          const typing = m.from === 'you' && !beat.reduced && p < 1
          const shown = typing ? m.text.slice(0, Math.round(m.text.length * clamp(p * 1.15))) : m.text
          return (
            <div
              key={i}
              className={`kit-chat__msg kit-chat__msg--${m.from}`}
              style={{
                opacity: m.from === 'you' ? clamp(p * 4) : p,
                transform: beat.reduced || m.from === 'you' ? undefined : `translateY(${lerp(6, 0, ease.out(p)).toFixed(2)}px)`,
              }}
            >
              <span className="kit-chat__bubble">
                {shown}
                {typing && <Caret />}
              </span>
              {m.step !== undefined && <span className="kit-chat__step">{m.step}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
