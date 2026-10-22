/**
 * Read only, in the REAL app (YAZ-3076): the human's switch, stored IN the file.
 *  - ON from the page cog's first row, at once, with no question: the file gets `readonly: true`
 *    and a "Read only" chip with a lock shows beside the cog.
 *  - TYPING CHANGES NOTHING while it is on: the note on disk keeps its bytes after the autosave's
 *    time has passed.
 *  - OFF only through the chip: a click opens "Allow edits?", and "Allow edits" removes the key —
 *    the file is its own bytes again — and the chip goes.
 *  - THEN TYPING SAVES as before.
 *
 *  - A DIAGRAM (YAZ-3119, YAZ-3121): "Read only" on leaves the keyboard on the host, so Esc still
 *    closes the cog menu; and a press inside the draw.io frame closes the menu, as a press outside
 *    closes it on a note.
 *  - A FOLDER'S TABLE (YAZ-3122): a read-only note's cell shows its value, says "This note is read
 *    only", and a double-click opens no editor; the note beside it still edits; nothing is written.
 *
 * Same harness as every spec here: temp `--user-data-dir`, a COPY of the fixture vault with one
 * note of this spec's own in it, hidden windows (`YASEEN_DOCS_E2E_HIDDEN`), `read-only-` step
 * screenshots. Serial: each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setFrontmatterProperty } from '../../shared/frontmatter'
import { appWindow, buildFixtureVault, contents, copyVault, editorOf, fileRow, launchApp, layer, openFolder, quitApp, seededState, shoot, viewTabs } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Locked note.md'
const DIAGRAM = 'Locked flow.drawio'
/** A one-box diagram, as draw.io writes one: the box's text is how the steps find it in the frame. */
const ONE_BOX = [
  '<mxfile>',
  '  <diagram id="p1" name="Page-1">',
  '    <mxGraphModel grid="0" page="0">',
  '      <root>',
  '        <mxCell id="0" />',
  '        <mxCell id="1" parent="0" />',
  '        <mxCell id="c1" value="Hello box" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1">',
  '          <mxGeometry x="40" y="40" width="160" height="80" as="geometry" />',
  '        </mxCell>',
  '      </root>',
  '    </mxGraphModel>',
  '  </diagram>',
  '</mxfile>',
  '',
].join('\n')
const LINE = 'read-only-line-e2e'
const BODY = `---\nstatus: draft\n---\n# Locked\n\n${LINE}\n`
const LOCKED = `---\nstatus: draft\nreadonly: true\n---\n# Locked\n\n${LINE}\n`

let userData: string
let vaultSrc: string
let vault: string
let notePath: string
/** A read-only outline (YAZ-3125, D8): every view action of a note, with the mouse and with its key. */
const OUTLINE_NOTE = 'Locked outline.md'
const OUTLINE_BODY = '---\nreadonly: true\n---\n- parent-e2e\n  - child-e2e\n- other-e2e [[Ideas]]\n'
let outlinePath: string
let diagramPath: string
let app: ElectronApplication
let win: Page

const cog = (w: Page) => layer(w).locator('.page-settings__trigger')
const menu = (w: Page) => layer(w).locator('.page-settings__menu')
const readOnlyRow = (w: Page) => menu(w).locator('button[aria-pressed]', { hasText: 'Read only' })
const chip = (w: Page) => layer(w).locator('.read-only-chip__button')
const askBox = (w: Page) => layer(w).locator('.read-only-chip__ask')
const line = (w: Page) => editorOf(w).locator(`p:text-is("${LINE}")`)
const onDisk = (): Promise<string> => readFile(notePath, 'utf8')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'readonly-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
  outlinePath = path.join(vault, OUTLINE_NOTE)
  await writeFile(outlinePath, OUTLINE_BODY)
  diagramPath = path.join(vault, DIAGRAM)
  await writeFile(diagramPath, ONE_BOX)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the note opens editable: no chip, and "Read only" is the cog’s first row, off', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(line(win)).toBeVisible()
  await expect(chip(win)).toHaveCount(0)
  await cog(win).click()
  await expect(menu(win).locator('button').first()).toHaveText('Read only')
  await expect(readOnlyRow(win)).toHaveAttribute('aria-pressed', 'false')
})

test('step 2 — the row turns it on at once: the key is in the file, the chip shows, nothing asked', async () => {
  await readOnlyRow(win).click()
  await expect.poll(onDisk).toBe(LOCKED)
  await expect(readOnlyRow(win)).toHaveAttribute('aria-pressed', 'true')
  await expect(askBox(win)).toHaveCount(0)
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)
  await expect(chip(win)).toHaveText('Read only')
  await expect(chip(win)).toHaveAttribute('title', 'Click to allow edits')
  await expect(editorOf(win)).toHaveAttribute('contenteditable', 'false')
  await shoot(win, 'read-only-1-on')
})

test('step 3 — typing changes nothing: the file keeps its bytes past the autosave', async () => {
  await line(win).click()
  await win.keyboard.press('Meta+ArrowRight')
  await win.keyboard.type(' typed-while-locked', { delay: 5 })
  await win.waitForTimeout(1500)
  expect(await onDisk()).toBe(LOCKED)
  await expect(line(win)).toBeVisible()
  await expect(layer(win).locator('.conflict-bar')).toHaveCount(0)
})

test('step 3b — YAZ-3125: the view-action keys still answer — ⌘⇧U folds the heading section, ⌘⇧I unfolds it; the file keeps its bytes', async () => {
  await editorOf(win).locator('h1', { hasText: 'Locked' }).click()
  await win.keyboard.press('Meta+Shift+U')
  await expect(line(win)).toBeHidden()
  await win.keyboard.press('Meta+Shift+I')
  await expect(line(win)).toBeVisible()
  await win.waitForTimeout(700)
  expect(await onDisk()).toBe(LOCKED)
})

test('step 3c — D8: a read-only outline keeps every view action, with the mouse and with its key; nothing is written', async () => {
  await fileRow(win, 'Locked outline').click()
  const item = (text: string) => editorOf(win).locator('li', { hasText: text }).first()
  const shown = (text: string) => editorOf(win).locator(`p:text-is("${text}")`)
  await expect(shown('parent-e2e')).toBeVisible()
  await expect(chip(win)).toHaveText('Read only')
  // A chevron click folds and unfolds one bullet.
  await item('parent-e2e').hover()
  await item('parent-e2e').locator('.outline-toggle').first().click()
  await expect(shown('child-e2e')).toBeHidden()
  await item('parent-e2e').locator('.outline-toggle').first().click()
  await expect(shown('child-e2e')).toBeVisible()
  // ⌘↑ / ⌘↓ at the clicked bullet, and ⌘Z puts back the fold.
  await shown('parent-e2e').click()
  await win.keyboard.press('Meta+ArrowUp')
  await expect(shown('child-e2e')).toBeHidden()
  await win.keyboard.press('Meta+ArrowDown')
  await expect(shown('child-e2e')).toBeVisible()
  await win.keyboard.press('Meta+ArrowUp')
  await win.keyboard.press('Meta+z')
  await expect(shown('child-e2e')).toBeVisible()
  // ⌘. zooms into the bullet and ⌘⇧. zooms back out.
  await shown('parent-e2e').click()
  await win.keyboard.press('Meta+Period')
  await expect(shown('other-e2e')).toBeHidden()
  await win.keyboard.press('Meta+Shift+Period')
  await expect(editorOf(win).locator('p', { hasText: 'other-e2e' })).toBeVisible()
  // A click on the bullet's glyph zooms in; the breadcrumb's first crumb zooms out.
  await item('parent-e2e').locator('.label-wrapper').first().click()
  await expect(editorOf(win).locator('p', { hasText: 'other-e2e' })).toBeHidden()
  await layer(win).locator('[aria-label="Zoom breadcrumbs"] button').first().click()
  await expect(editorOf(win).locator('p', { hasText: 'other-e2e' })).toBeVisible()
  // ⌘F finds in the note.
  await shown('parent-e2e').click()
  await win.keyboard.press('Meta+f')
  await layer(win).locator('.find-bar__input').fill('child-e2e')
  await expect(layer(win).locator('.find-bar__count')).toHaveText('1 of 1')
  await win.keyboard.press('Escape')
  // Line numbers from the cog.
  await cog(win).click()
  await menu(win).locator('button[aria-pressed]', { hasText: 'Line numbers' }).click()
  await expect(editorOf(win).locator('[data-line]').first()).toBeVisible()
  await win.keyboard.press('Escape')
  // A selection of the text (copy is the native one; the spec never writes the system clipboard).
  // (A drag: a synthetic double-click selects no word in this harness, in an editable note too.)
  const box = (await shown('child-e2e').boundingBox())!
  await win.mouse.move(box.x + 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 })
  await win.mouse.up()
  expect(await win.evaluate(() => document.getSelection()?.toString())).toContain('child-e2e')
  await win.waitForTimeout(700)
  expect(await readFile(outlinePath, 'utf8')).toBe(OUTLINE_BODY)
  // A link still opens: the wiki link goes to its note.
  await editorOf(win).locator('.wikilink', { hasText: 'Ideas' }).first().click()
  await expect(layer(win).locator('.page-title__text')).toHaveText('Ideas')
  expect(await readFile(outlinePath, 'utf8')).toBe(OUTLINE_BODY)
  await fileRow(win, 'Locked note').click()
  await expect(line(win)).toBeVisible()
})

test('step 3d — YAZ-3127: in a read-only body, ⌘C / ⌘X / ⌘V never reach the FILE clipboard, ↓ stays in the note, ⌘A selects only the note', async () => {
  // The note's sidebar row is the selected row (step 3c ended by clicking it): the case the file clipboard would take.
  const vaultFiles = async (): Promise<string[]> => (await readdir(vault)).sort()
  const before = await vaultFiles()
  const box = (await line(win).boundingBox())!
  await win.mouse.move(box.x + 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 })
  await win.mouse.up()
  const clip = () => win.evaluate(() => (window as unknown as { yaseenDocs: { file: { clipState(): Promise<unknown> } } }).yaseenDocs.file.clipState())
  // The chord as the app's own listeners hear it, dispatched where the keyboard is. A synthetic key
  // runs no NATIVE copy or paste, so the spec never touches the system clipboard; what it pins is
  // that no app listener takes the chord (`defaultPrevented` stays false) and nothing reaches the
  // FILE clipboard or the vault.
  const chord = (key: string) =>
    win.evaluate((k) => {
      const target = document.activeElement ?? document.body
      const event = new KeyboardEvent('keydown', { key: k, code: `Key${k.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }, key)
  expect(await chord('c')).toBe(false) // the note's own text copy goes ahead
  expect(await clip()).toBeNull()
  expect(await chord('x')).toBe(false)
  expect(await clip()).toBeNull()
  await chord('v')
  await win.waitForTimeout(500)
  expect(await vaultFiles()).toEqual(before)
  await expect(layer(win).locator('.read-only-chip__button')).toHaveCount(1)
  // ↓ stays in the note: never to a sidebar row.
  await line(win).click()
  await win.keyboard.press('ArrowDown')
  expect(await win.evaluate(() => document.activeElement?.closest('.tree__row') === null)).toBe(true)
  // ⌘A selects the note's text, not the page chrome around it.
  await win.keyboard.press('Meta+a')
  const all = await win.evaluate(() => document.getSelection()?.toString() ?? '')
  expect(all).toContain(LINE)
  expect(all).not.toContain('Read only')
  expect(all).not.toContain('100%')
  expect(await readFile(notePath, 'utf8')).toBe(LOCKED)
})

test('step 4 — the chip asks "Allow edits?"; "Allow edits" removes the key and the chip', async () => {
  await chip(win).click()
  await expect(askBox(win)).toContainText('Allow edits?')
  await expect(askBox(win).getByRole('button', { name: 'Allow edits' })).toBeFocused()
  await shoot(win, 'read-only-2-ask')
  await win.keyboard.press('Enter')
  await expect.poll(onDisk).toBe(BODY)
  await expect(chip(win)).toHaveCount(0)
  await expect(editorOf(win)).toHaveAttribute('contenteditable', 'true')
})

test('step 5 — typing saves again', async () => {
  await line(win).click()
  await win.keyboard.press('Meta+ArrowRight')
  await win.keyboard.type(' typed-after-allow', { delay: 5 })
  await expect.poll(onDisk).toContain(`${LINE} typed-after-allow`)
  expect(await onDisk()).not.toContain('readonly')
  await quitApp(app)
})

const frameBox = (w: Page) => layer(w).frameLocator('iframe.drawio-editor__frame').getByText('Hello box', { exact: true })
/** Where the keyboard is in the host page: the tag and class of `document.activeElement`. */
const hostFocus = (w: Page): Promise<string> => w.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)

test('step 6 — a diagram opens editable in draw.io, with the cog first in its strip', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, diagramPath) })
  win = await appWindow(app, 'w1')
  await expect(frameBox(win)).toBeVisible({ timeout: 30_000 })
  await expect(layer(win).locator('.drawio-editor__chips > :first-child')).toHaveClass(/page-settings/)
  await expect(chip(win)).toHaveCount(0)
})

test('step 7 — YAZ-3119: "Read only" on keeps the keyboard on the host, so Esc closes the menu and the focus goes to the cog', async () => {
  await cog(win).click()
  await readOnlyRow(win).click()
  await expect.poll(() => readFile(diagramPath, 'utf8')).toContain('yaseendraw-readonly="1"')
  await expect(readOnlyRow(win)).toHaveAttribute('aria-pressed', 'true')
  // draw.io has the switch now: give its message time to land before the focus is read.
  await win.waitForTimeout(500)
  expect(await hostFocus(win)).not.toMatch(/^IFRAME/)
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)
  expect(await hostFocus(win)).toMatch(/page-settings__trigger/)
  await shoot(win, 'read-only-3-diagram-on')
})

test('step 8 — YAZ-3121: a press inside the draw.io frame closes the cog menu', async () => {
  await cog(win).click()
  await expect(menu(win)).toHaveCount(1)
  await frameBox(win).click()
  await expect(menu(win)).toHaveCount(0)
})

test('step 9 — "Allow edits" turns the diagram back, the same bytes as before', async () => {
  await chip(win).click()
  await askBox(win).getByRole('button', { name: 'Allow edits' }).click()
  await expect.poll(() => readFile(diagramPath, 'utf8')).toBe(ONE_BOX)
  await expect(chip(win)).toHaveCount(0)
})

test('step 9b — YAZ-3123: with a label being typed, "Read only" on still keeps the menu open and the keyboard on the host', async () => {
  await frameBox(win).dblclick()
  await win.keyboard.type('ZZ')
  await cog(win).click()
  expect(await hostFocus(win)).toMatch(/page-settings__trigger/)
  await readOnlyRow(win).click()
  await expect.poll(() => readFile(diagramPath, 'utf8')).toContain('yaseendraw-readonly="1"')
  await win.waitForTimeout(500)
  await expect(menu(win)).toHaveCount(1)
  await expect(readOnlyRow(win)).toHaveAttribute('aria-pressed', 'true')
  expect(await hostFocus(win)).not.toMatch(/^IFRAME/)
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)
  expect(await hostFocus(win)).toMatch(/page-settings__trigger/)
  // The typed label was cancelled, never saved (YAZ-3116 A2).
  expect(await readFile(diagramPath, 'utf8')).not.toContain('ZZ')
  await quitApp(app)
})

const BIBLE = path.join(__dirname, 'fixtures', 'bible-vault')
let bible: string

test('step 10 — YAZ-3122, YAZ-3126: in a folder\u2019s table, a read-only note\u2019s cell opens no editor and says why, and a lock follows its name; the next note still edits', async () => {
  bible = await copyVault(BIBLE)
  const cac = path.join(bible, 'KPIs', 'CAC.md')
  const locked = setFrontmatterProperty(await readFile(cac, 'utf8'), 'readonly', true)
  await writeFile(cac, locked)
  app = await launchApp({ userData, seedState: seededState(bible, null) })
  win = await appWindow(app, 'w1')
  await openFolder(win, path.join(bible, 'KPIs'))
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  const cell = (r: number, c: number) => contents(win).locator(`[data-cell="${r}:${c}"]`)
  await expect(contents(win).locator('.view-table__name').first()).toHaveText('CAC')
  // Row 0 is CAC (read only), row 1 Gross Margin; column 2 is Unit.
  await expect(cell(0, 2)).toContainText('currency')
  await expect(cell(0, 2).locator('[data-edit]')).toHaveCount(0)
  await expect(cell(0, 2).locator('[title="This note is read only"]')).toHaveCount(1)
  await cell(0, 2).dblclick()
  await expect(cell(0, 2).locator('input')).toHaveCount(0)
  await expect(cell(1, 2).locator('[data-edit]')).toHaveCount(1)
  // YAZ-3126 (D9): a muted lock after the read-only name, none after the next; the rows keep one height.
  await expect(cell(0, 0).locator('.view-read-only-mark[title="Read only"]')).toHaveCount(1)
  await expect(cell(1, 0).locator('.view-read-only-mark')).toHaveCount(0)
  const heights = await Promise.all([0, 1].map(async (r) => (await cell(r, 0).boundingBox())?.height))
  expect(heights[0]).toBe(heights[1])
  await win.waitForTimeout(700)
  expect(await readFile(cac, 'utf8')).toBe(locked)
  await shoot(win, 'read-only-4-folder-table')
  await quitApp(app)
  await rm(bible, { recursive: true, force: true })
})
