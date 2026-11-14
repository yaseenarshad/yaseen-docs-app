import { useEffect, useRef } from 'react'

/**
 * An ask before a step that cannot be undone, in place under its button. The safe choice comes first and takes the
 * focus, so VoiceOver reads the question and a stray tap does nothing.
 */
export function Confirm({ question, yes, onYes, onNo, busy = false }: { question: string; yes: string; onYes: () => void; onNo: () => void; busy?: boolean }) {
  const cancel = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    cancel.current?.focus()
    // The yes button can sit under the tab bar: bring the whole ask into view.
    box.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  return (
    <div ref={box} className="problem" role="alertdialog" aria-label={yes} aria-describedby="confirm-question">
      <p id="confirm-question">{question}</p>
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
