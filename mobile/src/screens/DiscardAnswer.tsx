import { useState } from 'react'
import { Confirm } from './Confirm'
import './discardAnswer.css'

/**
 * Discard of a lost answer (round 12 item 9), in ONE place for the dot's sheet (4D) and the Review screen's amber
 * line (4B). It asks first (YAZ-5215): the answer cannot come back. The ask says which answer goes; Cancel is the
 * default (4A's `Confirm`: it has the focus, so a stray tap does nothing).
 */
export function DiscardAnswer({ title, answer, label, onDiscard }: { title: string; answer: string; label: string; onDiscard: () => Promise<unknown> | void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!asking)
    return (
      <button type="button" className="btn discard-answer" aria-label={label} onClick={() => setAsking(true)}>
        Discard
      </button>
    )
  return (
    <div className="discard-answer__ask">
      <Confirm
        question={discardQuestion(title, answer)}
        yes="Discard answer"
        busy={busy}
        onNo={() => setAsking(false)}
        onYes={() => {
          setBusy(true)
          void Promise.resolve(onDiscard()).finally(() => setBusy(false))
        }}
      />
    </div>
  )
}

/** The plain words of the ask: the action, the card, and that it cannot come back. */
export const discardQuestion = (title: string, answer: string): string => `Discard your answer "${answer}" to "${title}"${/[?!.]$/.test(title) ? '' : '?'} It cannot be taken back.`
