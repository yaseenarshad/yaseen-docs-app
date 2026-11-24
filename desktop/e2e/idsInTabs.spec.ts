/**
 * IDs in Tabs & Tab Width (YAZ-6464) end-to-end against the REAL app (headless-safe:
 * `launchApp` sets `YASEEN_DOCS_E2E_HIDDEN=1`, isolated temp profile + temp vaults).
 *
 * Covers:
 *  1. Default state: no tab IDs, full page title in hover tooltip for ID-vault pages.
 *  2. Per-vault `Show IDs in tabs` (`Full ID`, `Number`) for pages & folder pages; drawings & non-ID vaults stay excluded.
 *  3. Per-vault `Tab ID layout` (`Inline` vs `Two lines`) with uniform 40px pill height across mixed vaults.
 *  4. App-global `Tab width` (`Compact`, `Wide`, `Custom`) resizing all tabs across vaults.
 *  5. Persistence of both per-vault `show-ids.json` and global `tabWidth` across quit + relaunch.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, quitApp, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let baseDir: string
let wikiRoot: string
let plainRoot: string
let pageFile: string
let folderDir: string
let drawingFile: string
let plainFile: string
let app: ElectronApplication
let win: Page

const cog = (w: Page) => w.getByRole('button', { name: 'Settings', exact: true })
const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')
const closeSettings = (w: Page) => dialog(w).getByRole('button', { name: 'Close settings', exact: true })
const navSection = (w: Page, name: string) => dialog(w).getByRole('button', { name, exact: true })
const settingRow = (w: Page, id: string) => dialog(w).locator(`[data-setting="${id}"]`)

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'mdapp-ids-tabs-profile-'))
  baseDir = await mkdtemp(path.join(tmpdir(), 'mdapp-ids-tabs-vaults-'))
  const realBase = await realpath(baseDir)
  wikiRoot = path.join(realBase, 'wiki-vault')
  plainRoot = path.join(realBase, 'plain-vault')
  folderDir = path.join(wikiRoot, 'Architecture')
  pageFile = path.join(wikiRoot, 'WIKI-2916.md')
  drawingFile = path.join(wikiRoot, 'Sketch.excalidraw')
  plainFile = path.join(plainRoot, 'Plain Notes.md')

  await mkdir(path.join(wikiRoot, '.yaseendocs'), { recursive: true })
  await mkdir(folderDir, { recursive: true })
  await mkdir(path.join(plainRoot, '.yaseendocs'), { recursive: true })

  await writeFile(path.join(wikiRoot, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: true, letters: 'WIKI' }))
  await writeFile(path.join(plainRoot, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: false }))
  await writeFile(pageFile, '---\nid: WIKI-2916\ntitle: Electron Runtime Architecture Guide\n---\n# Electron Runtime Architecture Guide\n\nBody.\n')
  await writeFile(path.join(folderDir, '.folder.md'), '---\nid: WIKI-50\ntitle: Architecture\n---\n')
  await writeFile(path.join(folderDir, 'WIKI-51.md'), '---\nid: WIKI-51\ntitle: Child\n---\n# Child\n')
  await writeFile(
    drawingFile,
    JSON.stringify({ yaseendraw: { createdAt: 1, updatedAt: 2, id: 'WIKI-999' }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }),
  )
  await writeFile(plainFile, '# Plain Notes\n\nNo IDs here.\n')

  const state = seededState(wikiRoot, pageFile)
  state.recents.push({ path: plainRoot, lastOpened: Date.now() - 1000 })
  state.windows[0]!.roots = [wikiRoot, plainRoot]
  state.windows[0]!.tabs = [pageFile, folderDir, drawingFile, plainFile]
  state.windows[0]!.bounds = { x: 40, y: 40, width: 1280, height: 760 }

  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.tabbar__tab')).toHaveCount(4, { timeout: 15_000 })
})

test.afterAll(async () => {
  await quitApp(app).catch(() => undefined)
  await rm(userData, { recursive: true, force: true })
  await rm(baseDir, { recursive: true, force: true })
})

test('1. default state hides tab IDs and shows full page title in tooltip', async () => {
  await expect(win.locator('.tabbar__id')).toHaveCount(0)
  const firstBtn = win.locator('.tabbar__tab .tabbar__btn').first()
  await expect(firstBtn).toHaveAttribute('title', new RegExp(`^Electron Runtime Architecture Guide\\n`))
})

test('2. Show IDs in tabs (Full ID & Number) shows IDs on pages and folders, never drawings or non-ID vaults', async () => {
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await navSection(win, 'Files & Links').click()
  const tabsRow = settingRow(win, 'showIds.tabs')
  await expect(tabsRow).toBeVisible()
  // Layout row is hidden while Off.
  await expect(settingRow(win, 'showIds.tabsLayout')).toHaveCount(0)

  await tabsRow.getByRole('button', { name: 'Full ID (EMB-12)', exact: true }).click()
  await expect(settingRow(win, 'showIds.tabsLayout')).toBeVisible()
  await closeSettings(win).click()

  // Page and folder tabs show full IDs; drawing and plain-vault tabs show none.
  const tabIds = win.locator('.tabbar__tab .tabbar__id')
  await expect(tabIds).toHaveText(['WIKI-2916', 'WIKI-50'])

  // Active full-ID inline tab widens past 200px on Default tabWidth.
  const firstWidth = await win.locator('.tabbar__tab').first().evaluate((el) => el.getBoundingClientRect().width)
  expect(firstWidth).toBeGreaterThan(200)

  // Switch to Number (#12).
  await cog(win).click()
  await navSection(win, 'Files & Links').click()
  await settingRow(win, 'showIds.tabs').getByRole('button', { name: 'Number (#12)', exact: true }).click()
  await closeSettings(win).click()
  await expect(tabIds).toHaveText(['#2916', '#50'])
})

test('3. Two lines layout grows strip to 52px with uniform 40px pills across mixed vaults', async () => {
  await cog(win).click()
  await navSection(win, 'Files & Links').click()
  await settingRow(win, 'showIds.tabs').getByRole('button', { name: 'Full ID (EMB-12)', exact: true }).click()
  await settingRow(win, 'showIds.tabsLayout').getByRole('button', { name: 'Two lines', exact: true }).click()
  await closeSettings(win).click()

  await expect(win.locator('.tabbar-row')).toHaveClass(/tabbar-row--stacked/)
  const heights = await win.locator('.tabbar__tab').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)))
  expect(heights).toEqual([40, 40, 40, 40])
})

test('4. Global Tab width (Compact, Wide, Custom) updates CSS vars and persists across restart', async () => {
  await cog(win).click()
  await navSection(win, 'Appearance').click()
  const widthRow = settingRow(win, 'tabWidth')
  await expect(widthRow).toBeVisible()

  await widthRow.getByRole('button', { name: 'Compact', exact: true }).click()
  expect(await win.locator('.tabbar-row').evaluate((el) => el.style.getPropertyValue('--tab-max-w'))).toBe('150px')

  await widthRow.getByRole('button', { name: 'Custom', exact: true }).click()
  const pxInput = widthRow.getByLabel('Tab width in px')
  await pxInput.fill('300')
  await pxInput.press('Enter')
  expect(await win.locator('.tabbar-row').evaluate((el) => el.style.getPropertyValue('--tab-max-w'))).toBe('300px')
  await closeSettings(win).click()

  // Quit and relaunch to prove persistence.
  await quitApp(app)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.tabbar__tab')).toHaveCount(4, { timeout: 15_000 })
  await expect(win.locator('.tabbar-row')).toHaveClass(/tabbar-row--stacked/)
  await expect(win.locator('.tabbar__tab .tabbar__id')).toHaveText(['WIKI-2916', 'WIKI-50'])
  expect(await win.locator('.tabbar-row').evaluate((el) => el.style.getPropertyValue('--tab-max-w'))).toBe('300px')
})
