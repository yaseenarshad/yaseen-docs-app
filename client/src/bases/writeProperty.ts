import { setFrontmatterProperty } from '@shared/frontmatter'
import { ApiRequestError, api } from '../api'

/**
 * Change one frontmatter key of a note on disk (GRO-2141). Reads the current bytes,
 * rewrites just that key, and writes with `expectedMtime`; on CONFLICT it re-reads
 * once and retries (the value the user picked wins over a concurrent edit elsewhere
 * in the file, which is preserved because only this key is rewritten).
 *
 * `FrontmatterWriteError` (broken frontmatter) propagates and nothing is written.
 */
export async function writeProperty(path: string, key: string, value: unknown): Promise<{ mtime: number }> {
  const file = await api.readFile(path)
  const content = setFrontmatterProperty(file.content, key, value)
  // No-op edits never touch disk, same as the editor's autosave.
  if (content === file.content) return { mtime: file.mtime }

  try {
    return { mtime: (await api.writeFile({ path, content, expectedMtime: file.mtime })).mtime }
  } catch (err) {
    if (!(err instanceof ApiRequestError) || err.code !== 'CONFLICT') throw err
    const fresh = await api.readFile(path)
    const merged = setFrontmatterProperty(fresh.content, key, value)
    // A second conflict throws: two racing writers means something else is fighting us.
    return { mtime: (await api.writeFile({ path, content: merged, expectedMtime: fresh.mtime })).mtime }
  }
}
