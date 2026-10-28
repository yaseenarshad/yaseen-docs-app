/**
 * The code tab's chips and folds against the REAL app and the real Monaco, where jsdom can not tell:
 *
 * - YAZ-3477 (bug): the page cog's menu shows ABOVE Monaco's sticky scroll lines. Before the fix the
 *   sticky lines (`.sticky-widget`, z-index 4) drew over the menu's top rows. The check hit-tests the
 *   centre of each menu row with `elementFromPoint`, so it reads the real stacking order.
 * - YAZ-3478: the note's fold keys in a code tab (⌘⇧U, ⌘⇧I, ⌘↑, ⌘↓), ⌘End / ⌘Home, the fold chevron's
 *   right-click menu ("Collapse all", "Expand all"), the folds kept through a close and a reopen, and
 *   Monaco's own right-click menu in the app's `.ctx-menu` look (light and dark), above the chips row.
 * - YAZ-3505: `Dockerfile`, `Makefile` and the other well-known names with no extension open, with colours.
 * - YAZ-3479: the 8 file types Monaco does not know get colours: each file shows its keyword, string,
 *   comment and number in the app theme's code colours (`--code-keyword`, …), not in one plain colour.
 * - YAZ-3507: names inside functions are no rows by default; "…" › Show › "Variables inside functions" brings them back.
 * - YAZ-3486: the code Outline with the real Monaco symbols and the real Python helper: ⌘J opens it,
 *   Pin keeps it beside the code, the rows, the filter, collapse, Sort by and Show, the error mark, the
 *   current row following the cursor, a click that opens the folds and jumps, a `.py` file's rows, no
 *   Outline for a `.lua` file, and the 5 MB file: its rows, and the long frames while typing in it.
 * - YAZ-3501 (bug): typing in the 5 MB file: each key draws within a frame, with no long task after a pause.
 * - YAZ-3502 (bug): a quit right after an edit of the 5 MB file: the flush and the app's quit steps are quick.
 * - YAZ-3526 (bug): typing in large CSS, JSON and HTML files: no long task after a pause (step 11b).
 * - YAZ-3503 (bug): Monaco's menu rows are the app's menu rows to the pixel (step 6).
 * - YAZ-3458: LF, CRLF, mixed and BOM files keep their bytes through an edit, a save and a reopen (step 10b).
 *
 * Same harness as viewers.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `codeTab-` screenshots, hidden windows. Keys and the wheel go to the page through Playwright, never
 * to the person's screen. Serial: one launch, each step continuing the last one.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, fileRow, launchApp, layer, menuItem, menuListItem, readState, seededState, shoot, tabsOf } from './helpers'

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

/** YAZ-3505: well-known names with no extension, each with a line its language colours. */
const NAMED: Record<string, { body: string; checks: [text: string, token: string][] }> = {
  Dockerfile: { body: '# a comment\nFROM node:22\nRUN npm ci\n', checks: [['FROM', '--code-keyword'], ['# a comment', '--fg-muted']] },
  'Dockerfile.dev': { body: '# dev image\nFROM node:22\n', checks: [['FROM', '--code-keyword'], ['# dev image', '--fg-muted']] },
  Makefile: { body: '# a comment\nCC ?= clang\nifeq ($(OS),Darwin)\nbuild: deps\n\t@echo "done" $(CC)\nendif\n', checks: [['# a comment', '--fg-muted'], ['CC', '--code-key'], ['ifeq', '--code-keyword'], ['build', '--code-type'], ['"done"', '--code-string']] },
  Jenkinsfile: { body: '// a comment\ndef greet() { return "hi" }\n', checks: [['def', '--code-keyword'], ['"hi"', '--code-string']] },
  Vagrantfile: { body: '# a comment\nVagrant.configure("2") do |config|\nend\n', checks: [['do', '--code-keyword'], ['# a comment', '--fg-muted']] },
  LICENSE: { body: 'MIT License\n\nCopyright (c) 2026\n', checks: [['MIT License', '--fg']] },
}

/** YAZ-3486: `long-class-for-folding.ts`'s shape — `Pipeline` with 40 short methods — and a type error in `step3`. */
const OUTLINE_FILE = 'outline-pipeline.ts'
const outlineMethod = (n: number) => (n === 3 ? `  step3() {\n    const broken: number = 'text'\n    return broken\n  }` : `  step${n}() {\n    const value${n} = ${n}\n    return value${n}\n  }`)
const OUTLINE_BODY = `export class Pipeline {\n${Array.from({ length: 40 }, (_, i) => outlineMethod(i + 1)).join('\n\n')}\n}\n\nexport const LIMIT = 40\n`
const PY_FILE = 'outline_demo.py'
const PY_BODY = 'class Greeter:\n    def hello(self, name: str) -> str:\n        return "hi " + name\n\n\ndef main() -> None:\n    print(Greeter().hello("you"))\n'
const LUA_FILE = 'outline-none.lua'
/** YAZ-3458: a `.py` file over `LARGE_CODE_CHARS` (512 Ki characters): its symbols would be read on the page, so it has none. */
const BIG_PY_FILE = 'outline-big.py'
const BIG_PY_BODY = Array.from({ length: 13_000 }, (_, i) => `class Row${i}:\n    def value(self) -> int:\n        return ${i}\n`).join('\n')
/** `speed/big-5mb.ts`'s shape: 52 000 exported constants, each an object literal of 4 properties. */
const BIG_FILE = 'outline-big-5mb.ts'
const BIG_BODY = `// About 5 MB.\n${Array.from({ length: 52_000 }, (_, i) => `export const value${i} = { id: ${i}, name: 'row ${i}', tags: ['alpha', 'beta', 'gamma'], active: ${i % 2 === 0 ? 'false' : 'true'} }`).join('\n')}\n`

/**
 * YAZ-3526 (bug): large CSS, JSON and HTML files, each over `LARGE_CODE_CHARS`, with a colour and a link on most
 * lines. Monaco's colour and link finders read the whole file after each pause in the typing, and each found
 * colour or link became one decoration on the page's thread.
 */
const hexOf = (i: number) => ((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6)
const BIG_CSS_FILE = 'big-7mb.css'
const BIG_CSS = `${Array.from({ length: 72_000 }, (_, i) => `.row-${i} > .cell { color: #${hexOf(i)}; background-color: rgba(${i % 255}, 20, 30, 0.5); margin: 0 4px; }`).join('\n')}\n`
const BIG_JSON_FILE = 'big-5mb.json'
const BIG_JSON = `${JSON.stringify(Array.from({ length: 46_000 }, (_, i) => ({ id: i, name: `row ${i}`, color: `#${hexOf(i)}`, url: `https://example.com/rows/${i}` })), null, 2)}\n`
const BIG_HTML_FILE = 'big-6mb.html'
const BIG_HTML = `<!doctype html>\n<html>\n<body>\n${Array.from({ length: 52_000 }, (_, i) => `  <div class="row-${i}" style="color: #${hexOf(i)}"><a href="https://example.com/${i}">row ${i}</a> <span>text ${i}</span></div>`).join('\n')}\n</body>\n</html>\n`
const BIG_WEB: { file: string; body: string; line: string }[] = [
  { file: BIG_CSS_FILE, body: BIG_CSS, line: '.row-3 > .cell' },
  { file: BIG_JSON_FILE, body: BIG_JSON, line: '"name": "row 3"' },
  { file: BIG_HTML_FILE, body: BIG_HTML, line: 'class="row-3"' },
]

/**
 * YAZ-3458 (audit item 3; YAZ-3439 "Verification expectations"; YAZ-3445 S1–S4): the real Monaco's line breaks
 * and BOM, byte for byte. Each file gets one key at its very start; the save writes it; the tab closes and opens
 * again; the bytes on disk are the expected bytes, every line break and the BOM kept (a mixed file saves every
 * line with its first break, rule 42).
 */
const BYTES: Record<string, { before: string; after: string }> = {
  'bytes-lf.ts': { before: 'const a = 1\nconst b = 2\n', after: 'qconst a = 1\nconst b = 2\n' },
  'bytes-crlf.json': { before: '{\r\n  "a": 1\r\n}\r\n', after: 'q{\r\n  "a": 1\r\n}\r\n' },
  'bytes-mixed.py': { before: 'first = 1\r\nsecond = 2\nthird = 3\r\n', after: 'qfirst = 1\r\nsecond = 2\r\nthird = 3\r\n' },
  'bytes-bom.ps1': { before: '\ufeffWrite-Host "a"\r\nexit 0\r\n', after: '\ufeffqWrite-Host "a"\r\nexit 0\r\n' },
}

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
  await Promise.all(Object.entries(NAMED).map(([name, t]) => writeFile(path.join(vault, name), t.body)))
  await Promise.all(Object.entries(BYTES).map(([name, { before }]) => writeFile(path.join(vault, name), before)))
  await Promise.all([writeFile(path.join(vault, OUTLINE_FILE), OUTLINE_BODY), writeFile(path.join(vault, PY_FILE), PY_BODY), writeFile(path.join(vault, LUA_FILE), 'local x = 1\nprint(x)\n'), writeFile(path.join(vault, BIG_PY_FILE), BIG_PY_BODY), writeFile(path.join(vault, BIG_FILE), BIG_BODY), ...BIG_WEB.map(({ file, body }) => writeFile(path.join(vault, file), body))])
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
  await expect(rows).toHaveText(['Read only', 'Wrap long lines', 'Minimap', 'Table of contents'].map((label) => new RegExp(`^${label}`)))
  // The checker's nit (YAZ-3458): the first three sit under one heading, "All code files", and each row is one line.
  await expect(layer(win).locator('.page-settings__menu [role="group"]')).toHaveAttribute('aria-label', 'All code files')
  for (const row of await rows.all()) expect((await row.boundingBox())!.height, await row.innerText()).toBeLessThan(30)
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
  // The 400 ms fold write: the keys reach the app state file.
  await expect.poll(async () => (await readState(userData)).folders[vault]?.folds[path.join(vault, FILE)] ?? [], { timeout: 10_000 }).toEqual(['export class Pipeline {', 'step1() {', 'step2() {', 'step3() {', 'step4() {'])
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
    // ⇧⌘O is the app's "Open folder…" (YAZ-3439 "The app's own keys win"): Go to Symbol stays, with no ⇧⌘O hint.
    const keys = await win.evaluate(() => Array.from(document.querySelector('.code-editor__monaco > .shadow-root-host')!.shadowRoot!.querySelectorAll('.action-menu-item')).map((row) => [row.querySelector('.action-label')?.textContent ?? '', row.querySelector('.keybinding')?.textContent ?? '']))
    const goToSymbol = keys.find(([label]) => /^Go to Symbol/.test(label))
    expect(goToSymbol, 'Go to Symbol is still in the menu').toBeDefined()
    expect(goToSymbol![1]).toBe('')
    expect(keys.some(([, key]) => key === '⇧⌘O')).toBe(false)
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

test('step 8b — YAZ-3505: Dockerfile, Makefile and the other well-known names open in a code tab, with colours', async () => {
  for (const [name, t] of Object.entries(NAMED)) {
    await fileRow(win, name).click()
    await expect(lines(win)).toContainText(t.checks[0][0])
    for (const [text, token] of t.checks) {
      const want = await tokenColour(win, token)
      await expect.poll(() => colourOf(win, text), { message: `${name}: ${text}` }).toBe(want)
    }
    if (name === 'Makefile') await shoot(win, 'codeTab-07b-makefile')
  }
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

  // S1: Pipeline, its 40 methods, each with its icon; LIMIT. YAZ-3507: the variable in each method is a name inside a function, so no row by default.
  await expect.poll(() => rowNames(win).then((n) => n.slice(0, 3))).toEqual(['Pipeline', 'step1', 'step2'])
  const runnerHeight = () => outline(win).locator('.outline__runner').evaluate((el) => el.getBoundingClientRect().height)
  expect(await runnerHeight()).toBe((1 + 40 + 1) * 24)
  expect((await rowNames(win)).some((n) => n.startsWith('value') || n === 'broken')).toBe(false)
  await expect(outlineRow(win, 'Pipeline').locator('.outline__icon')).toHaveAttribute('data-family', 'class')
  await expect(outlineRow(win, 'step1').locator('.outline__icon')).toHaveAttribute('data-family', 'method')
  // S6 with the names left out: the error in `broken` marks its method.
  await expect(outlineRow(win, 'step3').locator('.outline__mark')).toHaveAttribute('data-mark', 'error', { timeout: 15_000 })
  await shoot(win, 'codeTab-09-outline-names')

  // YAZ-3507: "…" › Show › "Variables inside functions" brings them back, under their methods.
  await outline(win).getByRole('button', { name: 'More actions' }).click()
  await menuItem(win, 'Show').click()
  await menuListItem(win, 'Variables inside functions').click()
  await expect.poll(() => rowNames(win).then((n) => n.slice(0, 3))).toEqual(['Pipeline', 'step1', 'value1'])
  expect(await runnerHeight()).toBe((1 + 40 * 2 + 1) * 24)
  await shoot(win, 'codeTab-09a-outline-variables-inside-functions')

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

  // YAZ-3506: the cog's "Table of contents" row hides the panel of this file only; on brings it back.
  await expect(outline(win)).toHaveAttribute('aria-label', 'Table of contents')
  await layer(win).locator('.page-settings__trigger').click()
  await layer(win).locator('.page-settings__menu button', { hasText: /^Table of contents/ }).click()
  await expect(outline(win)).toHaveCount(0)
  await win.keyboard.press('Escape')
  await shoot(win, 'codeTab-12b-toc-off-for-this-file')
  await layer(win).locator('.page-settings__trigger').click()
  await layer(win).locator('.page-settings__menu button', { hasText: /^Table of contents/ }).click()
  await win.keyboard.press('Escape')
  await expect(outline(win)).toHaveCount(1)
  await expect(outline(win).locator('.outline__row[aria-current="true"] .outline__name')).toHaveText('step25')
})

test('step 10 — YAZ-3486 S10, S11: a .py file lists its class and functions; a .lua file has no Outline; nor has a large .py file (YAZ-3458)', async () => {
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
  // YAZ-3458: a large .py file reads no symbol on the page, so it has no table of contents.
  expect(BIG_PY_BODY.length).toBeGreaterThan(512 * 1024)
  await fileRow(win, BIG_PY_FILE).click()
  await expect(lines(win)).toContainText('class Row0')
  await win.waitForTimeout(800)
  await expect(outline(win)).toHaveCount(0)
})

test('step 10b — YAZ-3458: LF, CRLF, mixed and BOM files: one key, the save, close and reopen: the bytes on disk are exact', async () => {
  test.setTimeout(60_000)
  for (const [name, { before, after }] of Object.entries(BYTES)) {
    const file = path.join(vault, name)
    await fileRow(win, name).click()
    await expect(lines(win)).toContainText(before.replace('\ufeff', '').split(/\r?\n/)[0])
    await code(win).locator('.view-line').first().click()
    await win.keyboard.press('Meta+Home')
    await win.keyboard.type('q')
    await expect.poll(async () => (await readFile(file)).equals(Buffer.from(after, 'utf8')), { timeout: 10_000, message: name }).toBe(true)
    await tabsOf(win).filter({ hasText: name }).locator('..').locator('.tabbar__close').click()
    await expect(code(win)).toHaveCount(0)
    await fileRow(win, name).click()
    await expect(lines(win)).toContainText(`q${before.replace('\ufeff', '').split(/\r?\n/)[0]}`)
    // Opening writes nothing: the bytes stay the ones the save wrote.
    await win.waitForTimeout(700)
    expect((await readFile(file)).equals(Buffer.from(after, 'utf8')), name).toBe(true)
  }
})

/**
 * Types 20 keys at the start of a line of the big file the way a person types: 4 bursts of 5 keys 100 ms
 * apart, with a 700 ms pause after each, so each pause sets off what waits for one (the Outline's read
 * 300 ms after the last edit, sticky scroll's, the autosave). Then 2.5 s more. Per key: keydown → the next
 * frame → the next task, as `tools/perf`'s `typing` scenario measures it; and every long task, ms.
 */
async function typeAndWatch(w: Page, lineText: string): Promise<{ keys: number[]; long: number[] }> {
  await code(w).locator('.view-line', { hasText: lineText }).first().click()
  await w.evaluate(() => {
    const g = window as unknown as { __long: number[]; __keys: number[]; __observer?: PerformanceObserver; __keyProbe?: boolean }
    g.__observer?.disconnect()
    g.__long = []
    g.__keys = []
    g.__observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => g.__long.push(Math.round(e.duration))))
    g.__observer.observe({ type: 'longtask' })
    if (g.__keyProbe === true) return
    g.__keyProbe = true
    window.addEventListener('keydown', (e) => requestAnimationFrame(() => setTimeout(() => g.__keys.push(Math.round(performance.now() - e.timeStamp)))), true)
  })
  for (let burst = 0; burst < 4; burst++) {
    for (let i = 0; i < 5; i++) await w.keyboard.type('x', { delay: 100 })
    await w.waitForTimeout(700)
  }
  await w.waitForTimeout(2500)
  const result = await w.evaluate(() => {
    const g = window as unknown as { __long: number[]; __keys: number[] }
    return { keys: [...g.__keys], long: [...g.__long] }
  })
  for (let i = 0; i < 20; i++) await w.keyboard.press('Backspace')
  await w.waitForTimeout(1500)
  return result
}

const median = (list: readonly number[]): number => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]

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

test('step 11 — YAZ-3486 S12, YAZ-3501: the 5 MB file: its Outline, and each key draws at once (with the Outline, and Off)', async () => {
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
  console.log(`[YAZ-3486 S12, YAZ-3501] ${BIG_FILE}: code shown ${shownMs} ms, Outline rows ${outlineMs} ms after the click; ${runner / 24} rows, ${drawn} drawn. 20 keys in 4 bursts — with the Outline: keys [${withOutline.keys.join(', ')}] ms, long tasks [${withOutline.long.join(', ')}] ms; Outline Off: keys [${off.keys.join(', ')}] ms, long tasks [${off.long.join(', ')}] ms`)
  // YAZ-3501: before the fix each pause in the typing cost the page 470–690 ms (sticky scroll's and the
  // Outline's symbols, read on the page's thread), and a key typed then waited for it. Now the usual key
  // draws in under one frame (16 ms), and no task holds a key for long.
  for (const run of [withOutline, off]) {
    expect(run.keys).toHaveLength(20)
    expect(median(run.keys)).toBeLessThan(16)
    expect(Math.max(...run.keys)).toBeLessThan(100)
    expect(Math.max(0, ...run.long)).toBeLessThan(200)
  }
  await setTableOfContents(win, 'Always')
})

/**
 * YAZ-3502: quit right after an edit of the 5 MB file. Main writes a time stamp at each step of the quit
 * (`before-quit`, the window's `app:flushed`, the window gone, `app.exit`) into a file of the temp profile,
 * because the process is gone when the test reads them. The app's own quit work must be quick, and the
 * edit must be on disk. The end of the Electron process after `app.exit(0)` is not the app's work: on a
 * Mac with a load average over 100 it took from 1.6 s to over 60 s, for a 100-line file as for this one
 * (YAZ-3502 root cause). So the wait for the process to end has a wider cap than `quitApp`'s 15 s.
 */
test('step 11b — YAZ-3526: large CSS, JSON and HTML files: each key draws at once, and no long task after a pause', async () => {
  test.setTimeout(240_000)
  const runs: { keys: number[]; long: number[] }[] = []
  for (const { file, body, line } of BIG_WEB) {
    expect(body.length).toBeGreaterThan(5 * 1024 * 1024)
    await fileRow(win, file).click()
    await expect(lines(win)).toContainText(line, { timeout: 30_000 })
    // The first read of the whole file (the open itself) is not what this step measures.
    await win.waitForTimeout(3000)
    const run = await typeAndWatch(win, line)
    runs.push(run)
    console.log(`[YAZ-3526] ${file} (${(body.length / 1024 / 1024).toFixed(1)} MB): keys [${run.keys.join(', ')}] ms, long tasks [${run.long.join(', ')}] ms`)
  }
  // Before the fix a 7 MB CSS file gave a long task of 300 to 390 ms after a pause (the colour finder), and a
  // 6 MB HTML file one of about 200 ms (the link finder). A key typed during one of them waited for it.
  for (const run of runs) {
    expect(run.keys).toHaveLength(20)
    expect(median(run.keys)).toBeLessThan(16)
    expect(Math.max(...run.keys)).toBeLessThan(100)
    expect(Math.max(0, ...run.long)).toBeLessThan(200)
  }
})

test('step 12 — YAZ-3502: quit right after an edit of the 5 MB file: the flush and the app\'s quit steps are quick, and the edit is on disk', async () => {
  test.setTimeout(120_000)
  await fileRow(win, BIG_FILE).click()
  await code(win).locator('.view-line', { hasText: 'export const value7 =' }).first().click()
  await win.keyboard.press('Home')
  await win.keyboard.type('q')
  await expect(lines(win)).toContainText('qexport const value7 =')
  const stamps = path.join(userData, 'quit-stamps.txt')
  await app.evaluate(({ app: electronApp, ipcMain, BrowserWindow }, file) => {
    const fs = process.mainModule!.require('node:fs') as typeof import('node:fs')
    fs.writeFileSync(file, '')
    const stamp = (step: string) => fs.appendFileSync(file, `${step} ${Date.now()}\n`)
    electronApp.once('before-quit', () => stamp('before-quit'))
    ipcMain.once('app:flushed', () => stamp('flushed'))
    for (const w of BrowserWindow.getAllWindows()) w.once('closed', () => stamp('closed'))
    const exit = electronApp.exit.bind(electronApp)
    electronApp.exit = (code?: number) => {
      stamp('exit')
      exit(code)
    }
  }, stamps)
  const t0 = Date.now()
  await Promise.race([app.close(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the app process did not end within 60 s of app.close()')), 60_000))])
  const goneMs = Date.now() - t0
  const at = Object.fromEntries((await readFile(stamps, 'utf8')).trim().split('\n').map((line) => line.split(' ')).map(([step, ms]) => [step, Number(ms)]))
  const since = (step: string) => at[step] - at['before-quit']
  console.log(`[YAZ-3502] quit after an edit of ${BIG_FILE}: flushed +${since('flushed')} ms, window gone +${since('closed')} ms, app.exit +${since('exit')} ms; the process ended ${goneMs} ms after app.close()`)
  // The renderer's flush wrote the 5 MB text with the edit, and every quit step of the app ran in time.
  expect(since('flushed')).toBeLessThan(1500)
  expect(since('closed')).toBeLessThan(1500)
  // `stopHelpers` may wait up to its 2 s cap for a language helper (`lsp/server.ts`).
  expect(since('exit')).toBeLessThan(3500)
  expect(await readFile(path.join(vault, BIG_FILE), 'utf8')).toContain('\nqexport const value7 = { id: 7,')
})
