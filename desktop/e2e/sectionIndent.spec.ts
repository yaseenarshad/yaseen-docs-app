/**
 * Section indent, in the REAL app (YAZ-2709): a note that uses headings reads like a bullet note.
 *  - THE SWITCH is "Section indent" in the page cog, beside "Line numbers", and it starts off.
 *  - THE INDENT: each block stands one step in for each section that holds it. The mark is `data-sd`
 *    on the block, and the indent is the block's own left border: 30px a step at the default.
 *  - THE PATH: the lines on the way to the caret are purple. The mark is `data-sp`, how many of the
 *    block's lines, and it stops at the caret's block.
 *  - A CLICK ON A LINE folds the sections beside it, a second click opens them, and the caret stays.
 *  - IT IS A VIEW: the file on disk has the same bytes after all of it, proven after a real quit
 *    (the autosave flush point).
 *  - THE SWITCH IS SAVED with the note in the state file of the app (YAZ-2731,
 *    `folders[root].sectionIndents`), on AND off, and never in the note: it is on again after a
 *    restart.
 *
 * Same harness as every spec here: temp `--user-data-dir`, a COPY of the fixture vault with one
 * note of this spec's own in it, `section-indent-` step screenshots. Serial: each step continues
 * the last.
 */
// Written for YAZ-2709, and step 7 for YAZ-2731. Not yet run: Playwright was off limits when this was written, so every
// selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, editorOf, launchApp, layer, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Trip.md'
const INTRO = 'intro-text-e2e'
const KYOTO = 'kyoto-text-e2e'
const TEMPLES = 'temples-text-e2e'
const OSAKA = 'osaka-text-e2e'
/** An H1 that holds two H2 sections, the first with an H3 section in it: three levels of nesting. */
const BODY = `# Trip

${INTRO}

## Kyoto

${KYOTO}

### Temples

${TEMPLES}

## Osaka

${OSAKA}
`

/** `[text, data-sd, data-sp]` of each block, in page order, with the switch on and the caret in the H1. */
const INDENTED = [
  ['Trip', null, null], // the top heading of the note stands at the edge
  [INTRO, '1', null],
  ['Kyoto', '1', null], // a heading stands with the text of the section that holds it
  [KYOTO, '2', null],
  ['Temples', '2', null],
  [TEMPLES, '3', null],
  ['Osaka', '1', null],
  [OSAKA, '2', null],
]
/** The same with the caret in the H3's text: line 1 is purple from the H1 down, line 2 from Kyoto, line 3 from Temples. */
const ON_PATH = [
  ['Trip', null, null],
  [INTRO, '1', '1'],
  ['Kyoto', '1', '1'],
  [KYOTO, '2', '2'],
  ['Temples', '2', '2'],
  [TEMPLES, '3', '3'],
  ['Osaka', '1', null], // the path stops at the caret's block
  [OSAKA, '2', null],
]

let userData: string
let vaultSrc: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const cog = (w: Page) => layer(w).locator('.page-settings__trigger')
const menu = (w: Page) => layer(w).locator('.page-settings__menu')
const indentSwitch = (w: Page) => menu(w).locator('button[aria-pressed]', { hasText: 'Section indent' })
const host = (w: Page) => layer(w).locator('.editor-host')
const paragraph = (w: Page, text: string) => editorOf(w).locator(`p:text-is("${text}")`)
const heading = (w: Page, level: 1 | 2 | 3, text: string) => editorOf(w).locator(`h${level}`, { hasText: text })
const expandToggle = (w: Page, label: string) => editorOf(w).locator(`.heading-toggle[aria-label="Expand ${label}"]`)

/**
 * Each heading and paragraph of the note, in page order: its text and its two marks. `data-sp` is
 * built from `state.selection.$from` (sectionIndent.ts), so it is ProseMirror's OWN answer to where
 * the caret is, read back off the DOM, and a folded block still carries it.
 */
const blocks = (w: Page): Promise<(string | null)[][]> =>
  editorOf(w).evaluate((page) =>
    Array.from(page.children)
      .filter((el) => /^(H[1-6]|P)$/.test(el.tagName))
      .map((el) => [el.textContent ?? '', el.getAttribute('data-sd'), el.getAttribute('data-sp')]),
  )

/** The widths of a block's first four lines as the CSS drew them: the path's are bullet threading's 2px, a grey line is 1px. */
const lineWidths = (block: Locator): Promise<string[]> =>
  block.evaluate((el) => ['--w1', '--w2', '--w3', '--w4'].map((name) => getComputedStyle(el).getPropertyValue(name).trim()))

/** The DOM caret: the text of the top-level block it is in, and how far into it. Null with no selection in the note. */
const caret = (w: Page): Promise<{ text: string; offset: number } | null> =>
  editorOf(w).evaluate((page) => {
    const sel = document.getSelection()
    const node = sel === null ? null : sel.anchorNode
    if (sel === null || node === null) return null
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    const block = Array.from(page.children).find((child) => el !== null && child.contains(el))
    return block === undefined ? null : { text: block.textContent ?? '', offset: sel.anchorOffset }
  })

/**
 * A point ON line 1 of `block`, in window coordinates. Line k is drawn one third into step k
 * (sectionIndent.css), so line 1 is 10px into the first 30px step. Measured from the block's box,
 * which starts at the column's edge: the indent is the block's own border.
 */
async function onFirstLine(block: Locator): Promise<{ x: number; y: number }> {
  const box = await block.boundingBox()
  if (box === null) throw new Error('a block with no box has no line to click')
  return { x: box.x + 10, y: box.y + box.height / 2 }
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sectionindent-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a note with H1, H2 and H3 sections opens with the switch off and nothing moved in', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(paragraph(win, OSAKA)).toBeVisible()

  await expect(layer(win).locator('.editor-host[data-section-indent]')).toHaveCount(0)
  await expect(editorOf(win).locator('[data-sd], [data-sp]')).toHaveCount(0)
  await expect(paragraph(win, KYOTO)).toHaveCSS('border-left-width', '0px')
})

test('step 2 — "Section indent" in the page cog moves each block in, one step for each section that holds it', async () => {
  await cog(win).click()
  await expect(menu(win)).toBeVisible()
  await expect(indentSwitch(win)).toHaveAttribute('aria-pressed', 'false')
  await indentSwitch(win).click()
  await expect(menu(win)).toBeVisible() // the menu stays open, so the check mark shows
  await expect(indentSwitch(win)).toHaveAttribute('aria-pressed', 'true')
  await expect(host(win)).toHaveAttribute('data-section-indent', 'true')
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)

  // Steps count by nesting: the H1 at the edge, its text and its H2s one step in, an H2's text two.
  await expect.poll(() => blocks(win)).toEqual(INDENTED)
})

test('step 3 — the text of the H2 section stands one step in from its heading: 30px at the default step', async () => {
  // The 1100px window gives the note a column wider than 480px, so one step is the setting's 30px and not the narrow note's 18px.
  await expect(heading(win, 1, 'Trip')).toHaveCSS('border-left-width', '0px')
  await expect(paragraph(win, INTRO)).toHaveCSS('border-left-width', '30px')
  await expect(heading(win, 2, 'Kyoto')).toHaveCSS('border-left-width', '30px')
  await expect(paragraph(win, KYOTO)).toHaveCSS('border-left-width', '60px')
  await expect(heading(win, 3, 'Temples')).toHaveCSS('border-left-width', '60px')
  await expect(paragraph(win, TEMPLES)).toHaveCSS('border-left-width', '90px')
  await shoot(win, 'section-indent-01-on')
})

test('step 4 — the caret in the H3 section: three purple lines lead to it, and stop at its block', async () => {
  await paragraph(win, TEMPLES).click()
  await expect.poll(() => blocks(win)).toEqual(ON_PATH)
  await expect(paragraph(win, TEMPLES)).toHaveAttribute('data-sp', '3')
  // Three of its lines take bullet threading's width (2px, the default), and no fourth: that one keeps a grey line's 1px.
  await expect.poll(() => lineWidths(paragraph(win, TEMPLES))).toEqual(['2px', '2px', '2px', '1px'])
  // A block after the caret's has no purple line at all.
  await expect.poll(() => lineWidths(paragraph(win, OSAKA))).toEqual(['1px', '1px', '1px', '1px'])
  await shoot(win, 'section-indent-02-path')
})

test('step 5 — a click on the line below the H1 folds the H2 sections, a second click opens them, and the caret stays', async () => {
  const caretBefore = await caret(win)
  expect(caretBefore?.text).toBe(TEMPLES)

  // The H1's line, beside the H1's own text: a block that no fold of an H2 hides.
  const { x, y } = await onFirstLine(paragraph(win, INTRO))
  await win.mouse.move(x, y)
  await expect(editorOf(win)).toHaveClass(/section-line-hover/) // the pointer shows a hand over a line
  await win.mouse.click(x, y)

  // Both H2 sections are closed, the H3 section inside the first with them; the H1's own text stays.
  await expect(expandToggle(win, 'Kyoto')).toBeAttached()
  await expect(expandToggle(win, 'Osaka')).toBeAttached()
  await expect(paragraph(win, KYOTO)).toBeHidden()
  await expect(heading(win, 3, 'Temples')).toBeHidden()
  await expect(paragraph(win, TEMPLES)).toBeHidden()
  await expect(paragraph(win, OSAKA)).toBeHidden()
  await expect(heading(win, 2, 'Kyoto')).toBeVisible()
  await expect(heading(win, 2, 'Osaka')).toBeVisible()
  await expect(paragraph(win, INTRO)).toBeVisible()
  // The caret did not go to the block that was clicked: the path still ends in the H3's text.
  expect(await blocks(win)).toEqual(ON_PATH)
  await shoot(win, 'section-indent-03-folded')

  // The same click again: nothing beside the line is open, so they all open.
  await win.mouse.click(x, y)
  await expect(editorOf(win).locator('[data-heading-folded="true"]')).toHaveCount(0)
  await expect(expandToggle(win, 'Kyoto')).toHaveCount(0)
  await expect(expandToggle(win, 'Osaka')).toHaveCount(0)
  await expect(paragraph(win, KYOTO)).toBeVisible()
  await expect(paragraph(win, TEMPLES)).toBeVisible()
  await expect(paragraph(win, OSAKA)).toBeVisible()
  expect(await blocks(win)).toEqual(ON_PATH)
  await expect.poll(() => caret(win)).toEqual(caretBefore)
  await shoot(win, 'section-indent-04-open')
})

test('step 6 — the file on disk has the same bytes as at the start', async () => {
  await quitApp(app) // the autosave flush point: a pending write would land here
  // The note is plain ASCII, so the same text is the same bytes.
  expect(await readFile(notePath, 'utf8')).toBe(BODY)
})

test('step 7 — the switch is saved for the note in the state file of the app: on again after the restart, and off is saved too', async () => {
  // Step 6 quit the app. The state file has the switch of this note, and of no other note.
  expect((await readState(userData)).folders[vault]?.sectionIndents).toEqual({ [notePath]: true })

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(paragraph(win, OSAKA)).toBeVisible()
  await expect(host(win)).toHaveAttribute('data-section-indent', 'true')
  await expect(paragraph(win, KYOTO)).toHaveCSS('border-left-width', '60px')
  await cog(win).click()
  await expect(indentSwitch(win)).toHaveAttribute('aria-pressed', 'true')
  await shoot(win, 'section-indent-05-after-restart')

  // Off is a value of its own (YAZ-2711 D2): the entry stays, as `false`.
  await indentSwitch(win).click()
  await expect(indentSwitch(win)).toHaveAttribute('aria-pressed', 'false')
  await expect(editorOf(win).locator('[data-sd], [data-sp]')).toHaveCount(0)
  await expect.poll(async () => (await readState(userData)).folders[vault]?.sectionIndents[notePath], { timeout: 10_000 }).toBe(false)
  expect(await readFile(notePath, 'utf8')).toBe(BODY)
})
