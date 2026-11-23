/**
 * READ ONLY ASKS FIRST (YAZ-5411, Yaseen on YAZ-5349: "It shouldn't allow you to go through the entire thing and then
 * end up with this stupid error"). The ONE guard of a folder table's writes: every change that writes a file — a
 * column's add, edit, type, option rename, rename or delete, a cell, Card status and Up next, a drag that writes a
 * value, "+ New" of a card — in Pages rows and in Cards rows alike, asks the folder page's own "Allow edits?" (the
 * Read only chip's box, the one the title and the editor use) BEFORE it starts: before its confirm sheet, before any
 * write. A choice in the box unlocks this tab and the change goes on, on the doors current then; Cancel, Esc or a press
 * outside the box drops it, and nothing changes. A view change (a sort, a filter, a hide, a width) writes the view and
 * never asks (YAZ-4939 round 3).
 *
 * `FolderView` owns the lock (`EditLock`); `ViewsPane` wraps the host its views read with `guardEdits`, and hands the
 * lock down (`EditLockContext`) to the few places that ask before a sheet of their own (Delete column…) or before an
 * editor opens (a locked cell).
 */
import { createContext } from 'react'
import { CHANGE_CANCELLED } from './confirmChanges'
import type { FolderHost } from './ViewsPane'

export interface EditLock {
  /**
   * The change waits on "Allow edits?" now. With no `page`: a change of the folder page itself (its columns, its views'
   * labels, its cards' columns). With a `page`: a change of that row's page — locked by the vault's Read only and opened
   * by this tab's unlock; a page's own switch is that page's, and the box does not open it (the row keeps its tip).
   */
  locked: (page?: string) => boolean
  /** Opens the box. True once edits are allowed and the unlock has rendered (the doors are the unlocked ones); false on Cancel. */
  ask: () => Promise<boolean>
}

/** The folder page's lock, for the views that ask before their own sheet or editor. Null: nothing asks (no folder page). */
export const EditLockContext = createContext<EditLock | null>(null)

/**
 * `run` now when the change is not locked (its result as it is), else "Allow edits?" first and `run` once allowed;
 * `cancelled` is what a Cancel gives the caller (nothing happened).
 */
export function afterAllow<T>(lock: EditLock | null | undefined, page: string | undefined, run: () => T, cancelled: () => T): T | Promise<Awaited<T>> {
  if (lock == null || !lock.locked(page)) return run()
  return lock.ask().then((ok) => (ok ? run() : cancelled())) as Promise<Awaited<T>>
}

/** A Cancel of a door that hands back a promise: settled, quietly — a cell drops its draft (`CHANGE_CANCELLED`), a column form closes. */
const quiet = (): Promise<undefined> => Promise.resolve(undefined)
const dropped = (): Promise<never> => Promise.reject(CHANGE_CANCELLED)

/**
 * `host` with every door that writes files behind "Allow edits?" (see the module doc). A door that waited runs on
 * `latest()` — the host of the render after the unlock — since the one it was called on still holds the lock.
 */
export function guardEdits(host: FolderHost, latest: () => FolderHost): FolderHost {
  const lock = host.editLock
  if (lock === undefined) return host
  /** A door of the folder page itself (its columns): it runs on `latest()` once allowed. */
  const folderDoor = <A extends unknown[], R>(door: (h: FolderHost) => ((...a: A) => R) | undefined, cancelled: () => R) =>
    (...a: A): R => afterAllow(lock, undefined, () => door(latest())!(...a), cancelled) as R
  const none = (): void => undefined
  return {
    ...host,
    setColumn: folderDoor((h) => h.setColumn, quiet),
    setColumns: folderDoor((h) => h.setColumns, none),
    ...(host.addColumn && { addColumn: folderDoor((h) => h.addColumn, none) }),
    ...(host.deleteColumn && { deleteColumn: folderDoor((h) => h.deleteColumn, quiet) }),
    ...(host.separate && { separate: { ...host.separate, set: folderDoor((h) => h.separate?.set, quiet) } }),
    ...(host.relation && { relation: { ...host.relation, set: folderDoor((h) => h.relation?.set, quiet) } }),
    // A row's own page: the vault's lock, which this tab's unlock opens.
    writeValues: (path, writes) => afterAllow(lock, path, () => latest().writeValues(path, writes), dropped),
    retitle: (path, title) => void afterAllow(lock, path, () => latest().retitle(path, title), none),
  }
}
