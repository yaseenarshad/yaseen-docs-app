import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readdir, readFile, utimes } from 'node:fs/promises'
import path from 'node:path'
import type { FileResponse, FileWriteConflict, FileWriteResponse } from '@shared/types'
import { app } from '../app'
import { makeFixture } from '../test-fixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const get = (p: string) => app.request(`/api/file?path=${encodeURIComponent(p)}`)
const put = (body: unknown) =>
  app.request('/api/file', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code

describe('GET /api/file', () => {
  it('returns content, mtime, size', async () => {
    const res = await get(path.join(root, 'A.md'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as FileResponse
    expect(body).toMatchObject({ path: path.join(root, 'A.md'), content: '# A\n', size: 4 })
    expect(body.mtime).toBeGreaterThan(0)
  })

  it('404 missing, 400 relative, 400 NOT_MARKDOWN, 400 NOT_A_FILE', async () => {
    expect((await get(path.join(root, 'missing.md'))).status).toBe(404)
    expect((await get('rel.md')).status).toBe(400)
    const txt = await get(path.join(root, 'notes.txt'))
    expect(txt.status).toBe(400)
    expect(await code(txt)).toBe('NOT_MARKDOWN')
    expect(await code(await get(path.join(root, 'alpha')))).toBe('NOT_MARKDOWN')
    await mkdir(path.join(root, 'folder.md'))
    const dir = await get(path.join(root, 'folder.md'))
    expect(dir.status).toBe(400)
    expect(await code(dir)).toBe('NOT_A_FILE')
  })
})

describe('PUT /api/file', () => {
  it('write then read is byte-identical (unicode/emoji/frontmatter) and leaves no tmp files', async () => {
    const file = path.join(root, 'alpha', 'new.md')
    const content = '---\ntitle: Ünïcödé 🚀\n---\n\n# Hello 🌍\n\n- [ ] task ✅\n\n```ts\nconst x = "é"\n```\n'
    const res = await put({ path: file, content })
    expect(res.status).toBe(200)
    const w = (await res.json()) as FileWriteResponse
    expect(w.path).toBe(file)
    expect(w.size).toBe(Buffer.byteLength(content))
    const r = (await (await get(file)).json()) as FileResponse
    expect(r.content).toBe(content)
    expect(r.mtime).toBe(w.mtime)
    expect(await readFile(file, 'utf8')).toBe(content)
    expect((await readdir(path.join(root, 'alpha'))).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('400 when content is not a string / body invalid / path relative / not markdown', async () => {
    expect((await put({ path: path.join(root, 'x.md'), content: 42 })).status).toBe(400)
    expect((await put({ path: path.join(root, 'x.md') })).status).toBe(400)
    expect((await put({ path: 'rel.md', content: '' })).status).toBe(400)
    expect(await code(await put({ path: path.join(root, 'x.txt'), content: '' }))).toBe('NOT_MARKDOWN')
    const bad = await app.request('/api/file', { method: 'PUT', body: '{not json' })
    expect(bad.status).toBe(400)
  })

  it('404 when parent dir does not exist', async () => {
    expect((await put({ path: path.join(root, 'nope', 'x.md'), content: '' })).status).toBe(404)
  })

  it('409 CONFLICT when expectedMtime differs, nothing written; succeeds when it matches', async () => {
    const file = path.join(root, 'b.md')
    const before = (await (await get(file)).json()) as FileResponse
    await utimes(file, new Date(), new Date(before.mtime + 5000))
    const res = await put({ path: file, content: 'clobber', expectedMtime: before.mtime })
    expect(res.status).toBe(409)
    const body = (await res.json()) as FileWriteConflict
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.mtime).not.toBe(before.mtime)
    expect(await readFile(file, 'utf8')).toBe('# b\n')
    const ok = await put({ path: file, content: 'fresh', expectedMtime: body.error.mtime })
    expect(ok.status).toBe(200)
    expect(await readFile(file, 'utf8')).toBe('fresh')
  })
})
