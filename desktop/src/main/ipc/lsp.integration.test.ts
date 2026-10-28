import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CONTRACT } from '@shared/ipc'
import type { LspLocation, LspOpenResponse } from '@shared/lsp'
import { runningLanguageServers, stopAllLanguageServers } from '../lsp/server'
import { resolveTypescriptServer } from '../lsp/typescript'
import type { LspPool } from '../lsp/pool'
import { registered } from './ipcFixture'
import { registerLspIpc } from './lsp'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

/**
 * The code tab's door to the real TypeScript 7 helper (YAZ-3454 4B), headless: the `lsp:*` handlers
 * as a window calls them, on small projects in a temp folder.
 * - S1: a definition across files (`a.ts` → `math.ts`), also after an edit the tab sent.
 * - S2: the references of a function used in 3 files.
 * - S6: the last tab closes → the helper process ends. S5: a killed helper starts again once.
 * - The 3-helper limit: a 4th project stops the helper used longest ago.
 * - S7: a file outside any project gets no helper. A window that goes away stops its helpers.
 */

const desktopDir = fileURLToPath(new URL('../../..', import.meta.url))
const binary = resolveTypescriptServer({ lspRoot: path.join(tmpdir(), 'yaz-3500-no-downloads'), devCopies: true, appPath: desktopDir, platform: process.platform, arch: process.arch, exists: existsSync })
const shipped = ['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(`${process.platform}-${process.arch}`)

const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', noEmit: true }, include: ['src'] })
const user = (name: string) => ["import { add } from './math'", '', `export const ${name} = add(1, 2)`, ''].join('\n')
const FILES: Record<string, string> = {
  'p1/tsconfig.json': TSCONFIG,
  'p1/src/math.ts': ['/** Adds two numbers. */', 'export function add(a: number, b: number): number {', '  return a + b', '}', ''].join('\n'),
  'p1/src/a.ts': user('three'),
  'p1/src/b.ts': user('seven'),
  'p1/src/c.ts': user('eight'),
  'p2/tsconfig.json': TSCONFIG,
  'p2/src/x.ts': 'export const x = 1\n',
  'p3/package.json': '{ "name": "p3" }',
  'p3/src/x.ts': 'export const x = 1\n',
  'p4/tsconfig.json': TSCONFIG,
  'p4/src/x.tsx': 'export const X = () => null\n',
  'loose/x.ts': 'export const x = 1\n',
}

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string } }

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.skipIf(!shipped && binary === null)('lsp:* with the TypeScript 7 helper (YAZ-3454)', () => {
  let root = ''
  let pool: LspPool
  const sender = Object.assign(new EventEmitter(), { id: 7 })
  const event = { sender }
  const at = (rel: string) => path.join(root, rel)
  const call = async <T,>(door: { channel: string }, ...args: unknown[]): Promise<T> => {
    const env = (await registered(door)(event, ...args)) as Envelope<T>
    if (!env.ok) throw Object.assign(new Error(env.error.code), env.error)
    return env.value
  }
  const open = (rel: string, text = FILES[rel]) => call<LspOpenResponse | null>(CONTRACT.lsp.open, { root, path: at(rel), text })
  const where = (places: LspLocation[] | null) => (places ?? []).map((p) => `${path.relative(root, p.path).split(path.sep).join('/')}:${p.range.start.line}:${p.range.start.character}`).sort()

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-3454-lsp-')))
    for (const [rel, text] of Object.entries(FILES)) {
      await mkdir(path.dirname(at(rel)), { recursive: true })
      await writeFile(at(rel), text)
    }
    pool = registerLspIpc({ lspRoot: path.join(tmpdir(), 'yaz-3500-no-downloads'), devCopies: true, appPath: desktopDir })
  })

  afterAll(async () => {
    await pool.stopAll()
    await stopAllLanguageServers()
    await rm(root, { recursive: true, force: true })
  })

  it('S7: a file outside any project gets no helper; a bad request is refused', async () => {
    expect(await open('loose/x.ts')).toBeNull()
    await expect(call(CONTRACT.lsp.open, { root, path: 'p1/src/a.ts', text: '' })).rejects.toMatchObject({ code: 'NOT_ABSOLUTE' })
    await expect(call(CONTRACT.lsp.definition, { handle: 'h1', position: { line: -1, character: 0 } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('S1, S2, S6: a jump across files, the references in 3 files, and the stop with the last tab', async () => {
    const a = (await open('p1/src/a.ts'))!
    expect(a).toMatchObject({ language: 'typescript', projectRoot: at('p1') })
    const t0 = performance.now()
    const def = await call<LspLocation[] | null>(CONTRACT.lsp.definition, { handle: a.handle, position: { line: 2, character: 21 } })
    const firstAnswerMs = performance.now() - t0
    expect(where(def)).toEqual(['p1/src/math.ts:1:16'])

    const t1 = performance.now()
    const refs = await call<LspLocation[] | null>(CONTRACT.lsp.references, { handle: a.handle, position: { line: 2, character: 21 } })
    const referencesMs = performance.now() - t1
    expect(where(refs)).toEqual(['p1/src/a.ts:0:9', 'p1/src/a.ts:2:21', 'p1/src/b.ts:0:9', 'p1/src/b.ts:2:21', 'p1/src/c.ts:0:9', 'p1/src/c.ts:2:21', 'p1/src/math.ts:1:16'])

    // The tab's edit, not yet on disk: two lines on top move `add` to line 4.
    await call(CONTRACT.lsp.change, a.handle, `// one\n// two\n${FILES['p1/src/a.ts']}`)
    expect(where(await call(CONTRACT.lsp.definition, { handle: a.handle, position: { line: 4, character: 21 } }))).toEqual(['p1/src/math.ts:1:16'])

    const [helper] = pool.running()
    console.log(`[YAZ-3454] fixture: first definition ${firstAnswerMs.toFixed(0)} ms (helper start included), references ${referencesMs.toFixed(0)} ms`)
    expect(alive(helper.pid)).toBe(true)
    await call(CONTRACT.lsp.close, a.handle)
    await until(() => !alive(helper.pid))
    expect(pool.running()).toEqual([])
  })

  it('S5: a helper that crashes starts again once, and the jump still works', async () => {
    const a = (await open('p1/src/a.ts'))!
    await call(CONTRACT.lsp.definition, { handle: a.handle, position: { line: 2, character: 21 } })
    const [first] = pool.running()
    process.kill(first.pid, 'SIGKILL')
    await until(() => pool.running().length === 1 && pool.running()[0].pid !== first.pid)
    expect(where(await call(CONTRACT.lsp.definition, { handle: a.handle, position: { line: 2, character: 21 } }))).toEqual(['p1/src/math.ts:1:16'])
    await call(CONTRACT.lsp.close, a.handle)
    await until(() => pool.running().length === 0)
  })

  it('at most 3 helpers: a 4th project stops the one used longest ago', async () => {
    const handles: Record<string, string> = {}
    for (const rel of ['p1/src/a.ts', 'p2/src/x.ts', 'p3/src/x.ts']) {
      handles[rel] = (await open(rel))!.handle
      await call(CONTRACT.lsp.definition, { handle: handles[rel], position: { line: 0, character: 13 } })
    }
    expect(pool.running()).toHaveLength(3)
    const p1 = pool.running().find((r) => r.root === at('p1'))!
    handles['p4/src/x.tsx'] = (await open('p4/src/x.tsx'))!.handle
    await call(CONTRACT.lsp.definition, { handle: handles['p4/src/x.tsx'], position: { line: 0, character: 13 } })
    expect(pool.running().map((r) => path.basename(r.root)).sort()).toEqual(['p2', 'p3', 'p4'])
    await until(() => !alive(p1.pid))
    expect([...runningLanguageServers()].length).toBeLessThanOrEqual(3)

    // p1's tab is still open: its next jump starts its helper again (and stops p2's).
    expect(where(await call(CONTRACT.lsp.definition, { handle: handles['p1/src/a.ts'], position: { line: 2, character: 21 } }))).toEqual(['p1/src/math.ts:1:16'])
    expect(pool.running().map((r) => path.basename(r.root)).sort()).toEqual(['p1', 'p3', 'p4'])

    // The window goes away: every helper it used stops.
    const pids = pool.running().map((r) => r.pid)
    sender.emit('destroyed')
    await until(() => pids.every((pid) => !alive(pid)))
    expect(pool.running()).toEqual([])
  })
})
