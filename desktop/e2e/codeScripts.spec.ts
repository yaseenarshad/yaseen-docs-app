/**
 * Monaco's TypeScript help on a SCRIPT file (a `.ts` with no `import` and no `export`) against the REAL
 * app (YAZ-3462). Monaco's TypeScript worker puts every open model in ONE program: each code tab has its
 * own model (`code-tab://t<n>/<path>`), and Quick Look has its own (`code-look://q<n>/<path>`). Without
 * `moduleDetection: force` (`client/src/code/monaco.ts`) a script is global, so two models of one file
 * declare the same names twice and the copy shows a false TS2451 "Cannot redeclare".
 *
 * Each fixture has ONE real error on purpose. Its squiggle proves that the diagnostics arrived (they
 * come for a model in one batch), so `toHaveCount(1)` needs no fixed wait: a false error makes it 2 or 3.
 * The real errors (a wrong type, a name declared twice in ONE file) still show, so the fix hides nothing.
 *
 * Same harness as viewers.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `codeScripts-` screenshots, hidden windows. Serial: one launch, each step continuing the last one.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, fileRow, launchApp, layer, lensTab, menuItem, quitApp, searchBar, seededState, shoot, showSearchTab, tabsOf } from './helpers'

test.describe.configure({ mode: 'serial' })

/** A global script with one real error on its last line (a string in a `number`). */
const SCRIPT = 'scriptprobe.ts'
const SCRIPT_BODY = "const greeting = 'hi'\nfunction hello() {\n  return greeting\n}\nhello()\nconst wrong: number = 'not a number'\n"
/** A second script that declares the same top-level name, with its own one real error. */
const OTHER = 'otherscript.ts'
const OTHER_BODY = "const greeting = 'other'\nconst alsoWrong: number = 'x'\n"
/** One file that really declares a name twice: TS2451 must still show, on both declarations. */
const TWICE = 'twiceprobe.ts'
const TWICE_BODY = 'let twice = 1\nlet twice = 2\n'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'codeScripts-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await Promise.all([
    writeFile(path.join(vault, SCRIPT), SCRIPT_BODY),
    writeFile(path.join(vault, OTHER), OTHER_BODY),
    writeFile(path.join(vault, TWICE), TWICE_BODY),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

const code = (w: Page) => layer(w).locator('.editor--code .monaco-editor')
const errors = (w: Page) => code(w).locator('.squiggly-error')

test('step 1 — a script file in one tab shows only its one real error', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await fileRow(win, SCRIPT).click()
  await expect(code(win).locator('.view-lines')).toContainText('greeting')
  await expect(errors(win)).toHaveCount(1, { timeout: 20_000 })
  await shoot(win, 'codeScripts-01-one-tab')
})

test('step 2 — Duplicate tab: the copy of the script shows no false TS2451, only its one real error', async () => {
  await tabsOf(win).filter({ hasText: SCRIPT }).first().click({ button: 'right' })
  await menuItem(win, 'Duplicate tab').click()
  await expect(tabsOf(win).filter({ hasText: SCRIPT })).toHaveCount(2)
  await expect(code(win).locator('.view-lines')).toContainText('greeting')
  await expect(errors(win)).toHaveCount(1, { timeout: 20_000 }) // before the fix: 2 (a false TS2451 on `greeting`, and the real one)
  await shoot(win, 'codeScripts-02-duplicate')
})

test('step 3 — Quick Look of the same script while it is open in a tab: the tab keeps only its one real error', async () => {
  // Quick Look's Monaco is read only, and Monaco draws no squiggles in a read-only editor
  // (`renderValidationDecorations: 'editable'`, its default). So the check is on the tab, after the
  // Quick Look model joined the one program and left it.
  await showSearchTab(win)
  await expect(async () => {
    await searchBar(win).fill('scriptprobe')
    await expect(win.locator('.sidebar__body .tree__row .tree__label').first()).toBeVisible()
  }).toPass({ timeout: 15_000 })
  await searchBar(win).press('ArrowDown')
  await searchBar(win).press('Space')
  await expect(win.locator('.quicklook .monaco-editor .view-lines')).toContainText('greeting')
  await shoot(win, 'codeScripts-03-quicklook')
  await searchBar(win).press('Escape')
  await expect(win.locator('.quicklook')).toHaveCount(0)
  await expect(errors(win)).toHaveCount(1)
  await lensTab(win, 'Files').click()
})

test('step 4 — a second script that declares the same top-level name shows no false error', async () => {
  await fileRow(win, OTHER).click()
  await expect(code(win).locator('.view-lines')).toContainText('other')
  await expect(errors(win)).toHaveCount(1, { timeout: 20_000 })
  await shoot(win, 'codeScripts-04-other-script')
})

test('step 5 — a name declared twice in ONE file still shows TS2451 on both declarations', async () => {
  await fileRow(win, TWICE).click()
  await expect(code(win).locator('.view-lines')).toContainText('twice')
  await expect(errors(win)).toHaveCount(2, { timeout: 20_000 })
  await shoot(win, 'codeScripts-05-real-redeclare')
  await quitApp(app)
})
