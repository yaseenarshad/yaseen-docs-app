import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IndexRecord } from '@shared/types'
import { _resetIndexCache, _setPersistDebounceMs, flushIndexCache, initIndexCache, loadIndexCache, schedulePersist } from './cache'

const until = async (pred: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const record = (p: string, over: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.basename(p)
  return {
    path: p,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: '',
    ext: 'md',
    size: 10,
    ctime: 1000,
    mtime: 2000.5,
    properties: { status: 'idea', priority: 2, pillar: null },
    tags: ['a', 'a/b'],
    links: ['B'],
    embeds: [],
    ...over,
  }
}

const asMap = (...records: IndexRecord[]) => new Map(records.map((r) => [r.path, r]))

/** The one cache file the dir holds (persist a root first). */
const cacheFileIn = async (dir: string): Promise<string> => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  expect(files).toHaveLength(1)
  return path.join(dir, files[0])
}

describe('index cache: before initIndexCache', () => {
  it('load is a miss, schedulePersist is a no-op, flush resolves — nothing throws', async () => {
    _resetIndexCache()
    await expect(loadIndexCache('/vault')).resolves.toEqual({ records: null, status: 'miss' })
    schedulePersist('/vault', asMap(record('/vault/a.md')))
    await expect(flushIndexCache()).resolves.toBeUndefined()
  })
})

describe('index cache: write / load round trip', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-'))
    initIndexCache(path.join(dir, 'index-cache')) // exercises the lazy mkdir -p
  })
  afterEach(async () => {
    await flushIndexCache()
    _setPersistDebounceMs()
  })
  afterAll(async () => {
    _resetIndexCache()
    await rm(dir, { recursive: true, force: true })
  })

  it('a flushed persist round-trips the records; missing file for another root is a miss', async () => {
    const a = record('/vault/a.md')
    const b = record('/vault/sub/b.md', { folder: 'sub', mtime: 3000 })
    schedulePersist('/vault', asMap(a, b))
    await flushIndexCache()
    const load = await loadIndexCache('/vault')
    expect(load.status).toBe('hit')
    expect([...load.records!.entries()]).toEqual([...asMap(a, b).entries()])
    expect(await loadIndexCache('/other-vault')).toEqual({ records: null, status: 'miss' })
  })

  it('writes are atomic: after a flush the dir holds valid JSON and no tmp leftovers', async () => {
    schedulePersist('/vault', asMap(record('/vault/a.md')))
    await flushIndexCache()
    const cacheDir = path.join(dir, 'index-cache')
    expect((await readdir(cacheDir)).some((f) => f.includes('.tmp-'))).toBe(false)
    const parsed: unknown = JSON.parse(await readFile(await cacheFileIn(cacheDir), 'utf8'))
    expect(parsed).toMatchObject({ version: 1, root: '/vault' })
  })

  it('debounce coalesces bursts per root: one trailing write with the latest records', async () => {
    _setPersistDebounceMs(60)
    const cacheDir = path.join(dir, 'index-cache')
    const stale = record('/burst/a.md', { size: 1 })
    const fresh = record('/burst/a.md', { size: 99 })
    schedulePersist('/burst', asMap(stale))
    await new Promise((r) => setTimeout(r, 30))
    schedulePersist('/burst', asMap(fresh)) // resets the 60 ms timer
    await new Promise((r) => setTimeout(r, 40)) // 70 ms after the first call: the reset timer has not fired
    expect((await loadIndexCache('/burst')).status).toBe('miss')
    await until(async () => (await loadIndexCache('/burst')).status === 'hit')
    expect((await loadIndexCache('/burst')).records!.get('/burst/a.md')?.size).toBe(99)
  })

  it('flushIndexCache writes pending roots at once (no debounce wait)', async () => {
    _setPersistDebounceMs(60_000)
    schedulePersist('/flush-me', asMap(record('/flush-me/a.md')))
    expect((await loadIndexCache('/flush-me')).status).toBe('miss')
    await flushIndexCache()
    expect((await loadIndexCache('/flush-me')).status).toBe('hit')
  })

  it('records with non-finite property values (YAML .inf/.nan) are excluded from the write', async () => {
    const ok = record('/nf/ok.md')
    const inf = record('/nf/inf.md', { properties: { n: Infinity } })
    const nested = record('/nf/nested.md', { properties: { list: [{ deep: NaN }] } })
    schedulePersist('/nf', asMap(ok, inf, nested))
    await flushIndexCache()
    const load = await loadIndexCache('/nf')
    expect(load.status).toBe('hit')
    expect([...load.records!.keys()]).toEqual(['/nf/ok.md'])
  })
})

describe('index cache: a bad file never throws, only degrades', () => {
  let dir: string
  let file: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-bad-'))
    initIndexCache(dir)
    schedulePersist('/vault', asMap(record('/vault/a.md')))
    await flushIndexCache()
    file = await cacheFileIn(dir)
  })
  afterAll(async () => {
    _resetIndexCache()
    await rm(dir, { recursive: true, force: true })
  })

  it('unparsable JSON → corrupt', async () => {
    await writeFile(file, 'not json {{{')
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
  })

  it('non-object payloads → corrupt', async () => {
    for (const body of ['[]', '"str"', 'null', '{"version":1,"root":"/vault","records":{}}']) {
      await writeFile(file, body)
      expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
    }
  })

  it('a malformed record element poisons the whole file → corrupt', async () => {
    await writeFile(file, JSON.stringify({ version: 1, root: '/vault', records: [record('/vault/a.md'), { path: 5 }] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
    await writeFile(file, JSON.stringify({ version: 1, root: '/vault', records: [{ ...record('/vault/a.md'), tags: 'oops' }] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
  })

  it('another version → version-mismatch', async () => {
    await writeFile(file, JSON.stringify({ version: 2, root: '/vault', records: [] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'version-mismatch' })
  })

  it("another root's payload at this filename → miss (not this vault's cache)", async () => {
    await writeFile(file, JSON.stringify({ version: 1, root: '/elsewhere', records: [] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'miss' })
  })
})
