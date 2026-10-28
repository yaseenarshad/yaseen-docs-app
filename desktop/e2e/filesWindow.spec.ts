/**
 * THE FILES WINDOW (YAZ-3357 D1–D15, the scenario record S1–S44 on the working log YAZ-3367): a window that is only the
 * sidebar. File › New Files Window (⌘⇧W) opens one flush left of the window in front (D5, D6). A click on a file opens
 * it in the full window that shows its vault (D2, D7). A Files window is never a "Move to ▸" target (D2). "Show all tabs"
 * grows it to 1200 px for Tabs Mission Control, and closing the board sets it narrow again (D3, D10); a quit while it is
 * wide brings it back narrow (S25). The "Files window" chip, clicked twice, opens a full window where it stood, and the
 * Files window closes (D13). Main writes the state file, so the saved windows are the proof of each step.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, hidden windows
 * (`YASEEN_DOCS_E2E_HIDDEN`, helpers.ts), `fileswin-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { WindowBounds } from '../../shared/types'
import { activeTab, appWindow, clickMenuItem, extraWindow, fileRow, launchApp, quitApp, readState, seededState, shoot, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page
let files: Page
/** The Files window's id in `windows[]` (its `?win=`). */
let filesId: string
/** Its narrow bounds, as main opened it. */
let narrow: WindowBounds

/** The live bounds of the window with `?win=<id>`, from main. */
const boundsOf = (id: string): Promise<WindowBounds | null> =>
  app.evaluate(({ BrowserWindow }, winId) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes(`win=${winId}`))?.getBounds() ?? null, id)
/** The ids of the app's own windows (the floating preview popup has no `?win=`). */
const windowIds = (): string[] => app.windows().map(winParam).filter((id): id is string => id !== null)
/** How wide the board makes a Files window: 1200, clamped to the screen it is on. */
const wideWidth = (id: string): Promise<number> =>
  app.evaluate(({ BrowserWindow, screen }, winId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(`win=${winId}`))
    return Math.min(1200, w === undefined ? 1200 : screen.getDisplayMatching(w.getBounds()).workArea.width)
  }, id)
const showAllTabs = (w: Page) => w.locator('.sidebar__collapse[aria-label="Show all tabs"]')
const chip = (w: Page) => w.locator('.sidebar__files-chip')
const menuEntry = (w: Page, label: string) => w.locator('.ctx-menu [role="menuitem"]').filter({ hasText: new RegExp(`^${label}$`) })
const flyoutGroups = (w: Page) =>
  w.locator('.ctx-menu__sub [role="group"]').evaluateAll((groups) => groups.map((g) => Array.from(g.querySelectorAll('[role="menuitem"]'), (b) => b.textContent)))

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3357-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'yaz3357-vault-'))
  await Promise.all([
    writeFile(path.join(vault, 'Alpha.md'), '# Alpha\n\nfileswin-alpha-body\n'),
    writeFile(path.join(vault, 'Beta.md'), '# Beta\n\nfileswin-beta-body\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('File › New Files Window opens a Files window flush left of the full window; a click opens the file there', async () => {
  const state = seededState(vault, path.join(vault, 'Alpha.md'))
  // Room on the left for the Files window (D6), on any screen.
  state.windows[0].bounds = { x: 400, y: 60, width: 900, height: 700 }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(activeTab(win)).toContainText('Alpha')

  // D5, D15: the menu item (⌘⇧W) on the window in front.
  await clickMenuItem(app, 'menu.file.new-files-window', 'w1')
  files = await extraWindow(app, ['w1'])
  filesId = winParam(files) ?? ''
  // S6: "Files — <vault>", the sidebar alone — no tab strip.
  await expect(files).toHaveTitle(`Files — ${path.basename(vault)}`)
  await expect(fileRow(files, 'Beta')).toBeVisible()
  await expect(files.locator('.tabbar')).toHaveCount(0)
  await expect(chip(files)).toHaveText('Files window')
  // YAZ-3487 D19: its list starts at the sidebar zoom of the window that opened it (100%), as its own zoom.
  await expect(files.locator('.sidebar__footer .zoom-chip')).toHaveText('100%')
  // D1: main stored it as a Files window. D6: flush left of w1, on its top and as tall, as wide as the sidebar.
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.kind).toBe('files')
  const sidebarWidth = (await readState(userData)).sidebarWidth
  await expect.poll(() => boundsOf(filesId)).toEqual({ x: 400 - sidebarWidth, y: 60, width: sidebarWidth, height: 700 })
  narrow = (await boundsOf(filesId)) as WindowBounds
  await shoot(files, 'fileswin-1-open')

  // D2, D7: a click previews the file in the full window that shows the vault; the Files window keeps its sidebar.
  await fileRow(files, 'Beta').click()
  await expect(activeTab(win)).toContainText('Beta')
  await expect(win.getByText('fileswin-beta-body')).toBeVisible()
  await expect(files.locator('.tabbar')).toHaveCount(0)
  await shoot(win, 'fileswin-2-opened-in-full-window')
})

test('a Files window is no "Move to ▸" target', async () => {
  // D2, S15: the flyout lists the other full windows; there is none, so only the right panel.
  await activeTab(win).click({ button: 'right' })
  await menuEntry(win, 'Move to').click()
  expect(await flyoutGroups(win)).toEqual([['Right panel']])
  // Esc closes the flyout first, then the menu.
  await expect
    .poll(async () => {
      await win.keyboard.press('Escape')
      return win.locator('.ctx-menu').count()
    })
    .toBe(0)
})

test('"Show all tabs" makes the Files window wide for the board, and narrow again when it closes', async () => {
  const wide = await wideWidth(filesId)
  // D3, D10: the window grows at once; the board shows the full window's frame, never one of its own (D8).
  await showAllTabs(files).click()
  await expect.poll(async () => (await boundsOf(filesId))?.width).toBe(wide)
  await expect(files.locator('.taboverview')).toBeVisible()
  await expect.poll(() => files.locator('.taboverview__frame').evaluateAll((frames) => frames.map((f) => (f as HTMLElement).dataset.win))).toEqual(['w1'])
  await shoot(files, 'fileswin-3-board')
  // The store keeps the narrow bounds while it is wide.
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === filesId)?.bounds).toEqual(narrow)

  await showAllTabs(files).click()
  await expect.poll(() => boundsOf(filesId)).toEqual(narrow)
  await expect(files.locator('.taboverview')).toHaveCount(0)
})

test('View › Reload while the board shows: the Files window goes back narrow, and the board opens again', async () => {
  await showAllTabs(files).click()
  await expect.poll(async () => (await boundsOf(filesId))?.width).toBe(await wideWidth(filesId))
  await files.reload()
  await expect(fileRow(files, 'Beta')).toBeVisible()
  // The new page starts with the board closed (D3, D10): the window is narrow again, the sidebar never stretched.
  await expect.poll(() => boundsOf(filesId)).toEqual(narrow)
  // "Show all tabs" shows the board with room for it, and closes it.
  await showAllTabs(files).click()
  await expect(files.locator('.taboverview')).toBeVisible()
  await showAllTabs(files).click()
  await expect.poll(() => boundsOf(filesId)).toEqual(narrow)
})

test('a quit while the board shows brings the Files window back narrow, as a Files window', async () => {
  await showAllTabs(files).click()
  await expect.poll(async () => (await boundsOf(filesId))?.width).toBe(await wideWidth(filesId))
  await quitApp(app)

  // S25, S41: no seed this time — the launch reads what main wrote.
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  files = await appWindow(app, filesId)
  await expect(files).toHaveTitle(`Files — ${path.basename(vault)}`)
  await expect(chip(files)).toBeVisible()
  await expect.poll(() => boundsOf(filesId)).toEqual(narrow)
  await expect(files.locator('.taboverview')).toHaveCount(0)
})

test('"Make full window": two clicks on the chip open a full window where it stood, and the Files window closes', async () => {
  // D13, S38: the first click arms it, red.
  await chip(files).click()
  await expect(chip(files)).toHaveClass(/sidebar__files-chip--armed/)
  await expect(chip(files)).toHaveText('Make full window')
  await shoot(files, 'fileswin-4-armed')

  // S40, S44: the full window opens first, then the Files window closes by its real close.
  await chip(files).click()
  const full = await extraWindow(app, ['w1', filesId])
  const fullId = winParam(full) ?? ''
  await expect.poll(windowIds).not.toContain(filesId)
  // Where it stood: its top and height, at least 1200 wide, clamped to the screen.
  const at = await boundsOf(fullId)
  expect(at).toMatchObject({ y: narrow.y, height: narrow.height, width: await wideWidth(fullId) })
  // On its vault, on the blank tab with the caret in the search (D13).
  await expect(full.locator('.tabbar [role="tab"]')).toHaveText(['New tab'])
  await expect(full.locator('[aria-label="Search notes"]')).toBeFocused()
  await expect(chip(full)).toHaveCount(0)
  await shoot(full, 'fileswin-5-full-window')

  // Main wrote it: two full windows, no Files window.
  await expect.poll(async () => (await readState(userData)).windows.map((w) => [w.id, w.kind ?? 'full']).sort()).toEqual([[fullId, 'full'], ['w1', 'full']].sort())

  // A relaunch brings back the two full windows and no Files window.
  await quitApp(app)
  app = await launchApp({ userData })
  await appWindow(app, 'w1')
  await appWindow(app, fullId)
  await expect.poll(() => windowIds().sort()).toEqual([fullId, 'w1'].sort())
})
