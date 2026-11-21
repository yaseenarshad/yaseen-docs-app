import { createContext, useContext, type ReactNode } from 'react'
import { EditLockContext } from '../editGuard'
import { LockIcon } from './icons'

/**
 * The lock after a read-only page's name in a folder's views (YAZ-3076 D9, S59-S62): the table's
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
 * A read-only page's name with its lock (YAZ-3129): the NAME is what ellipses, and the lock is its
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

/**
 * Whether the views draw an item's lock (YAZ-5587): false while the vault's Read only locks every item of the page —
 * the tab's "Read only" chip says it once, and a lock on every card and row would only repeat it. The folder page
 * provides it; a view on its own draws its locks.
 */
export const ItemLocksShown = createContext(true)

/** A view's read-only items, as every view asks them (YAZ-5587); `readOnly` is the view's own set (rows by path). */
export interface ItemLock {
  /** Its edit asks the folder page's "Allow edits?" first (YAZ-5411): the vault's lock, which this tab's unlock opens. */
  asks: (path: string) => boolean
  /** Nothing opens it here (a page's own switch): no drag, no editor, no edges. */
  fixed: (path: string) => boolean
  /** The lock shows after its name: it is locked while its page's view is not. */
  mark: (path: string) => boolean
  /** An edit of an item that `asks`: the box, then `open` once allowed; false (nothing asked) for any other item. */
  ask: (path: string, open: () => void) => boolean
}

/** The ONE rule of a read-only item in the folder views (YAZ-5587): Table, Board, List, Cards and Calendar read it. */
export function useItemLock(readOnly: ReadonlySet<string>): ItemLock {
  const lock = useContext(EditLockContext)
  const shown = useContext(ItemLocksShown)
  const asks = (path: string) => readOnly.has(path) && lock?.locked(path) === true
  return {
    asks,
    fixed: (path) => readOnly.has(path) && !asks(path),
    mark: (path) => shown && readOnly.has(path),
    ask: (path, open) => {
      if (lock === null || !asks(path)) return false
      void lock.ask().then((ok) => ok && open())
      return true
    },
  }
}

/** A name, with its lock when `mark` (`ItemLock.mark`). */
export function ItemName({ mark, children }: { mark: boolean; children: ReactNode }) {
  return mark ? <ReadOnlyName>{children}</ReadOnlyName> : <>{children}</>
}
