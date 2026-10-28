import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LspPool, toHover, toLocations, type LanguageSpec } from './pool'
import type { LanguageServer, ServerCommand, ServerExit, StartOptions } from './server'

/**
 * The pool's rules (YAZ-3454 4B) with fake helpers in memory: one helper per project, the shared
 * document of two tabs, the 3-helper limit (the one used longest ago stops), one restart after a
 * crash, and the stop with the last tab. The real binary runs in `typescript.pool.integration.test.ts`.
 */

const ROOT = path.resolve('/vault')
const file = (...parts: string[]) => path.join(ROOT, ...parts)
const uri = (p: string) => pathToFileURL(p).href

interface Fake extends LanguageServer {
  root: string
  notes: [string, unknown][]
  requests: [string, unknown][]
  crash(): void
}

function harness(opts: { answers?: Record<string, (params: unknown) => unknown>; failStarts?: number; ownFolder?: string; realpath?: (p: string) => string } = {}) {
  const started: Fake[] = []
  let failStarts = opts.failStarts ?? 0
  let pid = 100
  const start = async (cmd: ServerCommand, options: StartOptions): Promise<LanguageServer> => {
    if (failStarts > 0) {
      failStarts--
      throw new Error('could not start')
    }
    let end!: (exit: ServerExit) => void
    const exited = new Promise<ServerExit>((resolve) => (end = resolve))
    let stopRequested = false
    const fake: Fake = {
      name: cmd.name,
      pid: ++pid,
      root: options.rootPath,
      capabilities: {},
      exited,
      notes: [],
      requests: [],
      request: async <R,>(method: string, params?: unknown) => {
        fake.requests.push([method, params])
        const answer = opts.answers?.[method]
        if (answer === undefined) throw new Error(`${method}: no answer`)
        return answer(params) as R
      },
      notify: (method, params) => void fake.notes.push([method, params]),
      onNotification: () => () => undefined,
      onRequest: () => undefined,
      stop: async () => {
        stopRequested = true
        end({ code: 1, signal: null })
      },
      get stopRequested() {
        return stopRequested
      },
      crash: () => end({ code: null, signal: 'SIGKILL' }),
    }
    started.push(fake)
    return fake
  }
  // A project is the first folder under the vault: /vault/p1/x.ts → /vault/p1. `none/` has no project.
  const spec: LanguageSpec = {
    language: 'typescript',
    projectRoot: (f) => {
      const first = path.relative(ROOT, f).split(path.sep)[0]
      return first === 'none' ? null : path.join(ROOT, first)
    },
    command: (root) => ({ name: 'typescript', command: 'fake', args: [], cwd: root }),
    ownFolder: () => opts.ownFolder ?? null,
  }
  const pool = new LspPool([spec], { start, log: () => undefined, realpath: opts.realpath ?? ((x) => x) })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { pool, started, settle }
}

const open = (pool: LspPool, p: string, text = 'x', owner = 1) => pool.open(owner, { root: ROOT, path: p, text })

describe('LspPool (YAZ-3454)', () => {
  it('gives no handle for a file no helper takes: another language, or no project (S7)', () => {
    const { pool, started } = harness()
    expect(open(pool, file('p1', 'notes.md'))).toBeNull()
    expect(open(pool, file('none', 'a.ts'))).toBeNull()
    expect(started).toHaveLength(0)
  })

  it('starts the helper with the first tab of its project, and opens the document there', async () => {
    const { pool, started, settle } = harness()
    const res = open(pool, file('p1', 'a.ts'), 'let a = 1')
    expect(res).toMatchObject({ language: 'typescript', projectRoot: file('p1') })
    await settle()
    expect(started).toHaveLength(1)
    expect(started[0].root).toBe(file('p1'))
    expect(started[0].notes).toEqual([['textDocument/didOpen', { textDocument: { uri: uri(file('p1', 'a.ts')), languageId: 'typescript', version: 1, text: 'let a = 1' } }]])
  })

  it('two tabs on one file share one document; the last of them closes it, and the helper stops (S6)', async () => {
    const { pool, started, settle } = harness()
    const a = open(pool, file('p1', 'a.tsx'), 'one')!
    const b = open(pool, file('p1', 'a.tsx'), 'one')!
    await settle()
    expect(started).toHaveLength(1)
    const helper = started[0]
    expect(helper.notes.filter(([m]) => m === 'textDocument/didOpen')).toHaveLength(1)
    pool.change(1, b.handle, 'two')
    expect(helper.notes.at(-1)).toEqual(['textDocument/didChange', { textDocument: { uri: uri(file('p1', 'a.tsx')), version: 2 }, contentChanges: [{ text: 'two' }] }])
    pool.change(1, a.handle, 'two') // the same text: nothing sent
    expect(helper.notes).toHaveLength(2)
    pool.close(1, a.handle)
    expect(helper.stopRequested).toBe(false)
    pool.close(1, b.handle)
    expect(helper.notes.at(-1)).toEqual(['textDocument/didClose', { textDocument: { uri: uri(file('p1', 'a.tsx')) } }])
    expect(helper.stopRequested).toBe(true)
    expect(pool.running()).toEqual([])
  })

  it('answers definition and references as paths on disk, without non-file places or places in the helper\'s own folder', async () => {
    const own = file('helper', 'lib')
    const { pool } = harness({
      ownFolder: own,
      answers: {
        'textDocument/definition': () => [
          { targetUri: uri(file('p1', 'math.ts')), targetRange: {}, targetSelectionRange: { start: { line: 1, character: 16 }, end: { line: 1, character: 19 } } },
          { targetUri: uri(path.join(own, 'lib.es5.d.ts')), targetSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
        ],
        'textDocument/references': () => [
          { uri: uri(file('p1', 'a.ts')), range: { start: { line: 2, character: 21 }, end: { line: 2, character: 24 } } },
          { uri: 'bundled:///lib.d.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
        ],
      },
    })
    const { handle } = open(pool, file('p1', 'a.ts'))!
    expect(await pool.definition(1, handle, { line: 2, character: 21 })).toEqual([{ path: file('p1', 'math.ts'), range: { start: { line: 1, character: 16 }, end: { line: 1, character: 19 } } }])
    expect(await pool.references(1, handle, { line: 2, character: 21 })).toEqual([{ path: file('p1', 'a.ts'), range: { start: { line: 2, character: 21 }, end: { line: 2, character: 24 } } }])
  })

  it('the helper gets the real path; the tab gets its own spelling back (a vault under a symlink)', async () => {
    const real = (p: string) => p.replace(`${path.sep}vault${path.sep}`, `${path.sep}private${path.sep}vault${path.sep}`)
    const { pool, started, settle } = harness({
      realpath: real,
      answers: { 'textDocument/definition': () => [{ uri: uri(real(file('p1', 'a.ts'))), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] },
    })
    const { handle } = open(pool, file('p1', 'a.ts'))!
    await settle()
    expect(started[0].notes[0]).toEqual(['textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ uri: uri(real(file('p1', 'a.ts'))) }) })])
    expect((await pool.definition(1, handle, { line: 0, character: 0 }))!.map((p) => p.path)).toEqual([file('p1', 'a.ts')])
  })

  it('a request that fails (a timeout, a helper that ended) answers null: the tab falls back', async () => {
    const { pool } = harness({ answers: {} })
    const { handle } = open(pool, file('p1', 'a.ts'))!
    expect(await pool.definition(1, handle, { line: 0, character: 0 })).toBeNull()
  })

  it('a handle of another window, or an unknown one, does nothing', async () => {
    const { pool, started, settle } = harness({ answers: { 'textDocument/definition': () => [] } })
    const { handle } = open(pool, file('p1', 'a.ts'), 'one', 1)!
    await settle()
    expect(await pool.definition(2, handle, { line: 0, character: 0 })).toBeNull()
    pool.change(2, handle, 'other')
    pool.close(2, handle)
    expect(started[0].notes).toHaveLength(1)
    expect(started[0].stopRequested).toBe(false)
    expect(await pool.definition(1, 'h999', { line: 0, character: 0 })).toBeNull()
  })

  it('at most 3 helpers: a 4th project stops the one used longest ago, which starts again on its next request', async () => {
    const { pool, started, settle } = harness({ answers: { 'textDocument/definition': () => [] } })
    const h1 = open(pool, file('p1', 'a.ts'))!
    open(pool, file('p2', 'a.ts'))
    open(pool, file('p3', 'a.ts'))
    await settle()
    // p1 used last: p2 is now the one used longest ago.
    await pool.definition(1, h1.handle, { line: 0, character: 0 })
    open(pool, file('p4', 'a.ts'))
    await settle()
    expect(pool.running().map((r) => path.basename(r.root)).sort()).toEqual(['p1', 'p3', 'p4'])
    expect(started.find((s) => s.root === file('p2'))!.stopRequested).toBe(true)
    // p2's tab is still open: its next request starts its helper again and stops p3.
    const h2 = pool.open(1, { root: ROOT, path: file('p2', 'b.ts'), text: '' })!
    await pool.definition(1, h2.handle, { line: 0, character: 0 })
    expect(pool.running().map((r) => path.basename(r.root)).sort()).toEqual(['p1', 'p2', 'p4'])
    const p2Helpers = started.filter((s) => s.root === file('p2'))
    expect(p2Helpers).toHaveLength(2)
    // The new helper got both open documents of p2.
    expect(p2Helpers[1].notes.filter(([m]) => m === 'textDocument/didOpen')).toHaveLength(2)
  })

  it('typing in a tab (its debounced change) counts as use for the 3-helper limit', async () => {
    const { pool, started, settle } = harness()
    const h1 = open(pool, file('p1', 'a.ts'))!
    open(pool, file('p2', 'a.ts'))
    open(pool, file('p3', 'a.ts'))
    await settle()
    // Only typing in p1, no jump: p2 is now the one used longest ago.
    pool.change(1, h1.handle, 'typed')
    open(pool, file('p4', 'a.ts'))
    await settle()
    expect(pool.running().map((r) => path.basename(r.root)).sort()).toEqual(['p1', 'p3', 'p4'])
    expect(started.find((s) => s.root === file('p1'))!.stopRequested).toBe(false)
    expect(started.find((s) => s.root === file('p2'))!.stopRequested).toBe(true)
  })

  it('a helper that crashes starts again once with its documents; a second crash leaves the tab on Monaco (S5)', async () => {
    const { pool, started, settle } = harness({ answers: { 'textDocument/definition': () => [] } })
    const { handle } = open(pool, file('p1', 'a.ts'), 'text now')!
    await settle()
    started[0].crash()
    await settle()
    await settle()
    expect(started).toHaveLength(2)
    expect(started[1].notes[0]).toEqual(['textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ text: 'text now' }) })])
    expect(await pool.definition(1, handle, { line: 0, character: 0 })).toEqual([])
    started[1].crash()
    await settle()
    await settle()
    expect(await pool.definition(1, handle, { line: 0, character: 0 })).toBeNull()
    expect(started).toHaveLength(2)
  })

  it('a helper that will not start is tried twice, then the project has none', async () => {
    const { pool, started } = harness({ failStarts: 5, answers: { 'textDocument/definition': () => [] } })
    const { handle } = open(pool, file('p1', 'a.ts'))!
    expect(await pool.definition(1, handle, { line: 0, character: 0 })).toBeNull()
    expect(await pool.definition(1, handle, { line: 0, character: 0 })).toBeNull()
    expect(await pool.definition(1, handle, { line: 0, character: 0 })).toBeNull()
    expect(started).toHaveLength(0)
  })

  it('a helper that ends because the pool stopped it (quit, limit, last tab) is no crash', async () => {
    const { pool, started, settle } = harness()
    open(pool, file('p1', 'a.ts'))
    await settle()
    await started[0].stop()
    await settle()
    expect(started).toHaveLength(1)
  })

  it('the last tab closing while the helper starts: the new helper is stopped at once', async () => {
    const { pool, started, settle } = harness()
    const { handle } = open(pool, file('p1', 'a.ts'))!
    pool.close(1, handle)
    await settle()
    expect(started).toHaveLength(1)
    expect(started[0].stopRequested).toBe(true)
    expect(pool.running()).toEqual([])
  })

  it('a window that goes away closes its tabs only', async () => {
    const { pool, started, settle } = harness()
    open(pool, file('p1', 'a.ts'), 'x', 1)
    open(pool, file('p2', 'a.ts'), 'x', 2)
    await settle()
    pool.closeOwner(1)
    expect(started.find((s) => s.root === file('p1'))!.stopRequested).toBe(true)
    expect(started.find((s) => s.root === file('p2'))!.stopRequested).toBe(false)
  })
})

describe('answer shapes', () => {
  it('toLocations takes a Location, a list, LocationLinks, or null', () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }
    const p = file('p1', 'a.ts')
    expect(toLocations(null)).toEqual([])
    expect(toLocations({ uri: uri(p), range })).toEqual([{ path: p, range }])
    expect(toLocations([{ targetUri: uri(p), targetSelectionRange: range, targetRange: range }])).toEqual([{ path: p, range }])
  })

  it('toHover makes Markdown of MarkupContent, MarkedStrings, or nothing', () => {
    expect(toHover(null)).toBeNull()
    expect(toHover({ contents: { kind: 'markdown', value: '**x**' } })).toEqual({ contents: '**x**' })
    expect(toHover({ contents: ['doc', { language: 'python', value: 'def f(): ...' }] })).toEqual({ contents: 'doc\n\n```python\ndef f(): ...\n```' })
    expect(toHover({ contents: '' })).toBeNull()
  })
})
