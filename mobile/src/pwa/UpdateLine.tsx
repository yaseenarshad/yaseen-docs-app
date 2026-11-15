import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { openOutbox } from '../answers/outbox'
import { useApp } from '../app/AppState'
import { hasAnyUnsentDraft } from '../page/comments/unsentDrafts'
import { reviewInProgress, subscribeReviewInProgress } from '../review/inProgress'
import { waitingRemoves } from '../screens/waitingRemoves'
import { holdsOf, lineFor, swapNow, type AppMoment, type Trigger } from './safeMoment'
import type { Updates } from './updates'
import './update.css'

/**
 * "A new version is ready." (YAZ-5087): a line over the tab bar when a new version waits. Restart makes it take over at
 * once (the active case); coming back from the background after 30 s or more does it by itself, when nothing is unsaved
 * (YAZ-5555). Both only at a safe moment: THE RULE is written once, in `safeMoment.ts`. Most updates never show the
 * line: a version that waits starts at the next open, before the app runs (`main.tsx`).
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
  // YAZ-5555: the other writes that wait (the comment list, read from its own chunk, and the friends removes). A read
  // that fails counts as one waiting: the app then does not restart by itself.
  const readWrites = useCallback(async () => {
    const comments = vault === null ? 0 : await import('../comments/outbox').then((m) => m.waitingComments(store, vault))
    return comments + (await waitingRemoves(store))
  }, [store, vault])
  return <UpdateLineView updates={updates} moment={moment} readWaiting={readWaiting} readWrites={readWrites} unsentText={hasAnyUnsentDraft} now={Date.now} />
}

export function UpdateLineView(props: {
  updates: Updates
  moment: AppMoment
  readWaiting: () => Promise<number>
  /** YAZ-5555: the comments, ticks and friends removes that wait. Absent: none. */
  readWrites?: () => Promise<number>
  /** YAZ-5555: a comment box holds words not sent. Absent: none. */
  unsentText?: () => boolean
  now: () => number
}) {
  const { updates, moment, readWaiting, now } = props
  const ready = useSyncExternalStore(updates.subscribe, updates.ready, updates.ready)
  const [waiting, setWaiting] = useState(0)
  const latest = { moment, readWaiting, readWrites: props.readWrites ?? (async () => 0), unsentText: props.unsentText ?? (() => false), ready }

  // The answer count, read again each time the line could show.
  useEffect(() => {
    if (!ready) return
    let live = true
    void readWaiting().then((n) => live && setWaiting(n), () => {})
    return () => {
      live = false
    }
  }, [ready, moment.tab, moment.routeOpen, moment.phase, readWaiting])

  // Back from the background: ask for a newer version, and take a waiting one when it is safe.
  useEffect(() => {
    let hiddenAt: number | null = null
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = now()
        // Let the new version take over while the person is away; the page loads it later, at a safe moment.
        if (updates.ready()) updates.prepare()
        return
      }
      const hiddenMs = hiddenAt === null ? 0 : now() - hiddenAt
      hiddenAt = null
      void updates.check()
      void decide('resume', hiddenMs)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  })

  async function decide(trigger: Trigger, hiddenMs: number) {
    // Back from the background: only a version that already took over (the swap is then at once). A takeover that
    // comes some seconds later could land in the middle of what the person starts.
    if (trigger === 'resume' && !updates.tookOver()) return
    // Each fact read fresh, at the decision; a read that fails holds (never a reload over something not saved).
    const [answersWaiting, writesWaiting] = await Promise.all([latest.readWaiting().catch(() => 1), latest.readWrites().catch(() => 1)])
    const holds = holdsOf({ ...latest.moment, answersWaiting, writesWaiting, unsentText: latest.unsentText() })
    if (swapNow({ ready: updates.ready(), trigger, holds, hiddenMs })) updates.apply()
    else setWaiting(answersWaiting)
  }

  if (!ready || moment.phase !== 'ready' || moment.routeOpen) return null
  const holds = holdsOf({ ...moment, answersWaiting: waiting, unsentText: latest.unsentText() })
  const line = lineFor(holds)
  return (
    <div className="update-line" role="status">
      <p>{line.text}</p>
      {line.restart && (
        <button type="button" className="btn" onClick={() => void decide('tap', 0)}>
          Restart
        </button>
      )}
    </div>
  )
}
