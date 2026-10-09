import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { isMarkdown } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { HEAD_CHARS, HEAD_READ_BYTES, type FileHead } from '@shared/types'
import { requireAbsPath } from './fsUtils'
import { requireStringArray } from './validate'

/** More paths than a window can have tabs; the rest of a longer list is answered `null`. */
const MAX_HEADS = 256

// Not fatal: the bytes read may end inside a character, and a note with one bad byte still has a head.
const utf8 = new TextDecoder('utf-8')

/** The top of one note: `HEAD_READ_BYTES` off the start of the file at most, whatever its size. */
async function readHead(raw: string): Promise<FileHead | null> {
  const p = requireAbsPath(raw, 'path')
  // A page of the tab board shows the first lines of a NOTE (D6): a PDF, an image and view-only text have none.
  if (!isMarkdown(p)) return null
  const handle = await open(p, 'r')
  try {
    const st = await handle.stat()
    // A folder may be named `Notes.md` (YAZ-2290).
    if (!st.isFile()) return null
    const buffer = Buffer.allocUnsafe(Math.min(st.size, HEAD_READ_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const cut = st.size > bytesRead
    let head = utf8.decode(buffer.subarray(0, bytesRead))
    // The read stopped inside a character: its bytes decoded as one replacement mark, which goes.
    if (cut && head.endsWith('�')) head = head.slice(0, -1)
    const { frontmatter, body } = splitFrontmatter(head)
    // A block that is still open where the read stopped: none of its lines is body.
    const text = cut && frontmatter === '' && /^---\r?\n/.test(head) ? '' : body.slice(0, HEAD_CHARS)
    // Never half of a surrogate pair.
    const last = text.charCodeAt(text.length - 1)
    return { path: p, mtime: st.mtimeMs, text: last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text }
  } finally {
    await handle.close()
  }
}

/**
 * `window.yaseenDocs.readHeads(paths)` (YAZ-2648 D6): the top of every open tab's note in ONE
 * call, in the order asked. A path that fails — a deleted file, a folder, a file that is no note —
 * answers `null` and never fails the rest. Only the head of each file is read, so the answer
 * stays small whatever the notes weigh.
 */
export async function readHeads(paths: unknown): Promise<(FileHead | null)[]> {
  const list = requireStringArray(paths, 'paths')
  return Promise.all(list.map((p, i) => (i < MAX_HEADS ? readHead(p).catch(() => null) : null)))
}
