import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { appendFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { VaultConfigChange, WatchEvent } from '@shared/types'
import { subscribeConfig, writeConfig } from '../vaultConfig'
import { atomicWrite } from './fsUtils'
import { activeWatcherRoots, subscribe } from './watchers'
import { makeFixture, settled, sleep, until } from './testFixture'

/**
 * THE WATCHER CONFORMANCE SUITE (YAZ-2192, 🔒 D3): what every consumer of the vault watcher and the
 * `.yaseendocs/` config watcher relies on, written as observable events on real disk, so the engine
 * underneath can change and these cases say whether anything a consumer sees changed with it.
 *   - the Sidebar, search and catalog refresh on structural events; an open editor reloads (or
 *     raises the conflict bar) on a `change` of its own path carrying the file's mtime; the live
 *     index scans on add/change/unlink; git sync marks the root pending on any event;
 *   - favorites, properties and GitHub sync re-read on a config notification, and never on the
 *     echo of their own `writeConfig`.
 * Written green on chokidar first; `watchConformance.test.ts` runs it on the engine the app ships,
 * `watchConformance.polling.test.ts` with that engine's polling fallback forced on.
 */

/** Longer than any settling underneath (chokidar's `awaitWriteFinish` is 200 ms), so a late duplicate is caught. */
const QUIET_MS = 600
/** Real disk and real timers under a full parallel run: generous, and a hang still fails. */
const CASE_TIMEOUT_MS = 20_000
const PATIENCE_MS = 10_000

export function describeWatchConformance(engine: string): void {
  let root: string
  let cleanup: () => Promise<void>
  let outside: string
  /** FSEvents can replay a few ms of history from before a watch started: every case starts on a still vault. */
  const still = () => sleep(400)
  beforeAll(async () => {
    ;({ root, cleanup } = await makeFixture())
    outside = await mkdtemp(path.join(tmpdir(), 'mdapp-outside-'))
    await still()
  })
  afterAll(async () => {
    await cleanup()
    await rm(outside, { recursive: true, force: true })
  })

  const offs: Array<() => void> = []
  afterEach(async () => {
    offs.splice(0).forEach((off) => off())
    await until(() => activeWatcherRoots().length === 0)
    await still()
  })

  /** Subscribes, waits for `ready`, and hands back the events that follow it. */
  async function watching(r = root): Promise<{ events: WatchEvent[]; settled: () => Promise<WatchEvent[]>; off: () => void }> {
    const events: WatchEvent[] = []
    let ready = false
    const off = subscribe(r, (ev) => (ev.type === 'ready' ? (ready = true) : events.push(ev)))
    offs.push(off)
    await until(() => ready, PATIENCE_MS)
    return { events, off, settled: () => settled(() => events.length, QUIET_MS).then(() => events) }
  }

  const at = (...parts: string[]) => path.join(root, ...parts)
  const mtimeOf = async (p: string) => (await stat(p)).mtimeMs
  /** Order-free view of a recording: `type path`, sorted. */
  const shape = (events: readonly WatchEvent[]) => events.map((e) => `${e.type} ${'path' in e ? path.relative(root, e.path) : ''}`).sort()

  describe(`watcher conformance, ${engine}: the vault watcher`, { timeout: CASE_TIMEOUT_MS }, () => {
    it("an atomic save over an existing note is exactly ONE `change`, carrying the file's final mtime; the tmp file is silent", async () => {
      const file = at('alpha', 'a.md')
      const w = await watching()
      const { mtime } = await atomicWrite(file, '# saved\n')
      expect(await w.settled()).toEqual([{ type: 'change', path: file, mtime }])
      expect(mtime).toBe(await mtimeOf(file))
    })

    it('an atomic create is exactly ONE `add`; the tmp file is silent', async () => {
      const file = at('alpha', 'fresh.md')
      const w = await watching()
      const { mtime } = await atomicWrite(file, '# new\n')
      expect(await w.settled()).toEqual([{ type: 'add', path: file, mtime }])
      await rm(file)
    })

    it('a crash-left `.tmp-<hex>` file is silent, even when it lingers (YAZ-2179)', async () => {
      const w = await watching()
      const tmp = at('alpha', 'a.md.tmp-0123456789ab')
      await writeFile(tmp, 'torn')
      await sleep(400)
      expect(await w.settled()).toEqual([])
      await rm(tmp)
    })

    it('write, overwrite, delete: `add`, `change`, `unlink`, each with its mtime where it has one', async () => {
      const file = at('Zeta', 'plain.md')
      const w = await watching()
      await writeFile(file, 'one')
      await until(() => w.events.length === 1, PATIENCE_MS)
      await writeFile(file, 'two, longer')
      await until(() => w.events.length === 2, PATIENCE_MS)
      await rm(file)
      await w.settled()
      expect(w.events.map((e) => e.type)).toEqual(['add', 'change', 'unlink'])
      expect(w.events.every((e) => 'path' in e && e.path === file)).toBe(true)
      expect(w.events.slice(0, 2).every((e) => 'mtime' in e && typeof e.mtime === 'number')).toBe(true)
    })

    it('a burst of saves to one note collapses to ONE `change` with the last mtime', async () => {
      const file = at('alpha', 'a.md')
      const w = await watching()
      for (let i = 0; i < 5; i++) {
        await writeFile(file, `save ${i}`)
        await sleep(10)
      }
      expect(await w.settled()).toEqual([{ type: 'change', path: file, mtime: await mtimeOf(file) }])
    })

    it('a file written in slow chunks (a sync tool, a copy) is ONE `add`, once it is whole', async () => {
      const file = at('Zeta', 'slow.md')
      const w = await watching()
      for (let i = 0; i < 8; i++) {
        await appendFile(file, `chunk ${i}\n`)
        await sleep(30)
      }
      expect(await w.settled()).toEqual([{ type: 'add', path: file, mtime: await mtimeOf(file) }])
      await rm(file)
    })

    it('mkdir -p plus a file: every new folder is `addDir`, the file is `add`', async () => {
      const w = await watching()
      await mkdir(at('deep', 'er', 'est'), { recursive: true })
      await writeFile(at('deep', 'er', 'est', 'd.md'), 'd')
      expect(shape(await w.settled())).toEqual(['add deep/er/est/d.md', 'addDir deep', 'addDir deep/er', 'addDir deep/er/est'])
      await rm(at('deep'), { recursive: true })
    })

    it('renaming a file: `unlink` the old name, `add` the new one', async () => {
      await writeFile(at('alpha', 'old-name.md'), 'x')
      const w = await watching()
      await rename(at('alpha', 'old-name.md'), at('alpha', 'new-name.md'))
      expect(shape(await w.settled())).toEqual(['add alpha/new-name.md', 'unlink alpha/old-name.md'])
      await rm(at('alpha', 'new-name.md'))
    })

    it('renaming a folder: everything under the old name goes, everything under the new one comes', async () => {
      await mkdir(at('Before', 'sub'), { recursive: true })
      await writeFile(at('Before', 'one.md'), '1')
      await writeFile(at('Before', 'sub', 'two.md'), '2')
      const w = await watching()
      await rename(at('Before'), at('After'))
      expect(shape(await w.settled())).toEqual([
        'add After/one.md',
        'add After/sub/two.md',
        'addDir After',
        'addDir After/sub',
        'unlink Before/one.md',
        'unlink Before/sub/two.md',
        'unlinkDir Before',
        'unlinkDir Before/sub',
      ])
      await rm(at('After'), { recursive: true })
    })

    it('trash (a move out of the vault, `remove.ts`): a folder takes everything inside it along, a file is `unlink`', async () => {
      await mkdir(at('Doomed', 'inner'), { recursive: true })
      await writeFile(at('Doomed', 'x.md'), 'x')
      await writeFile(at('Doomed', 'inner', 'y.png'), 'y')
      await writeFile(at('loose.md'), 'l')
      const w = await watching()
      await rename(at('Doomed'), path.join(outside, 'Doomed'))
      await rename(at('loose.md'), path.join(outside, 'loose.md'))
      expect(shape(await w.settled())).toEqual(['unlink Doomed/inner/y.png', 'unlink Doomed/x.md', 'unlink loose.md', 'unlinkDir Doomed', 'unlinkDir Doomed/inner'])
    })

    it('a 200-file burst (a git pull): 200 `add`s, each path exactly once', async () => {
      await mkdir(at('Burst'))
      const w = await watching()
      await Promise.all(Array.from({ length: 200 }, (_, i) => writeFile(at('Burst', `b${i}.md`), `# ${i}\n`)))
      expect(shape(await w.settled())).toEqual(Array.from({ length: 200 }, (_, i) => `add Burst/b${i}.md`).sort())
      await rm(at('Burst'), { recursive: true })
    })

    it('dot-entries (`.yaseendocs/` included) and node_modules, at any depth, are silent', async () => {
      const w = await watching()
      await writeFile(at('.git', 'index'), 'x')
      await writeFile(at('.yaseendocs', 'favorites.json'), '[]')
      await writeFile(at('.hidden.md'), 'h2')
      await writeFile(at('node_modules', 'pkg', 'x.md'), 'x')
      await mkdir(at('alpha', '.cache'), { recursive: true })
      await writeFile(at('alpha', '.cache', 'c.md'), 'c')
      expect(await w.settled()).toEqual([])
      await rm(at('alpha', '.cache'), { recursive: true })
    })

    it('subscribe then unsubscribe before `ready` (a quick vault switch, YAZ-2178): no watcher left, nothing delivered', async () => {
      const events: WatchEvent[] = []
      subscribe(root, (ev) => events.push(ev))()
      expect(activeWatcherRoots()).toEqual([])
      await writeFile(at('alpha', 'after-close.md'), 'x')
      await sleep(QUIET_MS)
      expect(events).toEqual([])
      await rm(at('alpha', 'after-close.md'))
    })

    it('a watch reopened the moment the last one closed hears the first write after its `ready`', async () => {
      const first = await watching()
      first.off()
      const w = await watching()
      const file = at('alpha', 'reopened.md')
      await writeFile(file, 'x')
      expect(shape(await w.settled())).toEqual(['add alpha/reopened.md'])
      await rm(file)
    })
  })

  describe(`watcher conformance, ${engine}: the .yaseendocs/ config watcher`, { timeout: CASE_TIMEOUT_MS }, () => {
    const configOffs: Array<() => void> = []
    afterEach(() => configOffs.splice(0).forEach((off) => off()))

    /** A config subscription's notifications, recorded; config exposes no `ready`, so give it time to attach. */
    async function watchingConfig(r: string) {
      const changes: VaultConfigChange[] = []
      configOffs.push(subscribeConfig(r, (c) => changes.push(c)))
      await sleep(400)
      return { changes, settled: () => settled(() => changes.length, QUIET_MS).then(() => changes) }
    }

    it('an outside atomic save of a config file is ONE notification naming it; its tmp file is silent', async () => {
      const w = await watchingConfig(root)
      await atomicWrite(at('.yaseendocs', 'favorites.json'), '["Notes"]')
      expect(await w.settled()).toEqual([{ root, name: 'favorites.json' }])
    })

    it("the app's own writeConfig notifies once, synchronously, and is never echoed; the next outside write is heard", async () => {
      const w = await watchingConfig(root)
      await writeConfig(root, 'github.json', { enabled: false })
      expect(w.changes).toEqual([{ root, name: 'github.json' }])
      expect(await w.settled()).toEqual([{ root, name: 'github.json' }])
      await sleep(20)
      await atomicWrite(at('.yaseendocs', 'github.json'), '{"enabled":true}')
      expect(await w.settled()).toEqual([{ root, name: 'github.json' }, { root, name: 'github.json' }])
    })

    it('a config folder missing at the start is picked up when something outside the app creates it and writes into it', async () => {
      const fresh = await mkdtemp(path.join(tmpdir(), 'mdapp-noconfig-'))
      try {
        const w = await watchingConfig(fresh)
        await mkdir(path.join(fresh, '.yaseendocs'))
        await writeFile(path.join(fresh, '.yaseendocs', 'github.json'), '{"enabled":true}')
        expect(await w.settled()).toEqual([{ root: fresh, name: 'github.json' }])
      } finally {
        await rm(fresh, { recursive: true, force: true })
      }
    })

    it('only `.json` files directly in the folder notify', async () => {
      const w = await watchingConfig(root)
      await writeFile(at('.yaseendocs', 'notes.txt'), 'x')
      await mkdir(at('.yaseendocs', 'sub'), { recursive: true })
      await writeFile(at('.yaseendocs', 'sub', 'deep.json'), '{}')
      expect(await w.settled()).toEqual([])
      await rm(at('.yaseendocs', 'sub'), { recursive: true })
      await rm(at('.yaseendocs', 'notes.txt'))
    })
  })
}
