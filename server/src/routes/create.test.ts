import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { ApiError, CreateDirResponse, CreateFileResponse } from '@shared/types'
import { app } from '../app'
import { makeFixture } from '../test-fixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const post = (url: string, body: unknown) =>
  app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('POST /api/create-dir', () => {
  it('creates a directory and returns its path', async () => {
    const p = path.join(root, 'NewFolder')
    const res = await post('/api/create-dir', { path: p })
    expect(res.status).toBe(200)
    expect((await res.json()) as CreateDirResponse).toEqual({ path: p })
    expect((await stat(p)).isDirectory()).toBe(true)
  })

  it('409 ALREADY_EXISTS when the path exists (dir or file)', async () => {
    const res = await post('/api/create-dir', { path: path.join(root, 'alpha') })
    expect(res.status).toBe(409)
    expect(((await res.json()) as ApiError).error.code).toBe('ALREADY_EXISTS')
    expect((await post('/api/create-dir', { path: path.join(root, 'b.md') })).status).toBe(409)
  })

  it('404 when the parent does not exist, 400 on bad input', async () => {
    expect((await post('/api/create-dir', { path: path.join(root, 'nope', 'child') })).status).toBe(404)
    expect((await post('/api/create-dir', { path: 'relative/dir' })).status).toBe(400)
    expect((await post('/api/create-dir', {})).status).toBe(400)
    expect((await app.request('/api/create-dir', { method: 'POST', body: 'not json' })).status).toBe(400)
  })
})

describe('POST /api/create-file', () => {
  it('creates an empty markdown file and returns path, mtime, size', async () => {
    const p = path.join(root, 'NewFolder', 'note.md')
    const res = await post('/api/create-file', { path: p })
    expect(res.status).toBe(200)
    const body = (await res.json()) as CreateFileResponse
    expect(body.path).toBe(p)
    expect(body.size).toBe(0)
    expect(body.mtime).toBeGreaterThan(0)
    expect((await stat(p)).isFile()).toBe(true)
  })

  it('400 NOT_MARKDOWN for other extensions', async () => {
    const res = await post('/api/create-file', { path: path.join(root, 'note.txt') })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error.code).toBe('NOT_MARKDOWN')
  })

  it('409 ALREADY_EXISTS and never overwrites', async () => {
    const existing = path.join(root, 'A.md')
    const before = (await stat(existing)).size
    const res = await post('/api/create-file', { path: existing })
    expect(res.status).toBe(409)
    expect(((await res.json()) as ApiError).error.code).toBe('ALREADY_EXISTS')
    expect((await stat(existing)).size).toBe(before)
  })

  it('404 when the parent does not exist, 400 on bad input', async () => {
    expect((await post('/api/create-file', { path: path.join(root, 'nope', 'x.md') })).status).toBe(404)
    expect((await post('/api/create-file', { path: 'rel.md' })).status).toBe(400)
    expect((await post('/api/create-file', {})).status).toBe(400)
  })
})
