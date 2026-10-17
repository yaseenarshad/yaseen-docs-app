/**
 * PAGE VIEW (YAZ-2951): "Duplicate tab", ⌘⇧N (File › New Window) and "Move to new window" give the
 * copy its source's page view — the drilled-in bullet with its breadcrumbs, the live folds, the
 * scroll spot and the text size (D1, D2). The source here is drilled into "Alpha parent", has
 * "Alpha sibling" folded and stands at 125% (⌘+ through View › Zoom In, the app's own zoom path).
 * Each copy must show the same three things. The note on disk never changes: a page view is view
 * state only, never stored (S18).
 *
 * Written for YAZ-2965 without being run: an Electron e2e opens real windows on the screen.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `pageview-`
 * step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, clickMenuItem, closeWindow, editorOf, extraWindow, launchApp, layer, seededState, shoot, tabsOf, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Outline.md'
/** The first crumb is the page's title (YAZ-2420 D14): for a file made outside the app, its name without the extension. */
const TITLE = 'Outline'
const BODY = '* Alpha parent\n  * Alpha child\n    * Alpha grandchild\n  * Alpha sibling\n    * Sibling kid\n* Beta parent\n'

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const line = (w: Page, text: string) => editorOf(w).locator(`p:text-is("${text}")`)
const glyph = (w: Page, text: string) => editorOf(w).locator(`li.list-item:has(> .children > .content-dom > p:text-is("${text}")) > .label-wrapper`)
const crumbs = (w: Page) => editorOf(w).locator('nav[aria-label="Zoom breadcrumbs"] .outline-zoom-crumb')
const toggle = (w: Page, verb: 'Collapse' | 'Expand', text: string) => editorOf(w).locator(`button.outline-toggle[aria-label^="${verb} ${text}"]`)
const sizeLabel = (w: Page) => layer(w).locator('[role="group"][aria-label="Document zoom"] .document-zoom__trigger')

/** The source's page view, as the page on show in `w` must show it. */
async function expectSourceView(w: Page, shot: string): Promise<void> {
  // The drill-in: the same breadcrumbs, and only that bullet's subtree on show.
  await expect(crumbs(w)).toHaveText([TITLE, 'Alpha parent'])
  await expect(line(w, 'Alpha child')).toBeVisible()
  await expect(line(w, 'Beta parent')).toBeHidden()
  // The fold: "Alpha sibling" is folded, so its child is hidden.
  await expect(toggle(w, 'Expand', 'Alpha sibling')).toHaveAttribute('aria-expanded', 'false')
  await expect(line(w, 'Sibling kid')).toBeHidden()
  // The text size.
  await expect(sizeLabel(w)).toHaveAttribute('aria-label', 'Document zoom: 125%')
  await shoot(w, shot)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz2951-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'yaz2951-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the source: drilled into a bullet, one bullet folded, text size 125%', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(line(win, 'Beta parent')).toBeVisible()

  await glyph(win, 'Alpha parent').click()
  await expect(crumbs(win)).toHaveText([TITLE, 'Alpha parent'])

  await line(win, 'Alpha sibling').hover() // reveal the chevron (opacity)
  await toggle(win, 'Collapse', 'Alpha sibling').click()
  await expect(line(win, 'Sibling kid')).toBeHidden()

  // ⌘+ goes to the note that holds the focus (YAZ-1710): put the caret in it first.
  await line(win, 'Alpha child').click()
  await clickMenuItem(app, 'menu.view.zoom-in', 'w1')
  await expectSourceView(win, 'pageview-1-source')
})

test('step 2 — Duplicate tab: the copy shows the same breadcrumbs, fold and text size (S1, S2, S5)', async () => {
  await tabsOf(win).first().click({ button: 'right' })
  const items = win.locator('.ctx-menu__item')
  await expect(items.nth(1)).toHaveText('Duplicate tab')
  await items.nth(1).click()

  await expect(tabsOf(win)).toHaveText([TITLE, TITLE])
  await expect(tabsOf(win).nth(1)).toHaveAttribute('aria-selected', 'true')
  await expectSourceView(win, 'pageview-2-duplicate')

  // Back to the source, for the two new-window actions below.
  await tabsOf(win).nth(0).click()
  await expect(tabsOf(win).nth(0)).toHaveAttribute('aria-selected', 'true')
  await expectSourceView(win, 'pageview-3-source-again')
})

test('step 3 — ⌘⇧N: the new window shows the page on show with the same view (S11)', async () => {
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  const copy = await extraWindow(app, ['w1'])
  await expect(activeTab(copy)).toHaveText(TITLE)
  await expectSourceView(copy, 'pageview-4-new-window')

  // Back to one window, so the next step finds its new window by id.
  await closeWindow(app, winParam(copy)!)
  await expect.poll(() => windowCount(app)).toBe(1)
})

test('step 4 — Move to new window: the new window shows the page with the same view (S16); the file never changed', async () => {
  await tabsOf(win).first().click({ button: 'right' })
  const items = win.locator('.ctx-menu__item')
  await expect(items.first()).toHaveText('Move to new window')
  await items.first().click()

  const popped = await extraWindow(app, ['w1'])
  await expect(activeTab(popped)).toHaveText(TITLE)
  await expect(tabsOf(popped)).toHaveCount(1)
  await expectSourceView(popped, 'pageview-5-moved')
  await expect(tabsOf(win)).toHaveText([TITLE]) // the copy from step 2 stays

  expect(await readFile(notePath, 'utf8')).toBe(BODY)
})
