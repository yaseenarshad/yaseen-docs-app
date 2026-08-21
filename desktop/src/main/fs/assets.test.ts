import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES } from '@shared/types'
import { readAsset } from './assets'
import { makeBasesFixture } from './basesFixture'
import { failure } from './testFixture'

/**
 * `readAsset(root, ref)` (4E, GRO-2139 amended by Desktop D10): resolves a wikilink target or
 * path to a local image under `root` — root-relative when the ref has a `/`, else Obsidian's
 * shortest-path rule (case-insensitive basename, first match in a breadth-first walk with each
 * directory's entries sorted, dot-dirs and node_modules skipped) — and answers base64 + mime.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => {
  ;({ root, cleanup } = await makeBasesFixture())
  // Extra assets for the resolution-order cases; the shared fixture itself stays untouched.
  await Promise.all([mkdir(path.join(root, 'aa', 'deeper'), { recursive: true }), mkdir(path.join(root, 'bb'), { recursive: true })])
  await Promise.all([
    writeFile(path.join(root, 'aa', 'dup.png'), PNG),
    writeFile(path.join(root, 'bb', 'dup.png'), PNG),
    writeFile(path.join(root, 'aa', 'deeper', 'shallow.png'), PNG),
    writeFile(path.join(root, 'bb', 'shallow.png'), PNG),
    writeFile(path.join(root, 'bb', 'photo.jpg'), PNG),
    writeFile(path.join(root, '.obsidian', 'hidden.webp'), PNG),
    writeFile(path.join(root, 'big.png'), Buffer.alloc(MAX_FILE_BYTES + 1)),
  ])
})
afterAll(() => cleanup())

describe('readAsset resolution', () => {
  it('a ref with a slash resolves root-relative first', async () => {
    const res = await readAsset(root, 'Content Pillars/levels.png')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect(res.mime).toBe('image/png')
    expect(res.size).toBe(PNG.length)
    expect(Buffer.from(res.data, 'base64')).toEqual(PNG)
  })

  it('a bare basename resolves by the shortest-path rule anywhere under root', async () => {
    const res = await readAsset(root, 'levels.png')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
  })

  it('a ref with a slash that misses root-relative falls back to the basename walk', async () => {
    const res = await readAsset(root, 'no-such-dir/levels.png')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
  })

  it('strips |alias and #heading from the ref like the index link extraction', async () => {
    expect((await readAsset(root, 'levels.png|Alt text')).path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect((await readAsset(root, 'levels.png#section')).path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
  })

  it('matches the basename case-insensitively', async () => {
    const res = await readAsset(root, 'LEVELS.PNG')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect(res.mime).toBe('image/png')
  })

  it('several basename matches: the first in the deterministic sorted walk wins', async () => {
    expect((await readAsset(root, 'dup.png')).path).toBe(path.join(root, 'aa', 'dup.png'))
  })

  it('a shallower match beats a deeper one whatever the directory names (breadth-first)', async () => {
    expect((await readAsset(root, 'shallow.png')).path).toBe(path.join(root, 'bb', 'shallow.png'))
  })

  it('never looks inside dot-directories', async () => {
    expect((await failure(readAsset(root, 'hidden.webp'))).code).toBe('NOT_FOUND')
  })

  it('mime comes from the extension', async () => {
    expect((await readAsset(root, 'photo.jpg')).mime).toBe('image/jpeg')
  })
})

describe('readAsset failures', () => {
  it('NOT_FOUND when no file under root has the basename', async () => {
    expect((await failure(readAsset(root, 'missing.png'))).code).toBe('NOT_FOUND')
  })

  it('UNSUPPORTED_EXTENSION for non-image refs, even existing files', async () => {
    expect((await failure(readAsset(root, 'Content Pillars/List of Topics.md'))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(readAsset(root, 'levels'))).code).toBe('UNSUPPORTED_EXTENSION')
  })

  it('TOO_LARGE above MAX_FILE_BYTES', async () => {
    expect((await failure(readAsset(root, 'big.png'))).code).toBe('TOO_LARGE')
  })

  it('BAD_REQUEST on an empty ref, NOT_ABSOLUTE on a relative root, NOT_FOUND on a missing root', async () => {
    expect((await failure(readAsset(root, ''))).code).toBe('BAD_REQUEST')
    expect((await failure(readAsset(root, '  |alias'))).code).toBe('BAD_REQUEST')
    expect((await failure(readAsset('vault', 'levels.png'))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(readAsset(path.join(root, 'gone'), 'levels.png'))).code).toBe('NOT_FOUND')
  })
})
