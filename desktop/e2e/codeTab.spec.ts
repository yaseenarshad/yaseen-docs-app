/**
 * The code tab's chips and folds against the REAL app and the real Monaco, where jsdom can not tell:
 *
 * - YAZ-3477 (bug): the page cog's menu shows ABOVE Monaco's sticky scroll lines. Before the fix the
 *   sticky lines (`.sticky-widget`, z-index 4) drew over the menu's top rows. The check hit-tests the
 *   centre of each menu row with `elementFromPoint`, so it reads the real stacking order.
 * - YAZ-3478: the note's fold keys in a code tab (⌘⇧U, ⌘⇧I, ⌘↑, ⌘↓), ⌘End / ⌘Home, the fold chevron's
 *   right-click menu ("Collapse all", "Expand all"), the folds kept through a close and a reopen, and
 *   Monaco's own right-click menu in the app's `.ctx-menu` look (light and dark), above the chips row.
 * - YAZ-3479: the 8 file types Monaco does not know get colours: each file shows its keyword, string,
 *   comment and number in the app theme's code colours (`--code-keyword`, …), not in one plain colour.
 * - YAZ-3486: the code Outline with the real Monaco symbols and the real Python helper: ⌘J opens it,
 *   Pin keeps it beside the code, the rows, the filter, collapse, Sort by and Show, the error mark, the
 *   current row following the cursor, a click that opens the folds and jumps, a `.py` file's rows, no
 *   Outline for a `.lua` file, and the 5 MB file: its rows, and the long frames while typing in it.
 *
 * Same harness as viewers.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `codeTab-` screenshots, hidden windows. Keys and the wheel go to the page through Playwright, never
 * to the person's screen. Serial: one launch, each step continuing the last one.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, fileRow, launchApp, layer, menuItem, menuListItem, quitApp, seededState, shoot, tabsOf } from './helpers'

test.describe.configure({ mode: 'serial' })

/** A class with long methods: scrolled into `step1`, sticky scroll pins the class line and the method line. */
const FILE = 'pipeline.ts'
const method = (n: number) => [`  step${n}() {`, ...Array.from({ length: 40 }, (_, i) => `    const value${i} = ${n} * ${i}`), `    return ${n}`, '  }'].join('\n')
const FILE_BODY = `export class Pipeline {\n${[1, 2, 3, 4].map(method).join('\n\n')}\n}\n`

/** One small file per type Monaco lacks (YAZ-3479): a keyword, a string, a comment and a number each. */
const TYPED: Record<string, { body: string; keyword: string; string: string; comment: string }> = {
  'demo.hs': { body: '-- a comment\nmodule Main where\nmain = putStrLn "hi" >> print 42\n', keyword: 'module', string: '"hi"', comment: '-- a comment' },
  'demo.elm': { body: '-- a comment\nmodule Main exposing (main)\nmain = text "hi" ++ String.fromInt 42\n', keyword: 'module', string: '"hi"', comment: '-- a comment' },
  'demo.groovy': { body: '// a comment\ndef greet() { return "hi" + 42 }\n', keyword: 'def', string: '"hi"', comment: '// a comment' },
  'build.gradle': { body: '// a comment\nplugins { id "java" }\nversion = 42\nif (true) { println "x" }\n', keyword: 'if', string: '"java"', comment: '// a comment' },
  'demo.erl': { body: '% a comment\n-module(demo).\nf(X) -> case X of 42 -> "hi" end.\n', keyword: 'case', string: '"hi"', comment: '% a comment' },
  'demo.cmake': { body: '# a comment\nif(WIN32)\n  message("hi" 42)\nendif()\n', keyword: 'if', string: '"hi"', comment: '# a comment' },
  'demo.diff': { body: 'diff --git a/x b/x\n@@ -1 +1 @@\n-old line\n+new line\n\\ No newline at end of file\n', keyword: 'diff --git a/x b/x', string: '+new line', comment: '\\ No newline at end of file' },
  'demo.patch': { body: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old line\n+new line\n\\ No newline at end of file\n', keyword: '--- a/x', string: '+new line', comment: '\\ No newline at end of file' },
}

/** YAZ-3486: `long-class-for-folding.ts`'s shape — `Pipeline` with 40 short methods — and a type error in `step3`. */
const OUTLINE_FILE = 'outline-pipeline.ts'
const outlineMethod = (n: number) => (n === 3 ? `  step3() {\n    const broken: number = 'text'\n    return broken\n  }` : `  step${n}() {\n    const value${n} = ${n}\n    return value${n}\n  }`)
const OUTLINE_BODY = `export class Pipeline {\n${Array.from({ length: 40 }, (_, i) => outlineMethod(i + 1)).join('\n\n')}\n}\n\nexport const LIMIT = 40\n`
const PY_FILE = 'outline_demo.py'
const PY_BODY = 'class Greeter:\n    def hello(self, name: str) -> str:\n        return "hi " + name\n\n\ndef main() -> None:\n    print(Greeter().hello("you"))\n'
const LUA_FILE = 'outline-none.lua'
/** `speed/big-5mb.ts`'s shape: 52 000 exported constants, each an object literal of 4 properties. */
const BIG_FILE = 'outline-big-5mb.ts'
const BIG_BODY = `// About 5 MB.\n${Array.from({ length: 52_000 }, (_, i) => `export const value${i} = { id: ${i}, name: 'row ${i}', tags: ['alpha', 'beta', 'gamma'], active: ${i % 2 === 0 ? 'false' : 'true'} }`).join('\n')}\n`

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'codeTab-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, FILE), FILE_BODY)
  await Promise.all(Object.entries(TYPED).map(([name, t]) => writeFile(path.join(vault, name), t.body)))
  await Promise.all([writeFile(path.join(vault, OUTLINE_FILE), OUTLINE_BODY), writeFile(path.join(vault, PY_FILE), PY_BODY), writeFile(path.join(vault, LUA_FILE), 'local x = 1\nprint(x)\n'), writeFile(path.join(vault, BIG_FILE), BIG_BODY)])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

const code = (w: Page) => layer(w).locator('.editor--code .monaco-editor')

/** True when the top element at the centre of `box` is inside the cog's menu. */
const menuOnTopAt = (w: Page, box: { x: number; y: number; width: number; height: number }) =>
  w.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.page-settings__menu') != null, [box.x + box.width / 2, box.y + box.height / 2])

test('step 1 — YAZ-3477: the cog menu shows above the sticky scroll lines', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await fileRow(win, FILE).click()
  await expect(code(win).locator('.view-lines')).toContainText('export class Pipeline')

  // Scroll into step1's body: sticky scroll pins `export class Pipeline {` and `step1() {`.
  await code(win).locator('.view-lines').hover()
  await win.mouse.wheel(0, 300)
  const sticky = code(win).locator('.sticky-widget .sticky-line-content')
  await expect(sticky.filter({ hasText: 'export class Pipeline' })).toBeVisible()
  await expect(sticky.filter({ hasText: 'step1()' })).toBeVisible()

  await layer(win).locator('.page-settings__trigger').click()
  const rows = layer(win).locator('.page-settings__menu button')
  await expect(rows).toHaveText(['Read only (all code files)', 'Wrap long lines', 'Minimap'].map((label) => new RegExp(`^${label.replace(/[()]/g, '\\$&')}`)))
  await shoot(win, 'codeTab-01-cog-over-sticky')
  for (const row of await rows.all()) {
    const box = await row.boundingBox()
    expect(box).not.toBeNull()
    expect(await menuOnTopAt(win, box!), `"${await row.innerText()}" is on top`).toBe(true)
  }
  await win.keyboard.press('Escape')
  await expect(layer(win).locator('.page-settings__menu')).toHaveCount(0)

  // Monaco's own order inside its box does not change: its find box still draws over the sticky lines.
  await code(win).locator('.view-line', { hasText: 'value20 ' }).click()
  await win.keyboard.press('Meta+f')
  const findInput = code(win).locator('.find-widget.visible textarea').first()
  await expect(findInput).toBeVisible()
  // The box slides in (Monaco's 200 ms transform): poll until it rests, then name what is on top.
  await expect.poll(async () => {
    const box = (await findInput.boundingBox())!
    return win.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      return hit?.closest('.find-widget') != null ? 'find box' : (hit?.className ?? 'nothing')
    }, [box.x + box.width / 2, box.y + box.height / 2])
  }).toBe('find box')
  await shoot(win, 'codeTab-02-find-over-sticky')
  await win.keyboard.press('Escape')
})

const collapsed = (w: Page) => code(w).locator('.margin-view-overlays .codicon-folding-collapsed')
const expanded = (w: Page) => code(w).locator('.margin-view-overlays .codicon-folding-expanded')
const lines = (w: Page) => code(w).locator('.view-lines')

test('step 2 — YAZ-3478 S1: ⌘⇧U folds every block; close the tab and reopen it: still folded', async () => {
  await code(win).locator('.view-line', { hasText: 'value20 ' }).click()
  await win.keyboard.press('Meta+Shift+U')
  await expect(lines(win)).not.toContainText('step1()')
  await expect(collapsed(win)).toHaveCount(1) // the class line, with every method folded inside it
  await shoot(win, 'codeTab-03-fold-all')
  await win.waitForTimeout(600) // the 400 ms fold write
  await tabsOf(win).filter({ hasText: FILE }).locator('..').locator('.tabbar__close').click()
  await expect(code(win)).toHaveCount(0)
  await fileRow(win, FILE).click()
  await expect(lines(win)).toContainText('export class Pipeline')
  await expect(collapsed(win)).toHaveCount(1)
  await expect(lines(win)).not.toContainText('step1()')
})

test('step 3 — S2: ⌘⇧I opens every block', async () => {
  await code(win).locator('.view-line', { hasText: 'export class Pipeline' }).click()
  await win.keyboard.press('Meta+Shift+I')
  await expect(collapsed(win)).toHaveCount(0)
  await expect(lines(win)).toContainText('value20 ')
})

test('step 4 — S5: ⌘↑ folds the block at the cursor and ⌘↓ opens it; ⌘End / ⌘Home go to the bottom / top', async () => {
  await code(win).locator('.view-line', { hasText: 'value3 = 1' }).click()
  await win.keyboard.press('Meta+ArrowUp')
  await expect(collapsed(win)).toHaveCount(1)
  await expect(lines(win)).not.toContainText('value3 = 1')
  await expect(lines(win)).toContainText('step2()') // the cursor stayed: no jump to the top
  await shoot(win, 'codeTab-04-fold-at-cursor')
  await win.keyboard.press('Meta+ArrowDown')
  await expect(collapsed(win)).toHaveCount(0)
  await expect(lines(win)).toContainText('value3 = 1')
  await win.keyboard.press('Meta+End')
  await expect(lines(win)).toContainText('return 4')
  await win.keyboard.press('Meta+Home')
  await expect(lines(win)).toContainText('export class Pipeline')
})

test('step 5 — S3, S4: right-click a fold chevron: the app menu, Collapse all, then Expand all', async () => {
  await expanded(win).first().click({ button: 'right' })
  await expect(menuItem(win, 'Collapse all')).toBeVisible()
  await expect(menuItem(win, 'Expand all')).toBeVisible()
  await expect(menuItem(win, 'Collapse all')).toHaveAttribute('data-hint', '⌘⇧U')
  await shoot(win, 'codeTab-05-chevron-menu')
  await menuItem(win, 'Collapse all').click()
  await expect(collapsed(win)).toHaveCount(1)
  await expect(lines(win)).not.toContainText('step1()')
  await collapsed(win).first().click({ button: 'right' })
  await menuItem(win, 'Expand all').click()
  await expect(collapsed(win)).toHaveCount(0)
  await expect(lines(win)).toContainText('step1()')
})

/** The look of Monaco's menu in its shadow root, and of an app `.ctx-menu`, as computed. */
const MONACO_MENU = () => {
  const root = Array.from(document.querySelectorAll('.code-editor__monaco > .shadow-root-host')).map((h) => h.shadowRoot).find((r) => r?.querySelector('.monaco-menu') != null)
  const box = root?.querySelector('.monaco-menu')?.parentElement ?? null
  const item = root?.querySelector('.action-menu-item') ?? null
  if (box === null || item === null) return null
  const b = getComputedStyle(box)
  const i = getComputedStyle(item)
  const container = getComputedStyle(root!.querySelector('.context-view')!)
  return { bg: b.backgroundColor, radius: container.borderRadius, shadow: container.boxShadow, font: i.fontFamily, size: getComputedStyle(root!.querySelector('.action-label')!).fontSize, rowHeight: item.getBoundingClientRect().height, itemRadius: i.borderRadius }
}

test('step 6 — Monaco\'s right-click menu keeps its items and wears the app menu\'s look, light and dark', async () => {
  // The app's own menu, for the numbers: a tab's right-click menu.
  await tabsOf(win).filter({ hasText: FILE }).click({ button: 'right' })
  const appMenu = await win.evaluate(() => {
    const m = getComputedStyle(document.querySelector('.ctx-menu')!)
    const item = document.querySelector('.ctx-menu__item')!
    const i = getComputedStyle(item)
    return { bg: m.backgroundColor, radius: m.borderRadius, shadow: m.boxShadow, font: i.fontFamily, size: i.fontSize, rowHeight: item.getBoundingClientRect().height, itemRadius: i.borderRadius }
  })
  await win.keyboard.press('Escape')

  for (const theme of ['light', 'dark'] as const) {
    await win.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
    await code(win).locator('.view-line', { hasText: 'value5 = 1' }).click({ button: 'right' })
    await expect.poll(() => win.evaluate(MONACO_MENU)).not.toBeNull()
    const look = (await win.evaluate(MONACO_MENU))!
    const bg = await win.evaluate(() => getComputedStyle(document.querySelector('.code-editor')!).getPropertyValue('--bg').trim())
    expect(look).toMatchObject({ radius: appMenu.radius, shadow: appMenu.shadow, font: appMenu.font, size: appMenu.size, rowHeight: appMenu.rowHeight, itemRadius: appMenu.itemRadius })
    expect(look.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(await win.evaluate((c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v }, bg)).toBe(look.bg)
    // Monaco's items stay.
    const labels = await win.evaluate(() => Array.from(document.querySelector('.code-editor__monaco > .shadow-root-host')!.shadowRoot!.querySelectorAll('.action-label:not(.separator)')).map((e) => e.textContent))
    expect(labels).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste', 'Command Palette']))
    await shoot(win, `codeTab-06-monaco-menu-${theme}`)
    await win.keyboard.press('Escape')
  }
  await win.evaluate(() => (document.documentElement.dataset.theme = 'light'))
})

test('step 7 — Monaco\'s right-click menu shows above the chips row (YAZ-3477 kept it out of the editor\'s layer)', async () => {
  const host = win.locator('.code-editor__monaco > .shadow-root-host').first()
  const zIndex = await host.evaluate((h) => getComputedStyle(h).zIndex)
  const chips = await layer(win).locator('.status-chips').evaluate((c) => getComputedStyle(c).zIndex)
  expect(Number(zIndex)).toBeGreaterThan(Number(chips))
  expect(await host.evaluate((h) => h.closest('.monaco-editor'))).toBeNull()
})

/** The colour Monaco drew the first token span that holds `text` in. */
const colourOf = (w: Page, text: string) =>
  code(w).locator('.view-lines .view-line span span').filter({ hasText: text }).first().evaluate((el) => getComputedStyle(el).color)

/** An app.css token as the browser resolves it. */
const tokenColour = (w: Page, name: string) =>
  w.evaluate((n) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${n})`
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, name)

test('step 8 — YAZ-3479: each of the 8 types Monaco lacked shows the app code colours', async () => {
  const [keyword, string, comment, plain, danger, ok, type, fn] = await Promise.all(['--code-keyword', '--code-string', '--fg-muted', '--fg', '--danger', '--ok', '--code-type', '--code-function'].map((n) => tokenColour(win, n)))
  for (const [name, t] of Object.entries(TYPED)) {
    await fileRow(win, name).click()
    await expect(lines(win)).toContainText(t.string)
    const diff = name.endsWith('.diff') || name.endsWith('.patch')
    // Monaco colours a line after the tokenizer ran: poll until the first check has its colour.
    // A diff: headers `type`, `@@` lines `predefined`, added lines `--ok`, removed lines `--danger`.
    await expect.poll(() => colourOf(win, t.keyword), { message: `${name}: keyword` }).toBe(diff ? type : keyword)
    expect(await colourOf(win, t.string), `${name}: string`).toBe(diff ? ok : string)
    expect(await colourOf(win, t.comment), `${name}: comment`).toBe(comment)
    if (diff) {
      expect(await colourOf(win, '-old line'), `${name}: removed`).toBe(danger)
      expect(await colourOf(win, '@@ -1 +1 @@'), `${name}: hunk`).toBe(fn)
    } else expect(await colourOf(win, '42'), `${name}: number`).not.toBe(plain)
  }
  await shoot(win, 'codeTab-07-new-types')
})

const outline = (w: Page) => layer(w).locator('nav.outline')
const outlineRows = (w: Page) => outline(w).locator('.outline__row')
const outlineRow = (w: Page, name: string) => outlineRows(w).filter({ has: w.locator('.outline__name', { hasText: new RegExp(`^${name}$`) }) })
const rowNames = (w: Page) => outlineRows(w).locator('.outline__name').allInnerTexts()

test('step 9 — YAZ-3486: the code Outline lists the symbols; filter, collapse, the menu, the mark, follow the cursor, and a click jumps', async () => {
  test.setTimeout(90_000)
  await fileRow(win, OUTLINE_FILE).click()
  await expect(lines(win)).toContainText('export class Pipeline')
  // At 1100 px the window has no room for 800 px of code beside the names: the rail. ⌘J opens its card, the focus in the filter.
  await expect(outline(win).locator('.toc__rail')).toBeVisible()
  await code(win).locator('.view-line', { hasText: 'export class Pipeline' }).click()
  await win.keyboard.press('Meta+j')
  await expect(outline(win).locator('.toc__card')).toBeVisible()
  await expect(outline(win).locator('.outline__filter')).toBeFocused()
  await shoot(win, 'codeTab-08-outline-card')
  // Pin: the names stay beside the code (the setting "Always").
  await outline(win).locator('.toc__pin').click()
  await expect(outline(win)).toHaveAttribute('data-names', '')

  // S1: Pipeline, its 40 methods, each with its icon; the variable in each method; LIMIT.
  await expect.poll(() => rowNames(win)).toEqual(expect.arrayContaining(['Pipeline', 'step1', 'value1', 'step2']))
  expect((await rowNames(win))[0]).toBe('Pipeline')
  const runner = await outline(win).locator('.outline__runner').evaluate((el) => el.getBoundingClientRect().height)
  expect(runner).toBe((1 + 40 * 2 + 1) * 24)
  await expect(outlineRow(win, 'Pipeline').locator('.outline__icon')).toHaveAttribute('data-family', 'class')
  await expect(outlineRow(win, 'step1').locator('.outline__icon')).toHaveAttribute('data-family', 'method')
  await shoot(win, 'codeTab-09-outline-names')

  // S6: the TS worker's error marks the row that holds it red: `broken`, inside step3. Collapsed, step3 shows it.
  await expect(outlineRow(win, 'broken').locator('.outline__mark')).toHaveAttribute('data-mark', 'error', { timeout: 15_000 })
  await expect(outlineRow(win, 'step3').locator('.outline__mark')).toHaveCount(0)
  await outlineRow(win, 'step3').locator('.outline__twisty').click()
  await expect(outlineRow(win, 'step3').locator('.outline__mark')).toHaveAttribute('data-mark', 'error')
  await shoot(win, 'codeTab-09b-outline-error-mark')
  await outlineRow(win, 'step3').locator('.outline__twisty').click()

  // S3: the filter keeps step3, step30–39 and their parent.
  await outline(win).locator('.outline__filter').fill('step3')
  await expect.poll(() => rowNames(win)).toEqual(['Pipeline', 'step3', ...Array.from({ length: 10 }, (_, i) => `step${30 + i}`)])
  await shoot(win, 'codeTab-10-outline-filter')
  await outline(win).locator('.outline__filter').press('Escape')
  await expect(outline(win).locator('.outline__filter')).toHaveValue('')

  // S2: collapse Pipeline, then Collapse all.
  await outlineRow(win, 'Pipeline').locator('.outline__twisty').click()
  await expect.poll(() => rowNames(win)).toEqual(['Pipeline', 'LIMIT'])
  await outlineRow(win, 'Pipeline').locator('.outline__twisty').click()
  await outline(win).getByRole('button', { name: 'Collapse all' }).click()
  await expect.poll(() => rowNames(win)).toEqual(['Pipeline', 'LIMIT'])
  await outlineRow(win, 'Pipeline').locator('.outline__twisty').click()
  await expect.poll(() => (rowNames(win)).then((n) => n.slice(0, 3))).toEqual(['Pipeline', 'step1', 'step2'])
  await outline(win).getByRole('button', { name: 'More actions' }).click()
  await menuItem(win, 'Expand all').click()

  // S4, S5: Sort by Name, then Type; Show › Variables off; then back to Position and on.
  await outline(win).getByRole('button', { name: 'More actions' }).click()
  await menuItem(win, 'Sort by').click()
  await menuListItem(win, 'Name').click()
  await expect.poll(() => rowNames(win).then((n) => n.slice(0, 2))).toEqual(['LIMIT', 'Pipeline'])
  await outline(win).getByRole('button', { name: 'More actions' }).click()
  await menuItem(win, 'Show').click()
  await menuListItem(win, 'Variables').click()
  await expect.poll(() => rowNames(win).then((n) => n.filter((x) => x.startsWith('value')).length)).toBe(0)
  await shoot(win, 'codeTab-11-outline-sorted-no-variables')
  await outline(win).getByRole('button', { name: 'More actions' }).click()
  await menuItem(win, 'Show').click()
  await menuListItem(win, 'Variables').click()
  await outline(win).getByRole('button', { name: 'More actions' }).click()
  await menuItem(win, 'Sort by').click()
  await menuListItem(win, 'Position').click()
  await expect.poll(() => rowNames(win).then((n) => n.slice(0, 3))).toEqual(['Pipeline', 'step1', 'value1'])

  // S7: the cursor in step2 makes step2's variable the current row; the accent marks it.
  await code(win).locator('.view-line', { hasText: 'const value2 = 2' }).click()
  await expect(outline(win).locator('.outline__row[aria-current="true"] .outline__name')).toHaveText('value2')

  // S8: every block folded, then a click on step25: the folds open, the code glides there, the cursor is on its name.
  await win.keyboard.press('Meta+Shift+U')
  await expect(lines(win)).not.toContainText('step25()')
  await outline(win).locator('.outline__list').evaluate((el) => (el.scrollTop = 25 * 2 * 24))
  await outlineRow(win, 'step25').click()
  await expect(lines(win)).toContainText('step25() {')
  await expect(lines(win)).toContainText('const value25 = 25')
  await expect.poll(() => win.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('.monaco-editor') != null)).toBe(true)
  await expect(outline(win).locator('.outline__row[aria-current="true"] .outline__name')).toHaveText('step25')
  await shoot(win, 'codeTab-12-outline-jump')
  await win.keyboard.press('Meta+Shift+I')
})

test('step 10 — YAZ-3486 S10, S11: a .py file lists its class and functions; a .lua file has no Outline', async () => {
  test.setTimeout(60_000)
  await fileRow(win, PY_FILE).click()
  await expect(lines(win)).toContainText('class Greeter')
  await expect.poll(() => rowNames(win), { timeout: 30_000 }).toEqual(expect.arrayContaining(['Greeter', 'hello', 'main']))
  await expect(outlineRow(win, 'Greeter').locator('.outline__icon')).toHaveAttribute('data-family', 'class')
  await shoot(win, 'codeTab-13-outline-python')
  await fileRow(win, LUA_FILE).click()
  await expect(lines(win)).toContainText('local x = 1')
  await win.waitForTimeout(800)
  await expect(outline(win)).toHaveCount(0)
})

/** Types 20 keys at the start of a line of the big file, then waits 2.5 s (the 300 ms read and its answer): the long tasks of it all, ms. */
async function typeAndWatch(w: Page, lineText: string): Promise<{ typedMs: number; long: number[] }> {
  await code(w).locator('.view-line', { hasText: lineText }).first().click()
  await w.evaluate(() => {
    const g = window as unknown as { __long: number[]; __observer?: PerformanceObserver }
    g.__observer?.disconnect()
    g.__long = []
    g.__observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => g.__long.push(Math.round(e.duration))))
    g.__observer.observe({ type: 'longtask' })
  })
  const k0 = Date.now()
  for (let i = 0; i < 20; i++) await w.keyboard.type('x', { delay: 40 })
  const typedMs = Date.now() - k0
  await w.waitForTimeout(2500)
  const long = await w.evaluate(() => (window as unknown as { __long: number[] }).__long)
  for (let i = 0; i < 20; i++) await w.keyboard.press('Backspace')
  await w.waitForTimeout(1500)
  return { typedMs, long }
}

/** Settings › Editor › Table of contents, for the whole app. */
async function setTableOfContents(w: Page, label: 'Off' | 'Always' | 'When there is room'): Promise<void> {
  await w.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = w.locator('.settings-dialog[role="dialog"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('.settings-nav__item', { hasText: /^Editor$/ }).click()
  await dialog.locator('[data-setting="tableOfContents"]').getByRole('button', { name: label, exact: true }).click()
  await w.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
}

test('step 11 — YAZ-3486 S12: the 5 MB file: its Outline, and typing stays smooth (with the Outline, and Off for the baseline)', async () => {
  test.setTimeout(120_000)
  const t0 = Date.now()
  await fileRow(win, BIG_FILE).click()
  await expect(lines(win)).toContainText('export const value0', { timeout: 30_000 })
  const shownMs = Date.now() - t0
  await expect(outlineRow(win, 'value0')).toBeVisible({ timeout: 30_000 })
  const outlineMs = Date.now() - t0
  const runner = await outline(win).locator('.outline__runner').evaluate((el) => el.getBoundingClientRect().height)
  const drawn = await outlineRows(win).count()
  expect(runner / 24).toBe(260_000)
  expect(drawn).toBeLessThan(100)
  await shoot(win, 'codeTab-14-outline-big')
  const withOutline = await typeAndWatch(win, 'export const value3 =')
  await setTableOfContents(win, 'Off')
  await expect(outline(win)).toHaveCount(0)
  const off = await typeAndWatch(win, 'export const value3 =')
  console.log(`[YAZ-3486 S12] ${BIG_FILE}: code shown ${shownMs} ms, Outline rows ${outlineMs} ms after the click; ${runner / 24} rows, ${drawn} drawn. 20 keys + 2.5 s — with the Outline: ${withOutline.typedMs} ms, long tasks [${withOutline.long.join(', ')}] ms; Outline Off: ${off.typedMs} ms, long tasks [${off.long.join(', ')}] ms`)
  await setTableOfContents(win, 'Always')
})

test('step 12 — quit', async () => {
  await quitApp(app)
})
