import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import path from 'node:path'
import type { DirsResponse } from '@shared/types'
import { app } from '../index'
import { makeFixture } from '../fixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const get = (p?: string) => app.request(p === undefined ? '/api/dirs' : `/api/dirs?path=${encodeURIComponent(p)}`)

describe('GET /api/dirs', () => {
  it('lists subdirs sorted case-insensitively, excluding dotdirs and node_modules', async () => {
    const res = await get(root)
    expect(res.status).toBe(200)
    const body = (await res.json()) as DirsResponse
    expect(body.path).toBe(root)
    expect(body.parent).toBe(path.dirname(root))
    expect(body.dirs.map((d) => d.name)).toEqual(['alpha', 'assets-only', 'Empty', 'Zeta'])
    expect(body.dirs[0]).toEqual({ name: 'alpha', path: path.join(root, 'alpha') })
  })

  it('defaults to $HOME and returns parent null at /', async () => {
    const home = (await (await get()).json()) as DirsResponse
    expect(home.path).toBe(homedir())
    const top = (await (await get('/')).json()) as DirsResponse
    expect(top.path).toBe('/')
    expect(top.parent).toBeNull()
  })

  it('400 on relative path, 404 on missing, 400 on a file', async () => {
    expect((await get('relative/dir')).status).toBe(400)
    expect(((await (await get('relative/dir')).json()) as { error: { code: string } }).error.code).toBe('NOT_ABSOLUTE')
    expect((await get(path.join(root, 'nope'))).status).toBe(404)
    const file = await get(path.join(root, 'b.md'))
    expect(file.status).toBe(400)
    expect(((await file.json()) as { error: { code: string } }).error.code).toBe('NOT_A_DIRECTORY')
  })
})
