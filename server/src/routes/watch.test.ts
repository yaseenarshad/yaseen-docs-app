import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WatchEvent } from '@shared/types'
import { app } from '../app'
import { makeFixture } from '../test-fixture'
import { activeWatcherRoots } from '../watchers'

let root: string
let cleanup: () => Promise<void>
let server: Server
let base: string

beforeAll(async () => {
  ;({ root, cleanup } = await makeFixture())
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server
  await new Promise<void>((r) => server.once('listening', r))
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no address')
  base = `http://127.0.0.1:${addr.port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
  await cleanup()
})

interface Stream {
  res: Response
  /** Next parsed event (events arrive in order; `ready` is always first). */
  next: () => Promise<WatchEvent>
  close: () => void
}

const open: Stream[] = []
afterEach(async () => {
  open.splice(0).forEach((s) => s.close())
  await until(() => activeWatcherRoots().length === 0)
})

/** Opens an SSE connection and parses `data:` lines into a queue. */
async function openWatch(r: string): Promise<Stream> {
  const ctrl = new AbortController()
  const res = await fetch(`${base}/api/watch?root=${encodeURIComponent(r)}`, { signal: ctrl.signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const queue: WatchEvent[] = []
  const waiters: Array<(ev: WatchEvent) => void> = []
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }))
      if (done) return
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const data = frame.split('\n').find((l) => l.startsWith('data: '))
        if (data === undefined) continue
        const ev = JSON.parse(data.slice(6)) as WatchEvent
        const w = waiters.shift()
        if (w) w(ev)
        else queue.push(ev)
      }
    }
  })()
  const next = () =>
    new Promise<WatchEvent>((resolve, reject) => {
      const q = queue.shift()
      if (q) return resolve(q)
      const t = setTimeout(() => reject(new Error('timed out waiting for event')), 3000)
      waiters.push((ev) => (clearTimeout(t), resolve(ev)))
    })
  const stream = { res, next, close: () => ctrl.abort() }
  open.push(stream)
  return stream
}

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('GET /api/watch', () => {
  it('400 relative / 404 missing root', async () => {
    expect((await app.request('/api/watch?root=rel')).status).toBe(400)
    expect((await app.request(`/api/watch?root=${encodeURIComponent(path.join(root, 'nope'))}`)).status).toBe(404)
  })

  it('streams `ready` first and shares one watcher per root', async () => {
    const a = await openWatch(root)
    expect(a.res.headers.get('content-type')).toContain('text/event-stream')
    expect(await a.next()).toEqual({ type: 'ready', root })
    const b = await openWatch(root)
    expect(await b.next()).toEqual({ type: 'ready', root })
    expect(activeWatcherRoots()).toEqual([root])
  })

  it('add / change / unlink for a markdown file, with mtime, to every client', async () => {
    const a = await openWatch(root)
    const b = await openWatch(root)
    await a.next()
    await b.next()
    const file = path.join(root, 'alpha', 'watched.md')
    await writeFile(file, 'v1')
    const add = await a.next()
    expect(add).toMatchObject({ type: 'add', path: file })
    expect((add as { mtime: number }).mtime).toBeGreaterThan(0)
    expect(await b.next()).toEqual(add)

    await writeFile(file, 'v2 longer')
    const change = await a.next()
    expect(change).toMatchObject({ type: 'change', path: file })
    expect((change as { mtime: number }).mtime).toBeGreaterThanOrEqual((add as { mtime: number }).mtime)

    await rm(file)
    expect(await a.next()).toEqual({ type: 'unlink', path: file })
  })

  it('add / change / unlink for a .base file, with mtime', async () => {
    const a = await openWatch(root)
    await a.next()
    const file = path.join(root, 'alpha', 'watched.base')
    await writeFile(file, 'views: []\n')
    const add = await a.next()
    expect(add).toMatchObject({ type: 'add', path: file })
    expect((add as { mtime: number }).mtime).toBeGreaterThan(0)

    await writeFile(file, 'views:\n  - type: table\n    name: Table\n')
    expect(await a.next()).toMatchObject({ type: 'change', path: file })

    await rm(file)
    expect(await a.next()).toEqual({ type: 'unlink', path: file })
  })

  it('ignores non-vault files and dot-entries; reports new directories', async () => {
    const a = await openWatch(root)
    await a.next()
    await writeFile(path.join(root, 'alpha', 'ignored.txt'), 'x')
    await mkdir(path.join(root, '.cache'))
    await writeFile(path.join(root, '.cache', 'c.md'), 'x')
    await mkdir(path.join(root, 'newdir'))
    expect(await a.next()).toEqual({ type: 'addDir', path: path.join(root, 'newdir') })
  })

  it('closes the watcher only when the last client disconnects', async () => {
    const a = await openWatch(root)
    const b = await openWatch(root)
    await a.next()
    await b.next()
    a.close()
    await new Promise((r) => setTimeout(r, 100))
    expect(activeWatcherRoots()).toEqual([root])
    b.close()
    await until(() => activeWatcherRoots().length === 0)
  })
})
