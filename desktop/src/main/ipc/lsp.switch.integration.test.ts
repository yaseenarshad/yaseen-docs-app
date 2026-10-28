import { EventEmitter } from 'node:events'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CONTRACT } from '@shared/ipc'
import type { LspLocation, LspOpenResponse } from '@shared/lsp'
import type { LspHelpersState, LspInstallResult } from '@shared/lspInstall'
import { stopAllLanguageServers } from '../lsp/server'
import { resolveTypescriptServer } from '../lsp/typescript'
import type { LspPool } from '../lsp/pool'
import { registered } from './ipcFixture'
import { registerLspIpc } from './lsp'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

/**
 * Settings › Code › "Jump across files" at main's door (YAZ-3500), with the real TypeScript 7 helper from
 * `node_modules`, headless:
 * - S1: off (the default), `lsp:open` answers null and no helper starts.
 * - S3: on, the same open starts the helper, and a jump crosses files.
 * - S4: turned off with a tab open, every helper stops within 2 s.
 * - `lsp:helpers`: a dev build counts its `node_modules` copies (no box); without them, not ready.
 * - `lsp:install` with no network: its fetch is the test's, and the answer is one sentence's kind.
 */

const desktopDir = fileURLToPath(new URL('../../..', import.meta.url))
const noDownloads = path.join(tmpdir(), 'yaz-3500-no-downloads')
const binary = resolveTypescriptServer({ lspRoot: noDownloads, devCopies: true, appPath: desktopDir, platform: process.platform, arch: process.arch, exists: existsSync })
const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', noEmit: true }, include: ['src'] })

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(binary === null)('the "Jump across files" switch at lsp:* (YAZ-3500)', () => {
  let root = ''
  let pool: LspPool
  let on = false
  const listeners = new Set<(on: boolean) => void>()
  const flip = (next: boolean) => {
    on = next
    for (const l of listeners) l(on)
  }
  const sender = Object.assign(new EventEmitter(), { id: 9, isDestroyed: () => false, send: vi.fn() })
  const event = { sender }
  const call = async <T,>(door: { channel: string }, ...args: unknown[]): Promise<T> => {
    const env = (await registered(door)(event, ...args)) as { ok: true; value: T } | { ok: false; error: { code: string } }
    if (!env.ok) throw Object.assign(new Error(env.error.code), env.error)
    return env.value
  }
  const file = (rel: string) => path.join(root, rel)
  const fetches: string[] = []

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-3500-switch-')))
    await mkdir(file('p/src'), { recursive: true })
    await writeFile(file('p/tsconfig.json'), TSCONFIG)
    await writeFile(file('p/src/math.ts'), 'export function add(a: number, b: number): number {\n  return a + b\n}\n')
    await writeFile(file('p/src/a.ts'), "import { add } from './math'\n\nexport const three = add(1, 2)\n")
    pool = registerLspIpc(
      { lspRoot: path.join(root, 'userData', 'lsp'), devCopies: true, appPath: desktopDir },
      {
        on: () => on,
        subscribe: (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        },
      },
      async (url) => {
        fetches.push(url)
        throw new TypeError('fetch failed')
      },
    )
  })

  afterAll(async () => {
    await pool.stopAll()
    await stopAllLanguageServers()
    await rm(root, { recursive: true, force: true })
  })

  const open = () => call<LspOpenResponse | null>(CONTRACT.lsp.open, { root, path: file('p/src/a.ts'), text: "import { add } from './math'\n\nexport const three = add(1, 2)\n" })

  it('S1: off, lsp:open answers null and no helper starts', async () => {
    expect(await open()).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(pool.running()).toEqual([])
    // A bad request is still refused while off.
    await expect(call(CONTRACT.lsp.open, { root, path: 'p/src/a.ts', text: '' })).rejects.toMatchObject({ code: 'NOT_ABSOLUTE' })
  })

  it('S3 then S4: on, a jump crosses files; off with the tab open, every helper stops within 2 s', async () => {
    flip(true)
    const a = (await open())!
    expect(a).toMatchObject({ language: 'typescript' })
    const def = await call<LspLocation[] | null>(CONTRACT.lsp.definition, { handle: a.handle, position: { line: 2, character: 21 } })
    expect(def?.map((p) => path.relative(root, p.path))).toEqual([path.join('p', 'src', 'math.ts')])
    const [helper] = pool.running()
    expect(alive(helper.pid)).toBe(true)
    const t0 = Date.now()
    flip(false)
    while (alive(helper.pid) && Date.now() - t0 < 2_000) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(alive(helper.pid)).toBe(false)
    expect(pool.running()).toEqual([])
    // The tab's stale handle answers null: Monaco's one-file help.
    expect(await call(CONTRACT.lsp.definition, { handle: a.handle, position: { line: 2, character: 21 } })).toBeNull()
  })

  it("lsp:helpers: a dev build's node_modules copies are ready (no box); lsp:install offline answers its kind and writes nothing", async () => {
    expect(await call<LspHelpersState>(CONTRACT.lsp.helpers)).toEqual({ ready: true, installing: false })
    const res = await call<LspInstallResult>(CONTRACT.lsp.install)
    expect(res).toMatchObject({ ok: false, error: 'offline' })
    expect(fetches[0]).toMatch(/^https:\/\/registry\.npmjs\.org\//)
    expect(sender.send).not.toHaveBeenCalledWith(CONTRACT.lsp.onInstallProgress.channel, expect.anything())
    const lspRoot = path.join(root, 'userData', 'lsp')
    expect(existsSync(lspRoot) ? readdirSync(lspRoot) : []).toEqual([])
    await call(CONTRACT.lsp.cancelInstall)
  })
})
