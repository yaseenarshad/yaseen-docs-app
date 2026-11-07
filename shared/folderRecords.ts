import type { IndexRecord } from './types'
import { dirname } from './paths'

/** The settings records by the directory each is the folder of. */
export const foldersByDir = (folders: readonly IndexRecord[]): Map<string, IndexRecord> => new Map(folders.map(record => [dirname(record.path), record]))

/** The settings records by folder id. Of two folders still sharing an id the first in path order is the one it names — the id sweep's own choice. */
export function foldersById(folders: readonly IndexRecord[]): Map<string, IndexRecord> {
  const byId = new Map<string, IndexRecord>()
  for (const folder of folders) if (folder.id !== undefined && !byId.has(folder.id)) byId.set(folder.id, folder)
  return byId
}
