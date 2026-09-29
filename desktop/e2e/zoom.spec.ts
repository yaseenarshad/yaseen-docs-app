/**
 * The two zooms of a note, in the REAL app:
 *  - BULLET ZOOM (GRO-2029/2091, `editor/outline/zoom.ts`): a click on a bullet's glyph shows only
 *    that bullet's subtree under a `file › ancestor › item` breadcrumb, ⌘Z takes back exactly that
 *    view action, and the file crumb zooms out. View state only: the file never changes.
 *  - DOCUMENT MAGNIFICATION (YAZ-1410/1710): the `− | 100% | +` pill steps the preset ladder and
 *    takes a custom value, scaling the content through `--document-zoom`. It is temporary: it
 *    never reaches the state file, and a remount of the note starts at 100% again.
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, clickMenuItem, editorOf, launchApp, layer, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Outline.md'
const BODY = '* Alpha parent\n  * Alpha child\n    * Alpha grandchild\n* Beta parent\n'

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const line = (w: Page, text: string) => editorOf(w).locator(`p:text-is("${text}")`)
const glyph = (w: Page, text: string) => editorOf(w).locator(`li.list-item:has(> .children > .content-dom > p:text-is("${text}")) > .label-wrapper`)
const crumbs = (w: Page) => editorOf(w).locator('nav[aria-label="Zoom breadcrumbs"] .outline-zoom-crumb')
const pill = (w: Page) => layer(w).locator('[role="group"][aria-label="Document zoom"]')
const zoomVar = (w: Page) => layer(w).locator('.editor-host').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--document-zoom'))

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'zoom-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'zoom-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a click on a bullet glyph zooms into its subtree under a breadcrumb; the file never changes', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(line(win, 'Beta parent')).toBeVisible()

  await line(win, 'Alpha grandchild').click() // the caret in the editor, so ⌘Z below reaches it
  await glyph(win, 'Alpha child').click()
  await expect(crumbs(win)).toHaveText([NOTE, 'Alpha parent', 'Alpha child'])
  await expect(crumbs(win).last()).toHaveAttribute('aria-current', 'location')
  await expect(line(win, 'Alpha grandchild')).toBeVisible()
  await expect(line(win, 'Beta parent')).toBeHidden()
  expect(await readFile(notePath, 'utf8')).toBe(BODY)
  await shoot(win, 'zoom-01-bullet-zoomed')
})

test('step 2 — ⌘Z reverts the zoom (the latest view action); the file crumb zooms all the way out', async () => {
  await win.keyboard.press('Meta+z')
  await expect(crumbs(win)).toHaveCount(0)
  await expect(line(win, 'Beta parent')).toBeVisible()

  await glyph(win, 'Alpha grandchild').click()
  await expect(crumbs(win)).toHaveText([NOTE, 'Alpha parent', 'Alpha child', 'Alpha grandchild'])
  await crumbs(win).first().click()
  await expect(crumbs(win)).toHaveCount(0)
  await expect(line(win, 'Beta parent')).toBeVisible()
  expect(await readFile(notePath, 'utf8')).toBe(BODY)
})

test('step 3 — the magnification pill steps presets and takes a custom value, scaling the content', async () => {
  const trigger = pill(win).locator('.document-zoom__trigger')
  await expect(trigger).toHaveAttribute('aria-label', 'Document zoom: 100%')
  expect(await zoomVar(win)).toBe('1')

  await pill(win).locator('button[aria-label="Zoom in"]').click()
  await expect(trigger).toHaveAttribute('aria-label', 'Document zoom: 125%')
  expect(await zoomVar(win)).toBe('1.25')
  await pill(win).locator('button[aria-label="Zoom out"]').click()
  await pill(win).locator('button[aria-label="Zoom out"]').click()
  await expect(trigger).toHaveAttribute('aria-label', 'Document zoom: 90%')

  // The percentage opens the custom input: a whole number 50–400, applied on Enter.
  await trigger.click()
  const custom = pill(win).locator('input[title="Document zoom (50–400%)"]')
  await custom.fill('150')
  await custom.press('Enter')
  await expect(trigger).toHaveAttribute('aria-label', 'Document zoom: 150%')
  expect(await zoomVar(win)).toBe('1.5')
  await shoot(win, 'zoom-02-magnified')
})

test('step 4 — magnification is temporary: nothing persists, and reopening the note starts at 100%', async () => {
  // Nothing zoom-shaped in the state file (the vault's own temp name, `zoom-vault-…`, aside; the note is `Outline.md`).
  expect(JSON.stringify(await readState(userData)).replaceAll(vault, '')).not.toMatch(/zoom/i)
  expect(await readFile(notePath, 'utf8')).toBe(BODY)

  await clickMenuItem(app, 'menu.file.close-tab', 'w1')
  await expect(layer(win).locator('.document-zoom')).toHaveCount(0)
  await win.locator('.tree__row--file', { hasText: 'Outline' }).click()
  await expect(pill(win).locator('.document-zoom__trigger')).toHaveAttribute('aria-label', 'Document zoom: 100%')
})
