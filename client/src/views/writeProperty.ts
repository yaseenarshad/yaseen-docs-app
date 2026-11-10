import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { setFolderValueOneSpelling, setOneSpelling } from '@shared/propertyKeys'
import { isFolderSettingsPath, type FileResponse } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { columnReservedKeys } from '../links/reservedKeys'

export type ContentTransform = (content: string) => string

export interface PropertyWrite {
  key: string
  value: unknown
}

/**
 * Whole-file writes still in flight: every `transformFile`, and the properties panel's raw-YAML
 * Save. Most callers fire and forget (a property tick, a comment, a column width), and one is two
 * IPC round trips, so the close/quit handshake awaits these (YAZ-2174): a window destroyed between
 * the read and the write would never issue the write.
 */
const inflight = new Set<Promise<unknown>>()

/**
 * Resolves once no transform is in flight, including ones started while it waits. Never rejects. It answers whether
 * every write it waited for landed (YAZ-3737 D2): a rejected one makes the window's flush not clean.
 */
export async function settleFileWrites(): Promise<boolean> {
  let landed = true
  while (inflight.size > 0) {
    const results = await Promise.allSettled([...inflight])
    if (results.some((r) => r.status === 'rejected')) landed = false
  }
  return landed
}

/**
 * Apply one pure whole-file transformation with the shared no-op and optimistic-concurrency
 * contract: write against the bytes just read, then re-read and recompute once on conflict.
 * Resolves with the bytes that are on disk afterwards — the transformed content, or the fresh
 * read when the transform was a no-op — so a caller can adopt exactly what landed (YAZ-1472).
 */
export function transformFile(path: string, transform: ContentTransform, quiet = false): Promise<{ mtime: number; content: string }> {
  return trackFileWrite(runTransform(path, transform, quiet))
}

/** Puts `write` in the set `settleFileWrites` awaits until it settles; returns it unchanged. */
export function trackFileWrite<T>(write: Promise<T>): Promise<T> {
  inflight.add(write)
  void write.then(
    () => inflight.delete(write),
    () => inflight.delete(write),
  )
  return write
}

/**
 * A folder's settings file that is not there yet (a vault that does not use IDs, or one whose ID
 * pass has not reached the folder — D13) is created by its first change (YAZ-2290 D1) — here, so every writer
 * gets it: a missing one reads as empty and the write creates it, so a change that comes to nothing
 * or is refused leaves no file. Another writer creating it first is a CONFLICT (`expectedMtime: 0`).
 */
export async function readForWrite(path: string): Promise<Pick<FileResponse, 'content' | 'mtime'>> {
  try {
    return await api.readFile(path)
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'NOT_FOUND' || !isFolderSettingsPath(path)) throw err
    return { content: '', mtime: 0 }
  }
}

/** `quiet`: a tidy-up the user did not make on this file (`FileWriteRequest.quiet`, YAZ-3235 D1) — the save log skips it. */
async function runTransform(path: string, transform: ContentTransform, quiet: boolean): Promise<{ mtime: number; content: string }> {
  let file = await readForWrite(path)
  let retried = false

  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return { mtime: file.mtime, content }
    try {
      return { mtime: (await api.writeFile({ path, content, expectedMtime: file.mtime, ...(quiet ? { quiet } : {}) })).mtime, content }
    } catch (err) {
      if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT' || retried) throw err
      retried = true
      file = await api.readFile(path)
    }
  }
}

/** Apply several frontmatter changes in one guarded whole-file transformation. */
export async function writeProperties(path: string, writes: readonly PropertyWrite[]): Promise<{ mtime: number }> {
  return transformFile(path, (content) => writes.reduce((next, { key, value }) => setFrontmatterProperty(next, key, value), content))
}

/**
 * Change one frontmatter key; the one-key specialization of `writeProperties` (GRO-2141). With `rebase`, the value
 * written is `rebase` of the key's value in the bytes just read, at the first read and again at the retry after a
 * CONFLICT (YAZ-4596 S38): a whole-block writer lays its own change onto what another writer has put there.
 */
export async function writeProperty(path: string, key: string, value: unknown, rebase?: (onDisk: unknown) => unknown): Promise<{ mtime: number }> {
  if (rebase === undefined) return writeProperties(path, [{ key, value }])
  return transformFile(path, (content) => setFrontmatterProperty(content, key, rebase(parseFrontmatter(splitFrontmatter(content).frontmatter).properties[key])))
}

/**
 * A folder page's values for one note (YAZ-4713 C1/C3), in ONE guarded whole-file transformation: each key is the
 * note's own top-level field, or, when its column is separate on this page, a field of this page's block (`pageId`).
 * Every cell edit, paste, fill, Undo, board drag and calendar drag of a folder page comes through here.
 *
 * YAZ-4769 (one key, capitals ignored): each value is written under the column's spelling, and the note's other
 * spellings of that key go in the same write (`setOneSpelling`) — a note's `dessert column` becomes `Dessert Column`
 * when its cell is edited. The app's keys are never removed by that fold — every vault's (`columnReservedKeys(true)`):
 * where the vault does not use IDs, an `id`, `title` or `in` field then simply stays beside a column of its name.
 */
export function writeRouted(path: string, writes: readonly PropertyWrite[], separate: ReadonlySet<string>, pageId: string | undefined): Promise<{ mtime: number }> {
  const keep = columnReservedKeys(true)
  return transformFile(path, (content) =>
    writes.reduce((next, { key, value }) => (pageId !== undefined && separate.has(key) ? setFolderValueOneSpelling(next, pageId, key, value) : setOneSpelling(next, key, value, keep)), content),
  )
}
