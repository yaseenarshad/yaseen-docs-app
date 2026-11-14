import { useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
import type { ReviewLink } from '../review/link'
import type { ReviewTabProps } from '../review/ReviewTab'
import { vaultName } from './Frame'
import { lazyScreen } from './LazyScreen'

const waiting = (
  <div className="review review--waiting" aria-busy="true">
    <p className="muted">Reading your cards…</p>
  </div>
)

/**
 * The review screen is a chunk of its own: the card drawing (`marked`, DOMPurify), the scheduler (`ts-fsrs`) and the
 * shared parsers are not in the first load. It loads the first time the Review tab shows. If it cannot load (no
 * signal, a new build), `lazyScreen` says so with "Try again"; the tabs stay (YAZ-5230).
 */
const ReviewTab = lazyScreen<ReviewTabProps>(() => import('../review/ReviewTab').then((m) => ({ default: m.ReviewTab })), { waiting })

/** The same link while its parts are the same: a new object would start a new session (YAZ-5224). */
export const sameLink = (a: ReviewLink | null, b: ReviewLink | null) => a === b || (a !== null && b !== null && a.engine === b.engine && a.answers === b.answers && a.store === b.store && a.media === b.media)

/**
 * The Review tab (4B, YAZ-5078). The shell keeps it mounted once opened (`Shell.tsx`, YAZ-5224), so a look at a page,
 * a card, another tab or Settings comes back to the same card in the same state. `shown`: the tab is on the screen.
 * It takes the engine and the ONE answer list of the open vault from the sync (`services.sync.review()`).
 */
export function Review({ shown = true }: { shown?: boolean }) {
  const app = useApp()
  const { sync } = app.services
  const [link, setLink] = useState<ReviewLink | null>(null)
  useEffect(() => {
    let live = true
    // A link that is not whole (a fake of another screen's test) waits, as no link does.
    void sync.review?.().then((l) => {
      const whole = l !== null && l.engine !== undefined && l.store !== undefined ? l : null
      if (live) setLink((old) => (sameLink(old, whole) ? old : whole))
    })
    return () => {
      live = false
    }
  }, [sync, app.vaultKey, app.sync.ready, shown && link === null])
  if (link === null || app.vault === null || app.vaultKey === null) return waiting
  return (
    <ReviewTab
      link={link}
      shown={shown}
      vault={app.vaultKey}
      vaultName={vaultName(app.vault.repo)}
      unit={app.unit}
      // YAZ-5225: the page opens AT the card (`at`), as 4C's page view reads it.
      open={(to) => app.go({ type: 'open', route: to.kind === 'card' ? { kind: 'card', path: to.path, id: to.id } : { kind: 'page', path: to.path, ...(to.at !== undefined && { at: to.at }) } })}
    />
  )
}
