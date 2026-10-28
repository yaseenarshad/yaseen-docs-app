/**
 * Jumps across files in the code tab against the REAL app (YAZ-3454 D9, D10; YAZ-3455): the real
 * language helpers (TypeScript 7 `tsc --lsp`, pyright on Electron's own Node) in a temp vault with a
 * TS project and a Python project.
 *
 * - F12 on an imported function opens its file IN THIS TAB, at the line of the function (S1).
 * - Shift+F12 opens Monaco's peek box with the places in all 3 files of the project (S2).
 * - The last code tab of the project closes → its helper stops (S6).
 * - Python: F12 jumps to the other `.py` file at the right line; quit leaves no helper.
 *
 * Helpers are counted only among the processes under THIS app (`app.process().pid`), so a helper
 * of another app or worktree never counts. Keys go to the page through Playwright, never to the
 * person's screen. Same harness as viewers.spec.ts: temp `--user-data-dir`, a COPY of a generated
 * fixture vault, `codeJumps-` screenshots, hidden windows. Serial: one launch, each step continuing
 * the last one.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, expandDirs, fileRow, launchApp, layer, quitApp, seededState, shoot, tabsOf } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page
/** Every helper pid seen under the app, so the quit step can check that each one ended. */
const seen = new Set<number>()

interface Proc {
  pid: number
  ppid: number
  command: string
}

/** The language helpers among the processes under the app's main process. */
function helpersOf(rootPid: number): { ts: number[]; py: number[] } {
  const rows: Proc[] = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }))
  const under = new Set([rootPid])
  for (let grew = true; grew; ) {
    grew = false
    for (const row of rows) {
      if (!under.has(row.pid) && under.has(row.ppid)) {
        under.add(row.pid)
        grew = true
      }
    }
  }
  const mine = rows.filter((row) => row.pid !== rootPid && under.has(row.pid))
  const ts = mine.filter((row) => /\btsc\b.*--lsp/.test(row.command)).map((row) => row.pid)
  const py = mine.filter((row) => row.command.includes('langserver.index.js')).map((row) => row.pid)
  for (const pid of [...ts, ...py]) seen.add(pid)
  return { ts, py }
}

const helpers = () => helpersOf(app.process().pid!)

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const code = () => layer(win).locator('.editor--code .monaco-editor')

/** Puts the cursor in the line that has `text`, `column` characters in (from Home). */
async function cursorAt(text: string, column: number): Promise<void> {
  await code().locator('.view-line', { hasText: text }).first().click()
  await win.keyboard.press('Home')
  for (let i = 0; i < column; i++) await win.keyboard.press('ArrowRight')
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'codeJumps-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.join(vault, 'tsproj', 'src'), { recursive: true })
  await mkdir(path.join(vault, 'pyproj', 'app'), { recursive: true })
  await Promise.all([
    writeFile(path.join(vault, 'tsproj', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] })),
    writeFile(path.join(vault, 'tsproj', 'src', 'math.ts'), '// math\n// line two\nexport function addNumbers(a: number, b: number): number {\n  return a + b\n}\n'),
    writeFile(path.join(vault, 'tsproj', 'src', 'use.ts'), "import { addNumbers } from './math'\n\nexport const total = addNumbers(1, 2)\n"),
    writeFile(path.join(vault, 'tsproj', 'src', 'other.ts'), "import { addNumbers } from './math'\n\naddNumbers(5, 6)\n"),
    writeFile(path.join(vault, 'pyproj', 'pyproject.toml'), '[project]\nname = "pyproj"\n'),
    writeFile(path.join(vault, 'pyproj', 'app', '__init__.py'), ''),
    writeFile(path.join(vault, 'pyproj', 'app', 'mathy.py'), '# mathy\n\n\ndef add_numbers(a: int, b: int) -> int:\n    return a + b\n'),
    writeFile(path.join(vault, 'pyproj', 'app', 'main.py'), 'from app.mathy import add_numbers\n\nprint(add_numbers(1, 2))\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — TS: F12 on an imported function opens its file in this tab, at the line of the function (S1)', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'tsproj', 'src', 'use.ts')) })
  win = await appWindow(app, 'w1')
  await expect(code().locator('.view-lines')).toContainText('addNumbers(1, 2)')
  // The helper starts with the first tab of its project.
  await expect.poll(() => helpers().ts.length, { timeout: 15_000 }).toBe(1)
  // "export const total = " is 21 characters: 23 puts the cursor inside `addNumbers`.
  await cursorAt('total', 23)
  await win.keyboard.press('F12')
  await expect(tabsOf(win)).toHaveText(['math.ts'], { timeout: 15_000 })
  await expect(code().locator('.view-lines')).toContainText('export function addNumbers')
  await expect(code().locator('.active-line-number')).toHaveText('3')
  await shoot(win, 'codeJumps-01-f12')
})

test('step 2 — TS: Shift+F12 opens the peek box with the places in all 3 files (S2)', async () => {
  // "export function " is 16 characters: 18 puts the cursor inside `addNumbers`.
  await cursorAt('export function', 18)
  await win.keyboard.press('Shift+F12')
  const tree = code().locator('.peekview-widget .ref-tree')
  await expect(tree).toBeVisible({ timeout: 15_000 })
  await expect(tree).toContainText('math.ts')
  await expect(tree).toContainText('use.ts')
  await expect(tree).toContainText('other.ts')
  await shoot(win, 'codeJumps-02-references')
  await win.keyboard.press('Escape')
  await expect(code().locator('.peekview-widget')).toHaveCount(0)
})

test('step 3 — TS: the last code tab of the project closes, and its helper stops (S6)', async () => {
  await clickMenuItem(app, 'menu.file.close-tab', 'w1')
  await expect(tabsOf(win)).toHaveCount(0)
  await expect.poll(() => helpers().ts.length, { timeout: 10_000 }).toBe(0)
})

test('step 4 — Python: F12 jumps to the other .py file at the line of the function; quit leaves no helper', async () => {
  test.setTimeout(60_000)
  await expandDirs(win, [path.join(vault, 'pyproj'), path.join(vault, 'pyproj', 'app')])
  await fileRow(win, 'main.py').click()
  await expect(code().locator('.view-lines')).toContainText('add_numbers(1, 2)')
  await expect.poll(() => helpers().py.length, { timeout: 15_000 }).toBe(1)
  // "print(" is 6 characters: 8 puts the cursor inside `add_numbers`.
  await cursorAt('print', 8)
  await win.keyboard.press('F12')
  await expect(tabsOf(win)).toHaveText(['mathy.py'], { timeout: 20_000 })
  await expect(code().locator('.view-lines')).toContainText('def add_numbers')
  await expect(code().locator('.active-line-number')).toHaveText('4')
  await shoot(win, 'codeJumps-04-python-f12')
  expect(seen.size).toBeGreaterThanOrEqual(2) // one tsc, one pyright
  await quitApp(app)
  await expect.poll(() => [...seen].filter(alive), { timeout: 10_000 }).toEqual([])
})
