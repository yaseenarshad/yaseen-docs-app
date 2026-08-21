import { Hono } from 'hono'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import type { Context } from 'hono'
import type { CreateDirResponse, CreateFileResponse } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { ApiFailure, fsCall, requireAbsPath } from '../fs-utils'

/** Absolute `path` from a JSON body, 400 on anything else. */
async function bodyPath(c: Context): Promise<string> {
  const raw: unknown = await c.req.json().catch(() => undefined)
  if (typeof raw !== 'object' || raw === null) throw new ApiFailure(400, 'BAD_REQUEST', 'body must be a JSON object')
  return requireAbsPath((raw as Record<string, unknown>).path, 'path')
}

/** Minimal valid Obsidian base: one table view. What a freshly created `.base` contains. */
const BASE_SEED = 'views:\n  - type: table\n    name: Table\n'

/**
 * Creation endpoints for the sidebar's "New folder" / "New note" (GRO-2022).
 * Markdown files are created empty; `.base` files get BASE_SEED (GRO-2123).
 * Existence races resolve at the fs layer: mkdir and `wx` writes throw EEXIST,
 * which `toApiFailure` maps to 409 ALREADY_EXISTS — nothing is ever overwritten.
 */
export const createRoute = new Hono()
  .post('/api/create-dir', async (c) => {
    const p = await bodyPath(c)
    await fsCall(p, () => mkdir(p))
    const body: CreateDirResponse = { path: p }
    return c.json(body)
  })
  .post('/api/create-file', async (c) => {
    const p = await bodyPath(c)
    const kind = fileKind(p)
    if (kind === null) throw new ApiFailure(400, 'UNSUPPORTED_EXTENSION', 'only .md/.markdown/.base files can be created', p)
    const body = await fsCall(p, async (): Promise<CreateFileResponse> => {
      await writeFile(p, kind === 'base' ? BASE_SEED : '', { flag: 'wx' })
      const st = await stat(p)
      return { path: p, mtime: st.mtimeMs, size: st.size }
    })
    return c.json(body)
  })
