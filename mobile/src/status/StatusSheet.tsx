import { useEffect, useRef } from 'react'
import { useApp } from '../app/AppState'
import { syncHelp } from '../app/help'
import type { TokenEndWarning } from '../auth/expiry'
import { DiscardAnswer } from '../screens/DiscardAnswer'
import { ForwardButton } from '../screens/Frame'
import { clockTime, dayDate, lastSyncWords, lostRows, nextTryWords, type Dot } from './dot'
import type { DotAnswersView } from './useDotAnswers'

/**
 * What a tap on the dot shows (decision 12): the state, the time of the last sync, and only when there is one, what
 * to do: "Sign in again" (red), "Replace token" (the token ends soon), Discard for each lost answer (round 12 item 9).
 * A sheet at the bottom of the screen, near the thumb. Close, Escape or a tap outside closes it.
 */
export function StatusSheet({ dot, token, answers, now, lastAt, onClose }: { dot: Dot; token: TokenEndWarning; answers: DotAnswersView; now: number; lastAt: number | null; onClose: () => void }) {
  const app = useApp()
  const close = useRef<HTMLButtonElement>(null)
  const nav = useRef(app.nav)

  useEffect(() => {
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // A way forward opens another screen: the sheet goes with it.
  useEffect(() => {
    if (app.nav !== nav.current) onClose()
  }, [app.nav, onClose])

  const sync = app.sync
  const lost = lostRows(answers.state?.lost ?? [])
  const listWait = dot.reason === 'waiting' ? waitWords(answers, now) : null
  const said = listWait !== null ? null : why(dot, sync.status === 'slowed' ? sync.retryAt : null)
  const red = dot.state === 'attention' && app.vault !== null ? (syncHelp({ ...sync, problem: sync.status === 'attention' ? sync.problem : (answers.state?.problem ?? null) }, app.vault, app.unit, false) ?? null) : null

  return (
    <div className="status-sheet__backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="status-sheet" role="dialog" aria-modal="true" aria-label="Sync status">
        <p className="status-sheet__head">
          <span className={`sync-dot sync-dot--${dot.state}`} aria-hidden="true" />
          <strong>{dot.words}</strong>
        </p>
        <p className="muted">
          {lastSyncWords(lastAt, now)}
          {lastAt !== null && `, at ${clockTime(lastAt)}`}
        </p>
        {said !== null && <p>{said}</p>}
        {listWait !== null && (
          <div className="stack">
            <p>{listWait}</p>
            <button type="button" className="btn" onClick={() => void answers.list?.sendNow()}>
              Try now
            </button>
          </div>
        )}

        {dot.state === 'attention' &&
          (red !== null ? (
            <div className="stack">
              <p>{red.message}</p>
              <ForwardButton forward={red.forward} />
            </div>
          ) : (
            <div className="stack">
              <p>{token.kind === 'ended' ? `Your GitHub token ended on ${dayDate(token.endsAt)}. Make a new token, then sign in again.` : 'GitHub does not accept your token now.'}</p>
              <ForwardButton forward="sign-in-again" />
            </div>
          ))}

        {token.kind === 'soon' && dot.state !== 'attention' && (
          <div className="stack">
            <p>Your GitHub token ends on {dayDate(token.endsAt)}. Make a new token on GitHub, then tap Replace token.</p>
            <button type="button" className="btn" onClick={() => app.vaultKey !== null && app.go({ type: 'open', route: { kind: 'replace-token', vault: app.vaultKey } })}>
              Replace token
            </button>
          </div>
        )}

        {lost.length > 0 && (
          <>
            <p>The phone could not save {lost.length === 1 ? 'this answer' : 'these answers'}. The card is not in the vault now: it was deleted, or its ID changed.</p>
            <ul className="rows">
              {lost.map((row) => (
                <li key={row.id} className="row">
                  <span className="row__main">
                    {row.title}
                    <br />
                    <span className="muted">{row.answer}</span>
                  </span>
                  <DiscardAnswer title={row.title} answer={row.answer} label={`Discard the answer to ${row.title}`} onDiscard={() => Promise.all(row.seqs.map((seq) => answers.list?.discard(seq)))} />
                </li>
              ))}
            </ul>
          </>
        )}

        <button ref={close} type="button" className="btn btn--wide" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

/**
 * YAZ-5214: the answer list waits by its OWN state, not the engine's: after "slow down" or a branch that kept moving
 * (`STALE_HEAD`) it backs off 1, 2, 4 … up to 60 minutes; after a failed send it waits for the next sync. The sheet
 * says when the next try is and that nothing is lost. Null: the list sends in a few seconds (the normal case).
 */
function waitWords(answers: DotAnswersView, now: number): string | null {
  const state = answers.state
  if (state === null || state.problem === null) return null
  const safe = 'Nothing is lost: your answers are safe on this phone.'
  if ((state.problem === 'RATE_LIMITED' || state.problem === 'STALE_HEAD') && state.retryAt !== null && state.retryAt > now) {
    const cause = state.problem === 'RATE_LIMITED' ? 'GitHub asked the app to slow down.' : 'The vault changed on GitHub while the phone sent.'
    return `${cause} ${safe} ${nextTryWords(state.retryAt, now)}`
  }
  return `The last send did not reach GitHub. ${safe} The phone tries again at the next sync.`
}

/** One sentence that says what the state means for the person. None for green, red and a lost answer (they have their own part). */
function why(dot: Dot, retryAt: number | null): string | null {
  const slowed = retryAt === null ? null : `GitHub asked the app to slow down. It tries again at ${clockTime(retryAt)}.`
  switch (dot.reason) {
    case 'syncing':
      return 'The phone sends your answers and gets the newest changes.'
    case 'waiting':
      return slowed ?? 'Your answers are safe on this phone. They go to GitHub in a few seconds.'
    case 'waiting-offline':
      return 'Your answers are safe on this phone. They go to GitHub when the signal is back.'
    case 'offline':
      return 'No connection to GitHub. You can still review. Your answers wait on this phone.'
    case 'slowed':
      return slowed ?? 'GitHub asked the app to slow down. It tries again in a few minutes.'
    case 'starting':
      return 'The phone has not synced this vault yet.'
    case 'checking':
      return 'The phone reads the answers it keeps. This takes a moment.'
    default:
      return null
  }
}
