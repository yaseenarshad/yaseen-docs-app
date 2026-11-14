/** A folder's title from the index, with no bridge (YAZ-5161): `shortcuts.ts` gives out the same names. */
import { folderSettingsPath, type IndexRecord } from '@shared/types'
import { basename } from '../lib/paths'

/** The settings record of the folder at `dir`; undefined while it has no `.folder.md`. */
export function folderRecord(folders: readonly IndexRecord[], dir: string): IndexRecord | undefined {
  const path = folderSettingsPath(dir)
  return folders.find((r) => r.path === path)
}

/** A folder's title (YAZ-2420 🔒 D14): its settings record's, else, while it has no `.folder.md`, its directory's name. */
export const folderTitle = (folders: readonly IndexRecord[], dir: string): string => folderRecord(folders, dir)?.title ?? basename(dir)
