import type { IndexRecord } from './types'
import { dirname } from './paths'

/** The settings records by the directory each is the folder of. */
export const foldersByDir = (folders: readonly IndexRecord[]): Map<string, IndexRecord> => new Map(folders.map(record => [dirname(record.path), record]))
