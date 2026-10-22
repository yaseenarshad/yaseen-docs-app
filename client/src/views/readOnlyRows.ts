/**
 * A read-only note in a folder's views (YAZ-3076 D6, S52-S58): the ONE guard every write the pane
 * makes for a note passes through — a cell's commit and a group move (`FolderHost.writeValues`), and
 * the Name cell's title edit (`FolderHost.retitle`). A write for a note whose index record says
 * `readonly: true` is refused with the words of the cell's tooltip; every other note's goes through,
 * so a write that loops over rows skips the locked ones and still changes the rest (S54). The views
 * also gate their own UI on the same switch (`EditableCell`'s `readOnly`, the drag source), so the
 * guard is the backstop, never the only lock. Folder-wide actions — a column's rename or delete —
 * do not come here and still reach every note (S55).
 */
import type { IndexRecord } from '@shared/types'
import { isReadOnlyProperties } from '@shared/readOnly'
import type { PropertyWrite } from './writeProperty'

/** What a locked cell says when the human tries it, and what a refused write rejects with (S56). */
export const READ_ONLY_TIP = 'This note is read only'

/**
 * The paths of the read-only notes among `records`, read off each note's OWN properties: a folder that
 * uses IDs shows its views the folder's block of `in` (D19), where the switch is not, so the host
 * reads it here before that projection and hands the set down.
 */
export function readOnlyPaths(records: readonly IndexRecord[]): ReadonlySet<string> {
  return new Set(records.filter((r) => isReadOnlyProperties(r.properties)).map((r) => r.path))
}

/** `write`, refusing a path in `locked` (see the module doc). */
export function guardReadOnly(locked: ReadonlySet<string>, write: (path: string, writes: readonly PropertyWrite[]) => Promise<unknown>): (path: string, writes: readonly PropertyWrite[]) => Promise<unknown> {
  return (path, writes) => (locked.has(path) ? Promise.reject(new Error(READ_ONLY_TIP)) : write(path, writes))
}
