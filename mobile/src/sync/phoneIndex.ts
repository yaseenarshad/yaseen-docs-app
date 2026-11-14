import { indexRecord, type IndexRecordMeta } from '@shared/indexRecord'
import type { IndexRecord } from '@shared/types'
import type { VaultStore } from '../store'

/**
 * The phone's index of the open vault: one record for each page and card file, built with the Mac's own
 * `indexRecord` (`shared/indexRecord.ts`, 2B). Search (4C), review (4B) and the friends numbers read it. A card file
 * gets `kind: 'card'` and its `title`; a page that embeds a card holds only the ID, in `embeds` (YAZ-5037, YAZ-5044).
 *
 * It is kept as the vault's phone-only state `INDEX_STATE`, written by the sync pass just BEFORE the checkpoint. It
 * is trusted only when its `commit` is the checkpoint's; else the pass builds it again in full (after "Reset local
 * copy", a format change, or a stop between the two writes). It is trusted only when its `rules` are this build's
 * too (`INDEX_RULES`): an update of the app builds its records again from the stored files, with no network.
 */
export const INDEX_STATE = 'index'

/**
 * The rules the records are built by, as the Mac's `CACHE_VERSION` (`desktop/.../vaultIndex/cache.ts`). Raise it when
 * `indexRecord` reads a file in a new way. 2 (YAZ-5309): a card's title is its card line's `title` part (YAZ-5308),
 * never its first line nor a card file's `title` property. Absent (1): every index stored before it.
 */
export const INDEX_RULES = 2

export interface PhoneIndex {
  /** The commit the records are of. */
  commit: string
  /** The rules the records are built by (`INDEX_RULES`); absent in an index of an older build. */
  rules?: number
  /** Path in the vault (`folder/name.md`, no leading `/`) → its record. */
  records: Record<string, IndexRecord>
}

/**
 * The record of one file. On the phone `path` is the path in the repo, not an absolute path as on the Mac. GitHub's
 * tree has no file times: `ctime` is when the phone first had the file, `mtime` when it got this version.
 * `text` null: the file is over the desktop's size limit, and the record holds the metadata only (row F7).
 */
export function phoneRecord(path: string, size: number, text: string | null, times: { ctime: number; mtime: number }): IndexRecord {
  const parts = path.split('/')
  const name = parts.pop()!
  // As Node's `path.extname`: a leading dot alone is no extension (`.folder.md` has `.md`, `.md` has none).
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  const meta: IndexRecordMeta = {
    path,
    name,
    basename: name.slice(0, name.length - ext.length),
    folder: parts.join('/'),
    ext: ext.slice(1).toLowerCase(),
    size,
    ctime: times.ctime,
    mtime: times.mtime,
  }
  return indexRecord(meta, text)
}

/** Was `index` built by this build's rules (`INDEX_RULES`)? */
export const ofTheseRules = (index: PhoneIndex): boolean => index.rules === INDEX_RULES

/**
 * `index` built again by this build's rules (YAZ-5309), from the files the phone holds: each record's file read from
 * `store`, with its size and times kept. A file the phone does not hold as text (over the size limit, F7) keeps a
 * record of its metadata only. No network.
 */
export async function rebuiltIndex(store: Pick<VaultStore, 'read'>, vault: string, index: PhoneIndex): Promise<PhoneIndex> {
  const records: Record<string, IndexRecord> = {}
  for (const [path, held] of Object.entries(index.records)) {
    const file = await store.read(vault, path)
    records[path] = phoneRecord(path, held.size, file !== null && typeof file.content === 'string' ? file.content : null, { ctime: held.ctime, mtime: held.mtime })
  }
  return { commit: index.commit, rules: INDEX_RULES, records }
}
