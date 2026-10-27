import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CONTRACT } from '@shared/ipc'
import type { LspHover, LspLocation, LspOpenResponse } from '@shared/lsp'
import type { LspPool } from '../lsp/pool'
import { resolvePyright } from '../lsp/python'
import { stopAllLanguageServers } from '../lsp/server'
import { registered } from './ipcFixture'
import { registerLspIpc } from './lsp'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

/**
 * The code tab's door to the real `pyright` (YAZ-3455 4C), headless, on this test's own Node (the
 * app runs it on Electron's: `process.execPath` + `ELECTRON_RUN_AS_NODE=1`, the same command):
 * - S1: a definition from `main.py` to `math_utils.py`, and the references in 3 files.
 * - S2: a project `.venv` with no runnable Python: the jump into its `site-packages` still works.
 * - S4: the last Python tab closes → the pyright process ends.
 */

const desktopDir = fileURLToPath(new URL('../../..', import.meta.url))
const entry = resolvePyright({ isPackaged: false, resourcesPath: '', appPath: desktopDir, exists: existsSync })

const FILES: Record<string, string> = {
  'proj/pyproject.toml': '[project]\nname = "proj"\n',
  'proj/app/__init__.py': '',
  'proj/app/math_utils.py': 'def add(a: int, b: int) -> int:\n    """Adds two numbers."""\n    return a + b\n',
  'proj/app/main.py': 'from app.math_utils import add\nimport fakelib\n\nprint(add(1, 2))\nfakelib.helper()\n',
  'proj/app/other.py': 'from app.math_utils import add\n\nadd(3, 4)\n',
  // A venv whose Python is gone (S3's "no Python on the Mac" for the interpreter): only its site-packages.
  'proj/.venv/pyvenv.cfg': 'home = /nowhere\n',
  'proj/.venv/lib/python3.12/site-packages/fakelib/__init__.py': 'def helper() -> None:\n    pass\n',
  'vault-script.py': 'def run() -> None:\n    pass\n\nrun()\n',
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

describe('lsp:* with pyright (YAZ-3455)', () => {
  let root = ''
  let pool: LspPool
  const event = { sender: Object.assign(new EventEmitter(), { id: 9 }) }
  const at = (rel: string) => path.join(root, rel)
  const call = async <T,>(door: { channel: string }, ...args: unknown[]): Promise<T> => {
    const env = (await registered(door)(event, ...args)) as Envelope<T>
    if (!env.ok) throw Object.assign(new Error(env.error.code), env.error)
    return env.value
  }
  const open = (rel: string) => call<LspOpenResponse | null>(CONTRACT.lsp.open, { root, path: at(rel), text: FILES[rel] })
  const where = (places: LspLocation[] | null) => (places ?? []).map((p) => `${path.relative(root, p.path).split(path.sep).join('/')}:${p.range.start.line}:${p.range.start.character}`).sort()

  beforeAll(async () => {
    expect(entry, 'run `npm install`: the root devDependencies hold pyright').not.toBeNull()
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-3455-lsp-')))
    for (const [rel, text] of Object.entries(FILES)) {
      await mkdir(path.dirname(at(rel)), { recursive: true })
      await writeFile(at(rel), text)
    }
    pool = registerLspIpc({ isPackaged: false, resourcesPath: '', appPath: desktopDir })
  })

  afterAll(async () => {
    await pool.stopAll()
    await stopAllLanguageServers()
    await rm(root, { recursive: true, force: true })
  })

  it('S1, S2, S4: a jump across files and into the venv, the references in 3 files, the hover, and the stop with the last tab', async () => {
    const main = (await open('proj/app/main.py'))!
    expect(main).toMatchObject({ language: 'python', projectRoot: at('proj') })
    const t0 = performance.now()
    const def = await call<LspLocation[] | null>(CONTRACT.lsp.definition, { handle: main.handle, position: { line: 3, character: 7 } })
    const firstAnswerMs = performance.now() - t0
    expect(where(def)).toEqual(['proj/app/math_utils.py:0:4'])

    expect(where(await call(CONTRACT.lsp.definition, { handle: main.handle, position: { line: 4, character: 9 } }))).toEqual(['proj/.venv/lib/python3.12/site-packages/fakelib/__init__.py:0:4'])

    const refs = await call<LspLocation[] | null>(CONTRACT.lsp.references, { handle: main.handle, position: { line: 3, character: 7 } })
    expect(where(refs)).toEqual(['proj/app/main.py:0:27', 'proj/app/main.py:3:6', 'proj/app/math_utils.py:0:4', 'proj/app/other.py:0:27', 'proj/app/other.py:2:0'])

    const hover = await call<LspHover | null>(CONTRACT.lsp.hover, { handle: main.handle, position: { line: 3, character: 7 } })
    expect(hover?.contents).toContain('def add(')

    const [helper] = pool.running()
    console.log(`[YAZ-3455] fixture: first definition ${firstAnswerMs.toFixed(0)} ms (pyright start included)`)
    await call(CONTRACT.lsp.close, main.handle)
    await until(() => !alive(helper.pid))
    expect(pool.running()).toEqual([])
  })

  it('a Python file in no project: the vault is the project', async () => {
    const script = (await open('vault-script.py'))!
    expect(script.projectRoot).toBe(root)
    expect(where(await call(CONTRACT.lsp.definition, { handle: script.handle, position: { line: 3, character: 0 } }))).toEqual(['vault-script.py:0:4'])
    await call(CONTRACT.lsp.close, script.handle)
    await until(() => pool.running().length === 0)
  })
})
