/**
 * FORGOT AND REMEMBERED (YAZ-5121): the Inbox's two answer buttons, with the app's own classes and glyphs
 * (`CardInbox.tsx`: `.card-inbox__answers`, `.card-inbox__answer`, `ForgotIcon`, `RememberedIcon`, the 1 and 2 keys).
 * As a picture (`onAnswer` absent) they are disabled; with `onAnswer` they are the real step of chapter 2.
 */
import type { ReactElement } from 'react'
import { ForgotIcon, RememberedIcon } from '../../../review/cardInboxIcons'
import { pop, type Beat } from './beat'

export type Answer = 'forgot' | 'remembered'

export function Answers({ beat, forgot, remembered, chosen, onAnswer }: { beat: Beat; forgot: number; remembered: number; chosen?: Answer | null; onAnswer?: (answer: Answer) => void }) {
  const live = onAnswer !== undefined && (chosen ?? null) === null
  const row: [Answer, string, number, () => ReactElement, string][] = [
    ['forgot', 'Forgot', forgot, ForgotIcon, 'again'],
    ['remembered', 'Remembered', remembered, RememberedIcon, 'good'],
  ]
  return (
    <div className="card-inbox__answers kit-answers">
      {row.map(([answer, label, p, Icon, rating], i) => (
        <button
          key={answer}
          type="button"
          className="explore__button card-inbox__answer"
          data-rating={rating}
          data-chosen={chosen === answer ? 'true' : undefined}
          disabled={!live}
          style={pop(beat, p, 0.85)}
          onClick={live ? () => onAnswer(answer) : undefined}
        >
          <Icon />
          <span className="card-inbox__answer-label">{label}</span>
          <kbd>{i + 1}</kbd>
        </button>
      ))}
    </div>
  )
}
