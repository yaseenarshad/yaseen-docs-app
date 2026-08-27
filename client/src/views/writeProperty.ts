import { setFrontmatterProperty } from '@shared/frontmatter'
import { BridgeRequestError, api } from '../api'

export type ContentTransform = (content: string) => string

/**
 * Apply one pure whole-file transformation with the shared no-op and optimistic-concurrency
 * contract: write against the bytes just read, then re-read and recompute once on conflict.
 */
export async function transformFile(path: string, transform: ContentTransform): Promise<{ mtime: number }> {
  let file = await api.readFile(path)
  let retried = false

  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return { mtime: file.mtime }
    try {
      return { mtime: (await api.writeFile({ path, content, expectedMtime: file.mtime })).mtime }
    } catch (err) {
      if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT' || retried) throw err
      retried = true
      file = await api.readFile(path)
    }
  }
}

/**
 * Change one frontmatter key of a note on disk (GRO-2141). This is the surgical one-key
 * specialization of `transformFile`; conflict retry and no-op handling stay in one place.
 *
 * `FrontmatterWriteError` (broken frontmatter) propagates and nothing is written.
 */
export async function writeProperty(path: string, key: string, value: unknown): Promise<{ mtime: number }> {
  return transformFile(path, (content) => setFrontmatterProperty(content, key, value))
}
