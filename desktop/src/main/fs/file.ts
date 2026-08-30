import { readFile as fsReadFile, stat } from 'node:fs/promises'
import type { FileResponse, FileWriteRequest, FileWriteResponse } from '@shared/types'
import { MAX_FILE_BYTES } from '@shared/types'
import { BridgeFailure, atomicWrite, fsCall, requireAbsPath, requireMarkdownFile } from './fsUtils'

/** `window.yaseenDocs.readFile(path)`: raw UTF-8 content of a vault file, frontmatter included. */
export async function readFile(path: string): Promise<FileResponse> {
  const p = requireAbsPath(path, 'path')
  requireMarkdownFile(p)
  return fsCall(p, async () => {
    const st = await stat(p)
    if (!st.isFile()) throw new BridgeFailure('NOT_A_FILE', 'expected a file', { path: p })
    if (st.size > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `file exceeds ${MAX_FILE_BYTES} bytes`, { path: p })
    return { path: p, content: await fsReadFile(p, 'utf8'), mtime: st.mtimeMs, size: st.size }
  })
}

/**
 * `window.yaseenDocs.writeFile(req)`. Atomic (tmp + rename),
 * parent dir must exist. With `expectedMtime`, a newer file on disk rejects `CONFLICT` carrying
 * the current mtime and nothing is written. The request crosses IPC from a sandboxed renderer,
 * so its shape is checked like a request body, not trusted from the type.
 */
export async function writeFile(req: FileWriteRequest): Promise<FileWriteResponse> {
  const raw: unknown = req
  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const { path, content, expectedMtime } = raw as Record<string, unknown>
  const p = requireAbsPath(path, 'path')
  requireMarkdownFile(p)
  if (typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string", { path: p })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') {
    throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: p })
  }
  if (expectedMtime !== undefined) {
    const st = await stat(p).catch(() => undefined)
    if (st !== undefined && st.mtimeMs !== expectedMtime) {
      throw new BridgeFailure('CONFLICT', 'file changed on disk since last read', { path: p, mtime: st.mtimeMs })
    }
  }
  const { mtime, size } = await fsCall(p, () => atomicWrite(p, content))
  return { path: p, mtime, size }
}
