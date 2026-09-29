import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WatchListener, WatchOptionsWithStringEncoding } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isNetworkMount, watchTree, type TreeWatcher } from './treeWatcher'
import { settled, sleep, until } from './testFixture'

/**
 * The engine's own rules (YAZ-2192). What consumers see through it is pinned by
 * `watchConformance.ts`; this file holds what only the engine knows about: depth, a folder that is
 * not there yet, the watched folder itself going and coming back, a lingering tmp, the stream that
 * starts late (draw 5F1), the polling fallback, and reading `mount`.
 *
 * `fail`: every `fs.watch` throws; `refuse`: only a watch of that one path does (EACCES).
 * `lateStream`: FSEvents as libuv serves it on macOS — opening a watch leaves the process's one
 * stream, and so every watch, deaf until it is rebuilt `LATE_STREAM_MS` later.
 */
const nativeWatch = vi.hoisted(() => ({ fail: false, refuse: null as string | null, lateStream: false, deafUntil: 0 }))
const LATE_STREAM_MS = 300
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const watch = ((p: string, opts?: WatchOptionsWithStringEncoding | WatchListener<string>, listener?: WatchListener<string>) => {
    if (nativeWatch.fail) throw Object.assign(new Error('not here'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' })
    if (p === nativeWatch.refuse) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    if (!nativeWatch.lateStream) return fs.watch(p, opts as WatchOptionsWithStringEncoding, listener)
    nativeWatch.deafUntil = Date.now() + LATE_STREAM_MS
    const w = fs.watch(p, typeof opts === 'function' ? {} : opts)
    const emit = w.emit.bind(w)
    w.emit = (event: string, ...args: unknown[]) => (event === 'change' && Date.now() < nativeWatch.deafUntil ? false : emit(event, ...args))
    const heard = typeof opts === 'function' ? opts : listener
    if (heard !== undefined) w.on('change', heard)
    return w
  }) as typeof fs.watch
  return { ...fs, default: { ...fs, watch }, watch }
})

const dirs: string[] = []
const watchers: TreeWatcher[] = []
afterEach(async () => {
  nativeWatch.fail = false
  nativeWatch.refuse = null
  nativeWatch.lateStream = false
  await Promise.all(watchers.splice(0).map((w) => w.close()))
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'mdapp-engine-'))
  dirs.push(d)
  return d
}

/** Starts a watch on `dir` and records `type rel` lines; `ready` resolves once it is live. */
function record(dir: string, opts: Parameters<typeof watchTree>[1] = {}) {
  const lines: string[] = []
  let ready = false
  const w = watchTree(dir, opts)
  watchers.push(w)
  const note = (type: string) => (p: string) => lines.push(`${type} ${path.relative(dir, p)}`)
  w.on('add', note('add')).on('change', note('change')).on('unlink', note('unlink')).on('addDir', note('addDir')).on('unlinkDir', note('unlinkDir'))
  w.on('ready', () => (ready = true))
  const quiet = () => settled(() => lines.length, 500).then(() => [...lines].sort())
  return { lines, ready: () => until(() => ready, 10_000), quiet, watcher: w }
}

describe('treeWatcher (YAZ-2192)', { timeout: 20_000 }, () => {
  it("depth 0 announces the folder's own entries and nothing deeper", async () => {
    const dir = await tempDir()
    await mkdir(path.join(dir, 'sub'))
    const r = record(dir, { depth: 0 })
    await r.ready()
    await writeFile(path.join(dir, 'top.json'), '{}')
    await writeFile(path.join(dir, 'sub', 'deep.json'), '{}')
    await mkdir(path.join(dir, 'new'))
    expect(await r.quiet()).toEqual(['add top.json', 'addDir new'])
  })

  it('a folder several levels from existing is waited for, and what it holds arrives when it does', async () => {
    const parent = await tempDir()
    const dir = path.join(parent, 'a', 'b', '.yaseendocs')
    const r = record(dir)
    await r.ready()
    await mkdir(path.join(parent, 'a'))
    await sleep(200)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'github.json'), '{}')
    expect(await r.quiet()).toEqual(['add github.json'])
  })

  it('the watched folder itself going takes everything with it; coming back brings its contents', async () => {
    const parent = await tempDir()
    const dir = path.join(parent, 'vault')
    await mkdir(path.join(dir, 'sub'), { recursive: true })
    await writeFile(path.join(dir, 'sub', 'x.md'), 'x')
    await sleep(300)
    const r = record(dir)
    await r.ready()
    await rename(dir, path.join(parent, 'elsewhere'))
    expect(await r.quiet()).toEqual(['unlink sub/x.md', 'unlinkDir sub'])
    r.lines.length = 0
    await mkdir(dir)
    await writeFile(path.join(dir, 'back.md'), 'b')
    expect(await r.quiet()).toEqual(['add back.md'])
  })

  it('an atomicWrite tmp is silent even while it lingers past the settle window', async () => {
    const dir = await tempDir()
    const r = record(dir)
    await r.ready()
    const tmp = path.join(dir, 'big.md.tmp-0123456789ab')
    await writeFile(tmp, 'a large save, still being written')
    await sleep(400)
    await rename(tmp, path.join(dir, 'big.md'))
    expect(await r.quiet()).toEqual(['add big.md'])
  })

  it.runIf(process.platform === 'darwin')('`ready` comes once the stream hears: the first write after it is never missed (draw 5F1)', async () => {
    nativeWatch.lateStream = true
    const dir = await tempDir()
    const r = record(dir)
    await r.ready()
    await writeFile(path.join(dir, 'first.md'), 'x')
    expect(await r.quiet()).toEqual(['add first.md'])
  })

  it.runIf(process.platform === 'darwin')('an awaited folder that appears before the stream hears is still found, and watched (draw 5F1)', async () => {
    nativeWatch.lateStream = true
    const dir = path.join(await tempDir(), '.yaseendocs')
    const r = record(dir)
    await sleep(100) // the parent is watched by now, and the stream still deaf
    await mkdir(dir)
    await writeFile(path.join(dir, 'favorites.json'), '[]')
    await r.ready()
    await until(() => r.lines.length > 0)
    expect(await r.quiet()).toEqual(['add favorites.json'])
  })

  it.runIf(process.platform === 'darwin')('what lands after the subscribe but before the stream hears is announced, not taken as initial (the index create race, YAZ-986)', async () => {
    const dir = await tempDir()
    await writeFile(path.join(dir, 'kept.md'), 'v1')
    await writeFile(path.join(dir, 'doomed.md'), 'x')
    await sleep(300)
    nativeWatch.lateStream = true
    const r = record(dir)
    await sleep(60) // subscribed; the stream still deaf
    await writeFile(path.join(dir, 'created.md'), 'new')
    await writeFile(path.join(dir, 'kept.md'), 'v2, longer')
    await rm(path.join(dir, 'doomed.md'))
    await r.ready()
    expect(await r.quiet()).toEqual(['add created.md', 'change kept.md', 'unlink doomed.md'])
  })

  it('close() ends every event, pending ones included', async () => {
    const dir = await tempDir()
    const r = record(dir)
    await r.ready()
    await writeFile(path.join(dir, 'late.md'), 'x')
    await r.watcher.close()
    await sleep(400)
    expect(r.lines).toEqual([])
  })

  it('a folder that arrives but cannot be watched (EACCES) falls back to polling: what it holds still arrives, nothing throws', async () => {
    const parent = await tempDir()
    const dir = path.join(parent, '.yaseendocs')
    nativeWatch.refuse = dir
    const r = record(dir)
    await r.ready()
    await mkdir(dir)
    await writeFile(path.join(dir, 'github.json'), '{}')
    await until(() => r.lines.length > 0, 10_000)
    expect(await r.quiet()).toEqual(['add github.json'])
    await writeFile(path.join(dir, 'later.json'), '{}')
    await until(() => r.lines.length > 1, 10_000)
    expect(r.lines).toEqual(['add github.json', 'add later.json'])
  })

  it('falls back to chokidar polling when fs.watch cannot serve, and still announces', async () => {
    nativeWatch.fail = true
    const dir = await tempDir()
    const r = record(dir)
    await r.ready()
    await writeFile(path.join(dir, 'polled.md'), 'x')
    await until(() => r.lines.length > 0, 10_000)
    expect(r.lines).toEqual(['add polled.md'])
  })
})

describe('isNetworkMount (macOS `mount`)', () => {
  const TABLE = [
    '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
    '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect)',
    '//yasin@nas._smb._tcp.local/Notes on /Volumes/Notes (smbfs, nodev, nosuid, mounted by yasin)',
    'nas:/export/vaults on /Volumes/NFS Vaults (nfs, nodev, nosuid, mounted by yasin)',
    '/dev/disk5s1 on /Volumes/USB Stick (exfat, local, nodev, nosuid, noowners, mounted by yasin)',
  ].join('\n')

  it('a share (SMB, NFS) is network; the system volume and a USB stick are local; the longest mount point decides', () => {
    expect(isNetworkMount(TABLE, '/Volumes/Notes/Team vault')).toBe(true)
    expect(isNetworkMount(TABLE, '/Volumes/NFS Vaults/mine')).toBe(true)
    expect(isNetworkMount(TABLE, '/Volumes/USB Stick/vault')).toBe(false)
    expect(isNetworkMount(TABLE, '/System/Volumes/Data/Users/yasin/vault')).toBe(false)
    expect(isNetworkMount(TABLE, '/Volumes/NotesNot/vault')).toBe(false)
  })

  it('an unreadable table is local: the native watcher is the default', () => {
    expect(isNetworkMount('', '/Volumes/Notes')).toBe(false)
  })
})
