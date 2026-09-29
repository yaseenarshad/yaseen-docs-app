import { execFile } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { existsSync, watch as fsWatch, type FSWatcher, type Stats } from 'node:fs'
import { lstat, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isAtomicTmp } from '@shared/fileKind'
import type { FSWatcher as PollingWatcher } from 'chokidar'

/**
 * THE WATCHER ENGINE (YAZ-2192, YAZ-2131 🔒 D3), adapted from the draw app's `treeWatcher.ts`
 * (draw `df99b35`): one recursive `fs.watch` per watched folder — FSEvents on macOS — and a thin
 * layer that turns its raw "something happened at this path" into the events chokidar gave every
 * consumer: `add` / `change` (with stats), `unlink`, `addDir`, `unlinkDir`, `ready`, `error`.
 * chokidar 4 held one fd per file (2,080 at 2k notes) and delayed every event ≥ 200 ms; this holds
 * none and answers in about `SETTLE_MS`.
 * `watchConformance.ts` pins what consumers see, whichever engine runs underneath.
 *
 *  - CLASSIFY BY LOOKING. A path that went quiet is `lstat`ed and compared with what the engine
 *    knew: new → `add`/`addDir` (a new folder brings everything already inside it along), gone →
 *    `unlink`/`unlinkDir` (a folder takes everything known beneath it), a file whose mtime, size or
 *    inode moved → `change`. A path that came and went unseen says nothing, and `atomicWrite`'s tmp
 *    names (`isAtomicTmp`) are never announced at all.
 *  - SETTLE PER PATH. A path is looked at once it has been quiet for `SETTLE_MS`, so a burst of saves
 *    is one `change` and a file written in pieces is announced when whole — the job chokidar's
 *    `awaitWriteFinish` polling did.
 *  - READY after one walk of what is already there (nothing is announced for it: `ignoreInitial`),
 *    so `add` and `change` can be told apart from the first event on. The walk runs at once, as
 *    chokidar's initial scan did; on macOS the stream only hears a while later (`probeStream`), so
 *    once it does, the tree is walked again and whatever moved in between is announced — a note
 *    created a moment after the vault opened is an `add`, never silently "initial" (YAZ-986's
 *    create race).
 *  - A FOLDER THAT DOES NOT EXIST YET (a vault's `.yaseendocs/`) is waited for from its nearest
 *    existing ancestor, and its contents arrive as `add`s when it appears.
 *  - FALLBACK. Where `fs.watch` cannot serve — it throws, at the start or on a folder that arrives
 *    later (EACCES) — or the folder is on a network volume (FSEvents never hears another machine's
 *    writes to a share), chokidar polling runs instead with chokidar's former options, loaded only
 *    then. The watched folder itself is never announced, on either path.
 */

/** How long a path must be quiet before it is looked at (🔒 D3: 100 ms). */
const SETTLE_MS = 100
/** The polling fallback's stat interval: a network volume is slow to stat. */
const POLL_INTERVAL_MS = 1000

export interface TreeWatchOptions {
  /** Paths that never produce an event (their subtree neither). */
  ignored?: (p: string) => boolean
}

export interface TreeWatcher {
  on(event: 'add' | 'change', listener: (p: string, stats: Stats) => void): this
  on(event: 'unlink' | 'addDir' | 'unlinkDir', listener: (p: string) => void): this
  on(event: 'ready', listener: () => void): this
  on(event: 'error', listener: (err: unknown) => void): this
  /** Re-attach `p` — only the polling fallback ever loses a path (one that appears during its start). */
  add(p: string): void
  close(): Promise<void>
}

interface Known {
  dir: boolean
  mtimeMs: number
  size: number
  ino: number
}

export function watchTree(dir: string, opts: TreeWatchOptions = {}): TreeWatcher {
  return new Engine(dir, opts)
}

function nearestExisting(p: string): string {
  let at = p
  while (!existsSync(at) && path.dirname(at) !== at) at = path.dirname(at)
  return at
}

/** `k` is strictly inside folder `p`. */
const isInside = (p: string, k: string): boolean => k.startsWith(p.endsWith(path.sep) ? p : `${p}${path.sep}`)

/** How often a probe writes its file until it hears one. */
const PROBE_MS = 10

interface Probe {
  /** Resolves once the probe has heard its own write. */
  heard: Promise<void>
  close(): Promise<void>
}

/**
 * THE STREAM HEARS. On macOS `fs.watch` returns before libuv's FSEvents thread has
 * started the stream that serves it — 0–20 ms later when idle, 100 ms and more with `fseventsd`
 * busy — and a change in that gap is never reported, so a `ready` announced in it would be a lie.
 * libuv serves every FSEvents watch in the process
 * from ONE stream, rebuilt whenever a watch opens or closes, so a probe — a watch of a fresh private
 * folder, opened after the real one — can only hear from a stream that serves the real one too. It
 * writes a file there every `PROBE_MS` until it hears one.
 */
async function probeStream(): Promise<Probe> {
  const dir = await mkdtemp(path.join(tmpdir(), 'yaseendocs-probe-'))
  const probe = fsWatch(dir)
  const tick = setInterval(() => void writeFile(path.join(dir, 'probe'), '').catch(() => undefined), PROBE_MS)
  return {
    heard: once(probe, 'change').then(() => clearInterval(tick)),
    async close() {
      clearInterval(tick)
      probe.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Closes a probe; one that never opened has nothing to close. */
const closeProbe = (probe: Promise<Probe>): Promise<void> => probe.then((p) => p.close(), () => undefined)

/** Whether `dir` sits on a volume macOS does not call `local` (SMB, NFS, AFP, WebDAV): the longest mount point containing it decides. */
async function onNetworkVolume(dir: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const at = nearestExisting(dir)
  const real = await realpath(at).catch(() => at)
  return isNetworkMount(await mountTable(), real)
}

/** How long one read of `mount`'s table answers for: a launch's watches share one spawn, and a share mounted since is seen soon after. */
const MOUNT_TABLE_TTL_MS = 5000
let lastMountRead: { at: number; table: Promise<string> } | null = null

function mountTable(): Promise<string> {
  const now = Date.now()
  if (lastMountRead === null || now - lastMountRead.at > MOUNT_TABLE_TTL_MS) {
    lastMountRead = { at: now, table: new Promise((resolve) => execFile('/sbin/mount', (err, out) => resolve(err === null ? out : ''))) }
  }
  return lastMountRead.table
}

/** `mount`'s `<device> on <point> (<type>, <flags…>)` lines → whether the mount holding `real` lacks `local`. */
export function isNetworkMount(table: string, real: string): boolean {
  let best: { point: string; local: boolean } | null = null
  for (const line of table.split('\n')) {
    const m = / on (.+) \(([^)]*)\)$/.exec(line)
    if (m === null) continue
    const point = m[1]
    const inside = point === '/' || real === point || real.startsWith(`${point}/`)
    if (inside && (best === null || point.length > best.point.length)) best = { point, local: m[2].split(', ').includes('local') }
  }
  return best !== null && !best.local
}

class Engine extends EventEmitter implements TreeWatcher {
  private readonly known = new Map<string, Known>()
  /** Known paths by their case-folded spelling: a case-only rename must not look like "still there". */
  private readonly folded = new Map<string, Set<string>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Every look runs after the one before it: two looks must never both announce one new folder. */
  private chain: Promise<void> = Promise.resolve()
  private native: FSWatcher | null = null
  private polling: PollingWatcher | null = null
  /** macOS: a probe per watch this engine opened, all open until it closes — closing one would rebuild the stream, deaf again for a while. */
  private readonly probes: Promise<Probe>[] = []
  /** Resolves once the stream serving `native` hears — at once off macOS; renewed with `native`. */
  private listening: Promise<void> = Promise.resolve()
  private started = false
  private closed = false
  /** Set when polling replaces the native engine from the start: the native initial walk stops. */
  private abandoned = false

  constructor(
    private readonly dir: string,
    private readonly opts: TreeWatchOptions,
  ) {
    super()
    this.start().catch((err: unknown) => this.emit('error', err))
  }

  add(p: string): void {
    this.polling?.add(p)
  }

  async close(): Promise<void> {
    this.closed = true
    this.native?.close()
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    await Promise.all([this.chain, this.polling?.close(), ...this.probes.map(closeProbe)])
  }

  private async start(): Promise<void> {
    // What is there as of the subscribe is initial (chokidar's `ignoreInitial`): read at once,
    // while the volume is checked and the stream comes up, and again once the stream hears, so
    // nothing that lands in between goes unreported. A folder that is not there announces what it
    // holds when it arrives (`arrived`).
    const there = existsSync(this.dir)
    const initial = there ? this.walk(this.dir, false) : Promise.resolve()
    if (await onNetworkVolume(this.dir)) return this.pollInstead()
    if (this.closed) return
    try {
      if (there) this.watchDir()
      else this.awaitDir()
    } catch {
      return this.pollInstead()
    }
    await initial
    await this.listening
    if (there) await this.resync()
    this.started = true
    // What moved during the walk is looked at now, against what the walk found.
    for (const [p, timer] of [...this.timers]) {
      clearTimeout(timer)
      this.settle(p)
    }
    if (!this.closed) this.emit('ready')
  }

  /** The native engine is not used after all: its initial walk stops (a share is slow to walk), and polling takes over. */
  private pollInstead(): Promise<void> {
    this.abandoned = true
    return this.poll()
  }

  /** chokidar polling, with the options the app's watchers had before this engine (`add` keeps its re-anchoring). */
  private async poll(): Promise<void> {
    const { watch } = await import('chokidar')
    if (this.closed) return
    const w = watch(this.dir, {
      ignored: (p: string) => p !== this.dir && this.skip(p),
      ignoreInitial: true,
      alwaysStat: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      usePolling: true,
      interval: POLL_INTERVAL_MS,
      binaryInterval: POLL_INTERVAL_MS,
    })
    for (const event of ['add', 'change', 'unlink', 'error'] as const) w.on(event, (...args: unknown[]) => this.emit(event, ...args))
    // chokidar announces the watched folder itself going and coming back; the native engine never
    // does, nor did v0.9.27's watcher, which filtered it out.
    for (const event of ['addDir', 'unlinkDir'] as const) w.on(event, (p: string) => p !== this.dir && this.emit(event, p))
    // A fallback taken after the engine's own `ready` must not announce a second one.
    if (!this.started) w.on('ready', () => this.emit('ready'))
    this.polling = w
  }

  /** `w` is the watch now; a new probe must vouch for it, since one opened before it vouches for nothing. */
  private listen(w: FSWatcher): void {
    this.native = w
    if (process.platform !== 'darwin') return
    const probe = probeStream()
    this.probes.push(probe)
    // A probe that cannot run (no temp folder) is reported, and the watch goes on unvouched.
    this.listening = probe.then((p) => p.heard).catch((err: unknown) => void this.emit('error', err))
  }

  private watchDir(): void {
    const base = path.basename(this.dir)
    const w = fsWatch(this.dir, { recursive: true }, (_type, name) => {
      if (this.closed) return
      // `null` = the OS dropped the detail (an overflowed buffer): look at everything again.
      if (name === null) return this.queue(this.dir)
      const rel = name.toString()
      // FSEvents names an event on the watched folder ITSELF by its basename.
      if (rel === base) this.queue(this.dir)
      this.queue(path.join(this.dir, rel))
    })
    w.on('error', (err) => this.emit('error', err))
    this.listen(w)
  }

  /** The folder is missing: watch its nearest existing ancestor (its own entries only) and move down as the path fills in. */
  private awaitDir(): void {
    const anchor = nearestExisting(path.dirname(this.dir))
    const w = fsWatch(anchor, () => this.fillIn(w, anchor))
    w.on('error', (err) => this.emit('error', err))
    this.listen(w)
    // It may have appeared between the check and the watch, or before the stream heard.
    if (existsSync(this.dir)) return this.arrived(w)
    void this.listening.then(() => this.fillIn(w, anchor))
  }

  /** The awaited path may have filled in below `anchor`: watch the folder once it exists, else move the anchor down. */
  private fillIn(w: FSWatcher, anchor: string): void {
    if (this.closed || this.native !== w) return
    try {
      if (existsSync(this.dir)) this.arrived(w)
      else if (nearestExisting(path.dirname(this.dir)) !== anchor) {
        w.close()
        this.awaitDir()
      }
    } catch {
      // The folder cannot be watched (EACCES, say): poll instead, as `start` would have, and
      // announce what it already holds, as the native path would have.
      this.poll()
        .then(() => (this.closed ? undefined : this.walk(this.dir, true)))
        .catch((err: unknown) => void this.emit('error', err))
    }
  }

  /** The folder is here: watch it, and once that watch hears, look at what it holds — all of it new to consumers. */
  private arrived(anchor: FSWatcher): void {
    anchor.close()
    this.watchDir()
    void this.listening.then(() => this.queue(this.dir))
  }

  private skip(p: string): boolean {
    if (isAtomicTmp(path.basename(p))) return true
    return this.opts.ignored?.(p) === true
  }

  private queue(p: string): void {
    if (p !== this.dir && this.skip(p)) return
    clearTimeout(this.timers.get(p))
    this.timers.set(
      p,
      setTimeout(() => this.started && this.settle(p), SETTLE_MS),
    )
  }

  private settle(p: string): void {
    this.timers.delete(p)
    this.chain = this.chain.then(() => (this.closed ? undefined : this.look(p))).catch((err: unknown) => void this.emit('error', err))
  }

  /** What is at `p` now, against what the engine knew — and the events that make up the difference. */
  private async look(p: string): Promise<void> {
    const parent = path.dirname(p)
    // A path inside a folder nobody announced yet: the folder goes first and brings it along.
    if (p !== this.dir && parent !== this.dir && !this.known.has(parent)) return this.look(parent)
    const st = await lstat(p).catch(() => null)
    const was = this.known.get(p)
    if (p === this.dir) {
      if (st?.isDirectory() === true) return this.syncChildren(p)
      return this.forget(p)
    }
    if (st === null || !(await this.spelledSo(p, was))) {
      if (was !== undefined) this.forget(p)
      return
    }
    if (was !== undefined && was.dir !== st.isDirectory()) this.forget(p)
    if (st.isDirectory()) {
      if (this.known.get(p) === undefined) {
        this.remember(p, st)
        this.emit('addDir', p, st)
        await this.walk(p, true)
      } else await this.syncChildren(p)
      return
    }
    const prior = this.known.get(p)
    this.remember(p, st)
    if (prior === undefined) this.emit('add', p, st)
    else if (prior.mtimeMs !== st.mtimeMs || prior.size !== st.size || prior.ino !== st.ino) this.emit('change', p, st)
  }

  /** On a case-insensitive volume `lstat("note.md")` answers for `Note.md`: when another spelling is known, the listing says which is there. */
  private async spelledSo(p: string, was: Known | undefined): Promise<boolean> {
    const variants = this.folded.get(p.toLowerCase())
    if (variants === undefined || (variants.size === 1 && was !== undefined)) return true
    const names = await readdir(path.dirname(p)).catch(() => [] as string[])
    for (const other of [...variants]) if (other !== p && !names.includes(path.basename(other))) this.forget(other)
    return names.includes(path.basename(p))
  }

  /** A known folder's direct entries against the disk: new ones are looked at, vanished ones forgotten. */
  private async syncChildren(d: string): Promise<void> {
    const names = new Set(await readdir(d).catch(() => [] as string[]))
    for (const p of [...this.known.keys()]) if (path.dirname(p) === d && !names.has(path.basename(p))) this.forget(p)
    for (const name of names) {
      const p = path.join(d, name)
      if (!this.known.has(p) && !this.skip(p)) await this.look(p)
    }
  }

  /** The whole tree against what the engine knew: the difference is announced, as if every path had been queued. */
  private async resync(): Promise<void> {
    const unseen = new Set(this.known.keys())
    const visit = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name)
        if (this.skip(p)) continue
        unseen.delete(p)
        if (this.known.get(p)?.dir === true && e.isDirectory()) await visit(p)
        else await this.look(p)
      }
    }
    await visit(this.dir)
    for (const p of unseen) if (this.known.has(p)) this.forget(p)
  }

  /** Everything under `d`, remembered; announced as `add`/`addDir` when `announce`. */
  private async walk(d: string, announce: boolean): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (this.abandoned) return
      const p = path.join(d, e.name)
      if (this.skip(p) || this.known.has(p)) continue
      const st = await lstat(p).catch(() => null)
      if (st === null) continue
      this.remember(p, st)
      if (announce) this.emit(st.isDirectory() ? 'addDir' : 'add', p, st)
      if (st.isDirectory()) await this.walk(p, announce)
    }
  }

  private remember(p: string, st: Stats): void {
    this.known.set(p, { dir: st.isDirectory(), mtimeMs: st.mtimeMs, size: st.size, ino: st.ino })
    const key = p.toLowerCase()
    const set = this.folded.get(key) ?? new Set<string>()
    set.add(p)
    this.folded.set(key, set)
  }

  /** `p` and everything known beneath it are gone: deepest first, then `p` itself (never the watched folder). */
  private forget(p: string): void {
    const inside = [...this.known.keys()].filter((k) => isInside(p, k)).sort((a, b) => b.length - a.length)
    for (const k of [...inside, ...(p === this.dir ? [] : [p])]) {
      const was = this.known.get(k)
      if (was === undefined) continue
      this.known.delete(k)
      const key = k.toLowerCase()
      this.folded.get(key)?.delete(k)
      if (this.folded.get(key)?.size === 0) this.folded.delete(key)
      this.emit(was.dir ? 'unlinkDir' : 'unlink', k)
    }
  }
}
