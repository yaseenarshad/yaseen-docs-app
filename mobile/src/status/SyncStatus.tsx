import { useCallback, useRef, useState } from 'react'
import { useApp } from '../app/AppState'
import { tokenEndWarning } from '../auth/expiry'
import { answersPart, syncDot, type Dot } from './dot'
import { StatusSheet } from './StatusSheet'
import { useDotAnswers } from './useDotAnswers'
import { useOnline } from './useOnline'
import './status.css'

/**
 * The sync status in the top bar (decision 12; YAZ-5080): a dot and a few words, always shown, as in GitHub
 * AutoSync. One button: VoiceOver reads "Sync status: 3 answers waiting". A tap opens the sheet with the time of the
 * last sync, and what to do when there is something to do.
 */
export function SyncStatus() {
  const app = useApp()
  const online = useOnline()
  const answers = useDotAnswers(app.services.sync, app.vaultKey)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    button.current?.focus()
  }, [])
  const now = (app.services.now ?? Date.now)()
  const token = tokenEndWarning(app.vaultKey === null ? null : (app.accounts[app.vaultKey]?.expiresAt ?? null), now)
  const dot = syncDot({ sync: app.sync, answers: answersPart(answers.state, answers.waiting), online, token })
  return (
    <>
      <button ref={button} type="button" className="sync-status" aria-label={`Sync status: ${dot.words}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className={`sync-dot sync-dot--${dot.state}`} aria-hidden="true" />
        <DotWords dot={dot} />
      </button>
      {open && (
        <StatusSheet
          dot={dot}
          token={token}
          answers={answers}
          now={now}
          onClose={close}
        />
      )}
    </>
  )
}

/** The words next to the dot: one span, or the full and the short form when they differ (YAZ-5216: CSS picks by width). */
export function DotWords({ dot }: { dot: Dot }) {
  if (dot.short === dot.words)
    return (
      <span className="sync-status__words" aria-hidden="true">
        {dot.words}
      </span>
    )
  return (
    <>
      <span className="sync-status__words sync-status__words--full" aria-hidden="true">
        {dot.words}
      </span>
      <span className="sync-status__words sync-status__words--short" aria-hidden="true">
        {dot.short}
      </span>
    </>
  )
}
