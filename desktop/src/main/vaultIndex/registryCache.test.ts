import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeBasesFixture } from '../fs/basesFixture'
import { _resetIndexCache, flushIndexCache, initIndexCache, loadIndexCache } from './cache'
import { _evictAll, getColdStartDiff, getIndex } from './registry'
import { scanFile } from './scan'

// Passthrough spy: behaviour identical, calls countable — proves the warm start reads no files.
vi.mock('./scan', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./scan')>()
  return { ...mod, scanFile: vi.fn(mod.scanFile) }
})

const until = async (pred: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('getIndex + persistent cache (GRO-2228/2229)', () => {
  let root: string
  let cleanup: () => Promise<void>
  let cacheDir: string
  beforeAll(async () => {
    ;({ root, cleanup } = await makeBasesFixture())
    cacheDir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-int-'))
    initIndexCache(cacheDir)
  })
  afterAll(async () => {
    _evictAll()
    await flushIndexCache()
    _resetIndexCache()
    await cleanup()
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('cold build with no cache: full scan, coldDiff is an honest miss, and the build schedules a persist', async () => {
    const res = await getIndex(root)
    expect(res.records).toHaveLength(8)
    expect(getColdStartDiff(root)).toEqual({
      root,
      scannedAt: getColdStartDiff(root)!.scannedAt,
      cacheStatus: 'miss',
      added: [],
      removed: [],
      changed: [],
    })
    await flushIndexCache() // the build-success schedulePersist is what made this root pending
    const load = await loadIndexCache(root)
    expect(load.status).toBe('hit')
    expect(load.records!.size).toBe(8)
  })

  it('warm build reuses the cached records without a single scanFile call; coldDiff is an empty hit', async () => {
    const cold = await getIndex(root)
    _evictAll()
    vi.mocked(scanFile).mockClear()
    const warm = await getIndex(root)
    expect(scanFile).not.toHaveBeenCalled()
    expect(warm.records).toEqual(cold.records)
    expect(getColdStartDiff(root)).toMatchObject({ cacheStatus: 'hit', added: [], removed: [], changed: [] })
  })

  it('changes made while evicted show up in the records AND the coldDiff; only they are re-scanned', async () => {
    await getIndex(root)
    _evictAll()
    await flushIndexCache()
    const changedFile = path.join(root, 'VSL-v1.md')
    const addedFile = path.join(root, 'While Evicted.md')
    await writeFile(changedFile, '---\nstatus: reworked\n---\n\nRewritten while nothing watched.\n')
    await writeFile(addedFile, '# New\n#while-evicted\n')
    vi.mocked(scanFile).mockClear()
    const res = await getIndex(root)
    expect(res.records).toHaveLength(9)
    expect(res.records.find((r) => r.path === changedFile)?.properties).toEqual({ status: 'reworked' })
    expect(res.records.find((r) => r.path === addedFile)?.tags).toEqual(['while-evicted'])
    expect(vi.mocked(scanFile).mock.calls.map((c) => c[1]).sort()).toEqual([changedFile, addedFile].sort())
    const diff = getColdStartDiff(root)!
    expect(diff.cacheStatus).toBe('hit')
    expect(diff.changed).toEqual([changedFile])
    expect(diff.added.map((a) => a.path)).toEqual([addedFile])
    expect(diff.removed).toEqual([])
  })

  it('a file deleted while evicted lands in coldDiff.removed with its CACHED stats', async () => {
    await getIndex(root)
    _evictAll()
    await flushIndexCache()
    const victim = path.join(root, 'While Evicted.md')
    const cachedVictim = (await loadIndexCache(root)).records!.get(victim)!
    await rm(victim)
    await getIndex(root)
    expect(getColdStartDiff(root)!.removed).toEqual([{ path: victim, size: cachedVictim.size, mtime: cachedVictim.mtime }])
    expect((await getIndex(root)).records).toHaveLength(8)
  })

  it('watcher mutations schedule persists: after a flush the cache file reflects them', async () => {
    await getIndex(root)
    const live = path.join(root, 'Live Note.md')
    await writeFile(live, '# Live\n')
    await until(async () => (await getIndex(root)).records.some((r) => r.path === live))
    await flushIndexCache()
    expect((await loadIndexCache(root)).records!.has(live)).toBe(true)
    await rm(live)
    await until(async () => !(await getIndex(root)).records.some((r) => r.path === live))
    await flushIndexCache()
    expect((await loadIndexCache(root)).records!.has(live)).toBe(false)
  })

  it('evict drops the coldDiff and schedules one last persist', async () => {
    await getIndex(root)
    expect(getColdStartDiff(root)).toBeDefined()
    _evictAll()
    expect(getColdStartDiff(root)).toBeUndefined()
    await flushIndexCache()
    expect((await loadIndexCache(root)).status).toBe('hit')
  })
})
