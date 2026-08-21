import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createDir, createFile } from './create'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code

describe('createDir', () => {
  it('creates a directory and returns its path', async () => {
    const p = path.join(root, 'NewFolder')
    expect(await createDir(p)).toEqual({ path: p })
    expect((await stat(p)).isDirectory()).toBe(true)
  })

  it('ALREADY_EXISTS when the path exists (dir or file)', async () => {
    expect(await code(createDir(path.join(root, 'alpha')))).toBe('ALREADY_EXISTS')
    expect(await code(createDir(path.join(root, 'b.md')))).toBe('ALREADY_EXISTS')
  })

  it('NOT_FOUND when the parent does not exist, BAD_REQUEST / NOT_ABSOLUTE on bad input', async () => {
    expect(await code(createDir(path.join(root, 'nope', 'child')))).toBe('NOT_FOUND')
    expect(await code(createDir('relative/dir'))).toBe('NOT_ABSOLUTE')
    expect(await code(createDir(undefined as never))).toBe('BAD_REQUEST')
    expect(await code(createDir(42 as never))).toBe('NOT_ABSOLUTE')
  })
})

describe('createFile', () => {
  it('creates an empty markdown file and returns path, mtime, size', async () => {
    const p = path.join(root, 'NewFolder', 'note.md')
    const body = await createFile(p)
    expect(body.path).toBe(p)
    expect(body.size).toBe(0)
    expect(body.mtime).toBeGreaterThan(0)
    expect((await stat(p)).isFile()).toBe(true)
  })

  it('creates a .base file seeded with the minimal valid base', async () => {
    const p = path.join(root, 'NewFolder', 'Topics.base')
    const seed = 'views:\n  - type: table\n    name: Table\n'
    const body = await createFile(p)
    expect(body.path).toBe(p)
    expect(body.size).toBe(Buffer.byteLength(seed))
    expect(await readFile(p, 'utf8')).toBe(seed)
  })

  it('UNSUPPORTED_EXTENSION for other extensions', async () => {
    expect(await code(createFile(path.join(root, 'note.txt')))).toBe('UNSUPPORTED_EXTENSION')
  })

  it('ALREADY_EXISTS and never overwrites', async () => {
    const existing = path.join(root, 'A.md')
    const before = (await stat(existing)).size
    expect(await code(createFile(existing))).toBe('ALREADY_EXISTS')
    expect((await stat(existing)).size).toBe(before)
  })

  it('NOT_FOUND when the parent does not exist, BAD_REQUEST / NOT_ABSOLUTE on bad input', async () => {
    expect(await code(createFile(path.join(root, 'nope', 'x.md')))).toBe('NOT_FOUND')
    expect(await code(createFile('rel.md'))).toBe('NOT_ABSOLUTE')
    expect(await code(createFile(undefined as never))).toBe('BAD_REQUEST')
  })
})
