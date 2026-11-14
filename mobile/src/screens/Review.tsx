import { lazy, Suspense, useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
import type { ReviewLink } from '../review/link'
import { vaultName } from './Frame'

/**
 * The review screen is a chunk of its own: the card drawing (`marked`, DOMPurify), the scheduler (`ts-fsrs`) and the
 * shared parsers are not in the first load. It loads with the engine, when a vault opens.
 */
const ReviewView = lazy(() => import('../review/ReviewView').then((m) => ({ default: m.ReviewView })))

const waiting = (
  <div className="review review--waiting" aria-busy="true">
    <p className="muted">Reading your cards…</p>
  </div>
)

/**
 * The Review tab (4B, YAZ-5078): the shell (4A) draws it for the tab "Review". It takes the engine and the ONE answer
 * list of the open vault from the sync (`services.sync.review()`, made in `app/lazySync.ts`) and draws `ReviewView`
 * (`review/`). "Open page" and "Open card" open 4C's read-only routes over the tabs.
 */
export function Review() {
  const app = useApp()
  const { sync } = app.services
  const [link, setLink] = useState<ReviewLink | null>(null)
  useEffect(() => {
    let live = true
    void sync.review?.().then((l) => live && setLink(l))
    return () => {
      live = false
    }
  }, [sync, app.vaultKey, app.sync.ready])
  if (link === null || app.vault === null || app.vaultKey === null) return waiting
  return (
    <Suspense fallback={waiting}>
      <ReviewView
        link={link}
        vault={app.vaultKey}
        vaultName={vaultName(app.vault.repo)}
        unit={app.unit}
        open={(to) => app.go({ type: 'open', route: to.kind === 'card' ? { kind: 'card', path: to.path, id: to.id } : { kind: 'page', path: to.path } })}
      />
    </Suspense>
  )
}
