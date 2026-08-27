import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { BridgeRequestError, api } from '../api'

type Transform = (content: string) => string

async function writeTransformed(path: string, transform: Transform): Promise<{ mtime: number }> {
  const file = await api.readFile(path)
  const content = transform(file.content)
  if (content === file.content) return { mtime: file.mtime }

  try {
    return { mtime: (await api.writeFile({ path, content, expectedMtime: file.mtime })).mtime }
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    const fresh = await api.readFile(path)
    const merged = transform(fresh.content)
    if (merged === fresh.content) return { mtime: fresh.mtime }
    // A second conflict throws: two racing writers means something else is fighting us.
    return { mtime: (await api.writeFile({ path, content: merged, expectedMtime: fresh.mtime })).mtime }
  }
}

/**
 * Change one frontmatter key of a note on disk (GRO-2141). Reads the current bytes,
 * rewrites just that key, and writes with `expectedMtime`; on CONFLICT it re-reads
 * once and retries (the value the user picked wins over a concurrent edit elsewhere
 * in the file, which is preserved because only this key is rewritten).
 *
 * `FrontmatterWriteError` (broken frontmatter) propagates and nothing is written.
 */
export async function writeProperty(path: string, key: string, value: unknown): Promise<{ mtime: number }> {
  return writeTransformed(path, (content) => setFrontmatterProperty(content, key, value))
}

/**
 * Add one frontmatter key only when it is absent from the LATEST file bytes (YAZ-999). Index
 * records may lag the disk, so presence is checked again after the read and after a conflict.
 * Every present value wins — including null/falsy values and a value whose type disagrees with
 * the declaration asking for the backfill.
 */
export async function writePropertyIfMissing(path: string, key: string, value: unknown): Promise<{ mtime: number }> {
  return writeTransformed(path, (content) => {
    const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
    if (Object.prototype.hasOwnProperty.call(parsed.properties, key)) return content
    // On broken frontmatter this is also the authoritative validation step: it throws the same
    // FrontmatterWriteError as every other one-key write, and the file stays untouched.
    return setFrontmatterProperty(content, key, value)
  })
}
