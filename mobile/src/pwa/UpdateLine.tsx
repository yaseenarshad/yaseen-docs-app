import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { openOutbox } from '../answers/outbox'
import { useApp } from '../app/AppState'
import { hasAnyUnsentDraft } from '../page/comments/unsentDrafts'
import { reviewInProgress, subscribeReviewInProgress } from '../review/inProgress'
import { holdsOf, lineFor, swapNow, type AppMoment } from './safeMoment'
import type { Updates } from './updates'
import './update.css'

/**
 * "A new version is ready." (YAZ-5087; YAZ-5555): a line over the tab bar whenever a new version is there. Only a tap on
 * Restart makes it take over; nothing restarts by itself (THE RULE: `safeMoment.ts`). When the tap would lose something
 * (answers waiting, words in a comment box, the first download), the line says why instead of showing the button.
 */
export function UpdateLine({ updates }: { updates: Updates }) {
  const app = useApp()
  const reviewing = useSyncExternalStore(subscribeReviewInProgress, reviewInProgress, reviewInProgress)
  const moment: AppMoment = {
    phase: app.phase,
    routeOpen: app.nav.stack.length > 0,
    tab: app.nav.tab,
    downloading: app.sync.vault === app.vaultKey && !app.sync.ready,
    answersWaiting: 0,
    reviewInProgress: reviewing,
  }
  const vault = app.vaultKey
  const store = app.services.store
  // The stored answer list, read fresh at each decision: the list is the truth, not a screen's count.
  const readWaiting = useCallback(async () => (vault === null ? 0 : (await openOutbox(store, vault)).waiting().length), [store, vault])
  return <UpdateLineView updates={updates} moment={moment} readWaiting={readWaiting} unsentText={hasAnyUnsentDraft} />
}

export function UpdateLineView(props: {
  updates: Updates
  moment: AppMoment
  readWaiting: () => Promise<number>
  /** YAZ-5555: a comment box holds words not sent. Absent: none. */
  unsentText?: () => boolean
}) {
  const { updates, moment, readWaiting } = props
  const unsentText = props.unsentText ?? (() => false)
  const ready = useSyncExternalStore(updates.subscribe, updates.ready, updates.ready)
  const [waiting, setWaiting] = useState(0)
  // A return draws the line again (a comment box emptied meanwhile).
  const [, setReturns] = useState(0)

  // The answer count, read again each time the line could show.
  useEffect(() => {
    if (!ready) return
    let live = true
    void readWaiting().then((n) => live && setWaiting(n), () => {})
    return () => {
      live = false
    }
  }, [ready, moment.tab, moment.routeOpen, moment.phase, readWaiting])

  // Back from the background: read the update state and the answer count again, and ask for a newer version. Nothing
  // takes over here.
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState !== 'visible') return
      void updates.check()
      setReturns((n) => n + 1)
      void readWaiting().then(setWaiting, () => {})
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [updates, readWaiting])

  async function tap() {
    // Each fact read fresh, at the tap; a read that fails holds (never a reload over something not saved).
    const answersWaiting = await readWaiting().catch(() => 1)
    const holds = holdsOf({ ...moment, answersWaiting, unsentText: unsentText() })
    if (swapNow({ ready: updates.ready(), holds })) updates.apply()
    else setWaiting(answersWaiting)
  }

  if (!ready || moment.phase !== 'ready' || moment.routeOpen) return null
  const line = lineFor(holdsOf({ ...moment, answersWaiting: waiting, unsentText: unsentText() }))
  return (
    <div className="update-line" role="status">
      <p>{line.text}</p>
      {line.restart && (
        <button type="button" className="btn" onClick={() => void tap()}>
          Restart
        </button>
      )}
    </div>
  )
}
