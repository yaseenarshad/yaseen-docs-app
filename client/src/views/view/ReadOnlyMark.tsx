import type { ReactNode } from 'react'
import { LockIcon } from './icons'

/**
 * The lock after a read-only note's name in a folder's views (YAZ-3076 D9, S59-S62): the table's
 * Name cell, the board card title, the cards title and the list row. Muted, the size of the text,
 * no layout of its own (`views.css`), "Read only" on a hover. It carries no text, so the name reads
 * the same to every reader of it.
 */
export function ReadOnlyMark() {
  return (
    <span className="view-read-only-mark" title="Read only" aria-label="Read only" role="img">
      <LockIcon size={12} />
    </span>
  )
}

/**
 * A read-only note's name with its lock (YAZ-3129): the NAME is what ellipses, and the lock is its
 * sibling, so a long name is cut before the lock and the lock always shows after the "…". The views'
 * name boxes clip with `text-overflow`; a lock inside the clipped text went with the cut.
 */
export function ReadOnlyName({ children }: { children: ReactNode }) {
  return (
    <span className="view-read-only-name">
      <span className="view-read-only-name__text">{children}</span>
      <ReadOnlyMark />
    </span>
  )
}
