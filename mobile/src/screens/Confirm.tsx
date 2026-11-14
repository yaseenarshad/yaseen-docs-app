import { useEffect, useRef, type ReactNode } from 'react'

/**
 * An ask before a step that cannot be undone, in place under its button. The safe choice comes first and takes the
 * focus, so VoiceOver reads the question and a stray tap does nothing. Escape is Cancel (YAZ-5344). A question can
 * be several short parts (one paragraph each). `extra` goes between the question and the buttons (a safer way).
 */
export function Confirm({
  question,
  yes,
  onYes,
  onNo,
  busy = false,
  extra,
}: {
  question: string | readonly string[]
  yes: string
  onYes: () => void
  onNo: () => void
  busy?: boolean
  extra?: ReactNode
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    cancel.current?.focus()
    // The yes button can sit under the tab bar: bring the whole ask into view.
    box.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onNo()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onNo, busy])
  const parts = typeof question === 'string' ? [question] : question
  return (
    <div ref={box} className="problem" role="alertdialog" aria-label={yes} aria-describedby="confirm-question">
      <div id="confirm-question">
        {parts.map((part, i) => (
          <p key={i}>{part}</p>
        ))}
      </div>
      {extra}
      <div className="stack">
        <button ref={cancel} type="button" className="btn btn--wide" onClick={onNo} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--wide btn--danger" onClick={onYes} disabled={busy} aria-busy={busy}>
          {busy ? 'Working…' : yes}
        </button>
      </div>
    </div>
  )
}
