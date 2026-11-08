/**
 * Delete a column (YAZ-1513): the window's door to `removeColumn` (`@shared/folderColumns`), which the CLI's
 * `folderColumn remove` shares (YAZ-4527 P7). The settings write is the host's; each note's strip is a quiet
 * `transformFile`. A refusal of the settings write ABORTS — no note is touched; the host has already surfaced that
 * error. Rejects with the aggregated strip failures otherwise.
 */
import { canonicalKey, removeColumn, type ColumnRemovalHost } from '@shared/folderColumns'
import { transformFile } from './writeProperty'
// The pure rules live in `@shared/folderColumns`, which the CLI's `folderColumn remove` shares (YAZ-4518).
export { filterMentions, notesHolding, pruneColumnFromViews, pruneColumnLabel, pruneFilter, undeletableReason } from '@shared/folderColumns'

export type DeleteColumnHost = Omit<ColumnRemovalHost, 'transform'>

export async function deleteColumn(key: string, host: DeleteColumnHost): Promise<void> {
  const { failed } = await removeColumn(key, { ...host, transform: (path, change) => transformFile(path, change, true) })
  if (failed.length === 0) return
  const bare = canonicalKey(key).slice('note.'.length)
  throw new Error(
    `Could not remove "${bare}" from ${failed.length} ${failed.length === 1 ? 'note' : 'notes'}: ${failed.map(({ note, why }) => `${note.title} (${why})`).join('; ')}`,
  )
}
