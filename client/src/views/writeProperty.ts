import { setFrontmatterProperty } from '@shared/frontmatter'
import { isFolderSettingsPath, type FileResponse } from '@shared/types'
import { BridgeRequestError, api } from '../api'

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

/** Resolves once no transform is in flight, including ones started while it waits. Never rejects. */
export async function settleFileWrites(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight])
}

/**
 * Apply one pure whole-file transformation with the shared no-op and optimistic-concurrency
 * contract: write against the bytes just read, then re-read and recompute once on conflict.
 * Resolves with the bytes that are on disk afterwards — the transformed content, or the fresh
 * read when the transform was a no-op — so a caller can adopt exactly what landed (YAZ-1472).
 */
export function transformFile(path: string, transform: ContentTransform): Promise<{ mtime: number; content: string }> {
  return trackFileWrite(runTransform(path, transform))
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
 * A folder's settings file that is not there yet (an un-adopted vault, or the id sweep has not
 * reached the folder — D13) is created by its first change (YAZ-2290 D1) — here, so every writer
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

async function runTransform(path: string, transform: ContentTransform): Promise<{ mtime: number; content: string }> {
  let file = await readForWrite(path)
  let retried = false

  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return { mtime: file.mtime, content }
    try {
      return { mtime: (await api.writeFile({ path, content, expectedMtime: file.mtime })).mtime, content }
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

/** Change one frontmatter key; the one-key specialization of `writeProperties` (GRO-2141). */
export async function writeProperty(path: string, key: string, value: unknown): Promise<{ mtime: number }> {
  return writeProperties(path, [{ key, value }])
}
