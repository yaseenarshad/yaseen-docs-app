import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { openOutbox } from '../answers/outbox'
import { useApp } from '../app/AppState'
import { reviewInProgress, subscribeReviewInProgress } from '../review/inProgress'
import { holdsOf, lineFor, swapNow, type AppMoment, type Trigger } from './safeMoment'
import type { Updates } from './updates'
import './update.css'

/**
 * "A new version is ready." (YAZ-5087): a line over the tab bar when a new version waits. Restart makes it take over at
 * once; coming back from the background after a while does it by itself. Both only at a safe moment (`safeMoment.ts`).
 * Most updates never show the line: a version that waits starts at the next open, before the app runs (`main.tsx`).
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
  return <UpdateLineView updates={updates} moment={moment} readWaiting={readWaiting} now={Date.now} />
}

export function UpdateLineView(props: { updates: Updates; moment: AppMoment; readWaiting: () => Promise<number>; now: () => number }) {
  const { updates, moment, readWaiting, now } = props
  const ready = useSyncExternalStore(updates.subscribe, updates.ready, updates.ready)
  const [waiting, setWaiting] = useState(0)
  const latest = { moment, readWaiting, ready }

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
    const answersWaiting = await latest.readWaiting().catch(() => 1)
    const holds = holdsOf({ ...latest.moment, answersWaiting })
    if (swapNow({ ready: updates.ready(), trigger, holds, hiddenMs })) updates.apply()
    else setWaiting(answersWaiting)
  }

  if (!ready || moment.phase !== 'ready' || moment.routeOpen) return null
  const holds = holdsOf({ ...moment, answersWaiting: waiting })
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
