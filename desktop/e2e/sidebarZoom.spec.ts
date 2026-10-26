/**
 * The SIDEBAR zoom (YAZ-3389), in the REAL app: "Zoom the sidebar in" makes the footer say 125% and
 * a tree row 1.25× taller on screen, while the sidebar's header, its tab row and the footer's cog keep
 * their size and place, and the window's own Chromium zoom stays 0. The value is a setting: it is in
 * the state file after a quit and comes back on the next launch. The percent goes back to 100%, and
 * View › Zoom In / Actual Size with no note focused step the same zoom. A Chromium zoom left from an
 * older build goes back to 0 at the next load (D8). A Files window (D13) zooms its own list: it opens one step above
 * the full window's sidebar zoom, and its footer and View › Zoom In change only its own value.
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, extraWindow, fileRow, launchApp, quitApp, readState, seededState, shoot, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const control = (w: Page) => w.locator('.sidebar__footer [role="group"][aria-label="Sidebar zoom"]')
const percent = (w: Page) => control(w).locator('.sidebar-zoom__value')
/** Where an element is on the screen, in CSS px of the viewport (standardized zoom counts in `getBoundingClientRect`). */
const box = (w: Page, selector: string) =>
  w.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })
const rowHeight = (w: Page) => fileRow(w, 'Ideas').evaluate((el) => el.getBoundingClientRect().height)
/** The real Chromium zoom level of the window with `?win=<id>` (w1 by default), from main. */
const zoomLevel = (a: ElectronApplication, id = 'w1'): Promise<number> =>
  a.evaluate(({ BrowserWindow }, winId) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`win=${winId}`))!.webContents.getZoomLevel(), id)
/** Set the window's Chromium zoom from main, as a ⌘+ of an older build did. */
const setZoomLevel = (a: ElectronApplication, level: number): Promise<void> =>
  a.evaluate(({ BrowserWindow }, l) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('win=w1'))!.webContents.setZoomLevel(l), level)
const CHROME = ['.sidebar__header', '.sidebar__lenses', '.sidebar__footer .settings-button']

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sidebarzoom-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — "Zoom the sidebar in": 125%, a tree row 1.25× taller, the header, the tab row and the cog unchanged, the window not zoomed', async () => {
  // No note open: nothing claims the menu's zoom later, so it reaches the sidebar.
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await expect(percent(win)).toHaveText('100%')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  expect(await zoomLevel(app)).toBe(0)

  const row = await rowHeight(win)
  const chrome = await Promise.all(CHROME.map((s) => box(win, s)))
  await control(win).getByRole('button', { name: 'Zoom the sidebar in', exact: true }).click()
  await expect(percent(win)).toHaveText('125%')
  await expect.poll(async () => (await rowHeight(win)) / row).toBeCloseTo(1.25, 1)
  expect(await Promise.all(CHROME.map((s) => box(win, s)))).toEqual(chrome)
  expect(await zoomLevel(app)).toBe(0)
  await shoot(win, 'sidebarzoom-01-125')
})

test('step 2 — quit and launch again: the state file says 125 and the sidebar comes back at 125%', async () => {
  await quitApp(app)
  expect((await readState(userData)).settings.sidebarZoom).toBe(125)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(percent(win)).toHaveText('125%')
  expect(await zoomLevel(app)).toBe(0)
})

test('step 3 — a click on the percent goes back to 100%', async () => {
  await percent(win).click()
  await expect(percent(win)).toHaveText('100%')
})

test('step 4 — View › Zoom In and Actual Size, with no note focused, step the sidebar zoom and never the window', async () => {
  await clickMenuItem(app, 'menu.view.zoom-in', 'w1')
  await expect(percent(win)).toHaveText('125%')
  await clickMenuItem(app, 'menu.view.zoom-reset', 'w1')
  await expect(percent(win)).toHaveText('100%')
  expect(await zoomLevel(app)).toBe(0)
})

test('step 5 — a Chromium zoom from an older build: the next load sets it back to 0 (D8)', async () => {
  await setZoomLevel(app, 2)
  expect(await zoomLevel(app)).toBe(2)
  await win.reload()
  await expect(percent(win)).toHaveText('100%')
  await expect.poll(() => zoomLevel(app)).toBe(0)
})

test('step 6 — a Files window (D13): it opens one step above (125%), its + and View › Zoom In change only its own zoom, its window zoom stays 0', async () => {
  await clickMenuItem(app, 'menu.file.new-files-window', 'w1')
  const files = await extraWindow(app, ['w1'])
  const filesId = winParam(files) ?? ''
  await expect(percent(files)).toHaveText('125%')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.zoom).toBe(125)
  await control(files).getByRole('button', { name: 'Zoom the sidebar in', exact: true }).click()
  await expect(percent(files)).toHaveText('150%')
  await clickMenuItem(app, 'menu.view.zoom-in', filesId)
  await expect(percent(files)).toHaveText('200%')
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.zoom).toBe(200)
  // The full window and the shared setting never moved; no window has a Chromium zoom.
  await expect(percent(win)).toHaveText('100%')
  expect((await readState(userData)).settings.sidebarZoom).toBe(100)
  expect(await zoomLevel(app, filesId)).toBe(0)
  expect(await zoomLevel(app)).toBe(0)
  await shoot(files, 'sidebarzoom-06-files-window')
})
