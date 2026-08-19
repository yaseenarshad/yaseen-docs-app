import { Hono } from 'hono'
import { readFile, stat } from 'node:fs/promises'
import type { FileResponse, FileWriteConflict, FileWriteResponse } from '@shared/types'
import { MAX_FILE_BYTES } from '@shared/types'
import { ApiFailure, atomicWrite, fsCall, isMarkdown, requireAbsPath } from '../fs-utils'

function requireMarkdown(p: string): void {
  if (!isMarkdown(p)) throw new ApiFailure(400, 'NOT_MARKDOWN', 'only .md/.markdown files are served', p)
}

export const fileRoute = new Hono()
  .get('/api/file', async (c) => {
    const p = requireAbsPath(c.req.query('path'), 'path')
    requireMarkdown(p)
    const body = await fsCall(p, async (): Promise<FileResponse> => {
      const st = await stat(p)
      if (!st.isFile()) throw new ApiFailure(400, 'NOT_A_FILE', 'expected a file', p)
      if (st.size > MAX_FILE_BYTES) throw new ApiFailure(413, 'TOO_LARGE', `file exceeds ${MAX_FILE_BYTES} bytes`, p)
      return { path: p, content: await readFile(p, 'utf8'), mtime: st.mtimeMs, size: st.size }
    })
    return c.json(body)
  })
  .put('/api/file', async (c) => {
    const raw: unknown = await c.req.json().catch(() => undefined)
    if (typeof raw !== 'object' || raw === null) throw new ApiFailure(400, 'BAD_REQUEST', 'body must be a JSON object')
    const { path, content, expectedMtime } = raw as Record<string, unknown>
    const p = requireAbsPath(path, 'path')
    requireMarkdown(p)
    if (typeof content !== 'string') throw new ApiFailure(400, 'BAD_REQUEST', "'content' must be a string", p)
    if (expectedMtime !== undefined && typeof expectedMtime !== 'number') {
      throw new ApiFailure(400, 'BAD_REQUEST', "'expectedMtime' must be a number", p)
    }
    if (expectedMtime !== undefined) {
      const st = await stat(p).catch(() => undefined)
      if (st !== undefined && st.mtimeMs !== expectedMtime) {
        const conflict: FileWriteConflict = {
          error: { code: 'CONFLICT', message: 'file changed on disk since last read', path: p, mtime: st.mtimeMs },
        }
        return c.json(conflict, 409)
      }
    }
    const { mtime, size } = await fsCall(p, () => atomicWrite(p, content))
    const body: FileWriteResponse = { path: p, mtime, size }
    return c.json(body)
  })
