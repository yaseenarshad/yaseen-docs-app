/**
 * "Added card to reviews · Undo" (YAZ-5679, as Mochi: YAZ-5671 findings 11 and 20): a small note at the bottom right
 * when a Remembered learns a new card (`session.learned`), for about 3 s. Undo takes that answer back (`review.undo`:
 * the answer is still the last thing done, or the note is gone). ONE piece for the Mac's Inbox and the phone's Review.
 */
import { useEffect, useState } from 'react'
import './sessionCount.css'

/** How long the note stays (Mochi: about 3 s). */
export const LEARNED_NOTE_MS = 3000

export function LearnedNote({ learned, onUndo }: { learned: string | null; onUndo: () => void }) {
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    setShown(learned)
    if (learned === null) return
    const timer = setTimeout(() => setShown(null), LEARNED_NOTE_MS)
    return () => clearTimeout(timer)
  }, [learned])
  if (shown === null || shown !== learned) return null
  return (
    <div className="learned-note" role="status">
      <span>Added card to reviews</span>
      <span className="learned-note__sep" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        className="learned-note__undo"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setShown(null)
          onUndo()
        }}
      >
        Undo
      </button>
    </div>
  )
}
