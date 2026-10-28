import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LspPool, type LanguageSpec } from './pool'
import type { LanguageServer, ServerCommand, ServerExit, StartOptions } from './server'

/**
 * YAZ-3465 (the checker's test of YAZ-3454): a helper that is pushed out by the 3-helper limit WHILE IT
 * STARTS, and then asked again, must not leave a helper behind that the pool no longer tracks. The old
 * start's end cleared `project.starting` of the newer start, so a third start began and the second helper
 * ran on, untracked, until quit.
 */

const ROOT = path.resolve('/vault')
const file = (...parts: string[]) => path.join(ROOT, ...parts)

interface Live {
  root: string
  pid: number
  alive: boolean
}

function harness() {
  const live: Live[] = []
  const gates: { root: string; go: () => void }[] = []
  let pid = 100
  const start = (cmd: ServerCommand, options: StartOptions): Promise<LanguageServer> =>
    new Promise((resolve) => {
      let fired = false
      const go = () => {
        if (fired) return
        fired = true
        let end!: (exit: ServerExit) => void
        const exited = new Promise<ServerExit>((r) => (end = r))
        let stopRequested = false
        const me: Live = { root: options.rootPath, pid: ++pid, alive: true }
        live.push(me)
        resolve({
          name: cmd.name,
          pid: me.pid,
          capabilities: {},
          exited,
          request: async () => [] as never,
          notify: () => undefined,
          onNotification: () => () => undefined,
          onRequest: () => undefined,
          stop: async () => {
            stopRequested = true
            me.alive = false
            end({ code: 0, signal: null })
          },
          get stopRequested() {
            return stopRequested
          },
        })
      }
      gates.push({ root: options.rootPath, go })
    })
  const spec: LanguageSpec = {
    language: 'typescript',
    projectRoot: (f) => path.join(ROOT, path.relative(ROOT, f).split(path.sep)[0]),
    command: (root) => ({ name: 'typescript', command: 'fake', args: [], cwd: root }),
  }
  const pool = new LspPool([spec], { start, log: () => undefined, realpath: (x) => x })
  const settle = () => new Promise((r) => setTimeout(r, 0))
  return { pool, live, gates, settle }
}

describe('LspPool: a start thrown away while a newer one runs (YAZ-3465)', () => {
  it('a project pushed out while its helper starts, then asked again, leaves no untracked helper', async () => {
    const { pool, live, gates, settle } = harness()
    const h1 = pool.open(1, { root: ROOT, path: file('p1', 'a.ts'), text: 'x' })!
    pool.open(1, { root: ROOT, path: file('p2', 'a.ts'), text: 'x' })
    pool.open(1, { root: ROOT, path: file('p3', 'a.ts'), text: 'x' })
    // A 4th project: p1 (used longest ago, still starting) is pushed out.
    pool.open(1, { root: ROOT, path: file('p4', 'a.ts'), text: 'x' })
    // The p1 tab asks: a 2nd start of p1 begins (it pushes out p2).
    const q1 = pool.definition(1, h1.handle, { line: 0, character: 0 })
    // The 1st start of p1 ends now: it is thrown away (epoch), and its `finally` runs.
    gates.filter((g) => g.root === file('p1'))[0].go()
    await settle()
    // The p1 tab asks again before the 2nd start ends.
    const q2 = pool.definition(1, h1.handle, { line: 0, character: 0 })
    for (const g of gates) g.go()
    await settle()
    await Promise.all([q1, q2])
    await settle()

    const tracked = pool.running().map((r) => r.pid)
    const alive = live.filter((l) => l.alive)
    // Every helper that runs is one the pool knows (it can stop it), and there are 3 at most.
    expect(alive.map((l) => l.pid).sort()).toEqual([...tracked].sort())
    expect(alive.length).toBeLessThanOrEqual(3)
    // p1 has one helper, not two.
    expect(alive.filter((l) => l.root === file('p1')).length).toBe(1)
  })

  it('after the same race, the last tab closing stops every helper (S6)', async () => {
    const { pool, live, gates, settle } = harness()
    const handles = ['p1', 'p2', 'p3', 'p4'].map((p) => pool.open(1, { root: ROOT, path: file(p, 'a.ts'), text: 'x' })!.handle)
    const q1 = pool.definition(1, handles[0], { line: 0, character: 0 })
    gates.filter((g) => g.root === file('p1'))[0].go()
    await settle()
    const q2 = pool.definition(1, handles[0], { line: 0, character: 0 })
    for (const g of gates) g.go()
    await settle()
    await Promise.all([q1, q2])
    for (const h of handles) pool.close(1, h)
    await settle()
    expect(live.filter((l) => l.alive)).toEqual([])
  })
})
