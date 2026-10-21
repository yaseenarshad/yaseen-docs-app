/**
 * The Draw features around a board (YAZ-3028; YAZ-3044 A21), end-to-end against the REAL app, hidden-safe:
 * a temp `--user-data-dir` and a COPY of a generated fixture vault, made a git repo here with no remote.
 * No step asks for window focus; a menu item is clicked through `clickMenuItemQuietly`.
 *
 *   1 the Draw import, per vault (D6): `.yaseendraw/favorites.json` joins `.yaseendocs/favorites.json`
 *     at launch, and the marker records the vault. The app-data half is off under e2e: no Draw
 *     secrets, sharing or library reach this profile.
 *   2 hover preview and Info (D11): resting on a board row shows its picture; Info names its type.
 *   3 Version history (YAZ-3039): the row menu lists the board's two commits, and Restore writes the
 *     older one back over the file.
 *   4 a `yaseendraw://` link (D7) opens its board in a tab, the same as a `yaseendocs://` one.
 *   5 File › Export Excalidraw Drawing… (D10) writes a standalone `.excalidraw` where the sheet says
 *     (the native sheet is answered in main, so no window opens).
 *   6 the canvas panel's Images tab opens the Image Studio (YAZ-3038). Nothing is typed: a search would
 *     reach a provider.
 *   7 right-click a folder → hover "New drawing" → New dated Excalidraw drawing in its list (D9;
 *     YAZ-3085 D3): the box is seeded `MM_DD- `, and the drawing is born with that name and opens in a tab.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, buildFixtureVault, clickMenuItemQuietly, copyVault, dirRow, emitOpenUrl, fileRow, launchApp, layer, menuItem, menuListItem, menuParent, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const BOARD = 'Board.excalidraw'
const LINKED = 'Linked.excalidraw'
type El = Record<string, unknown> & { id: string }
const rect = (id: string, x = 0): El => ({ id, type: 'rectangle', x, y: 0, width: 120, height: 80, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, index: `a${id.length}${x}`, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false })
const scene = (elements: El[]): string => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files: {} }, null, 2)}\n`
const git = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' })

let vaultSrc: string
let vault: string
let userData: string
let outDir: string
let app: ElectronApplication | null = null
let win: Page

const elementIds = async (file: string): Promise<string[]> => ((JSON.parse(await readFile(file, 'utf8')) as { elements: El[] }).elements ?? []).filter((e) => e.isDeleted !== true).map((e) => e.id)
const drawingTab = (w: Page) => layer(w).locator('.editor--drawing')
const canvasReady = (w: Page) => expect(drawingTab(w).locator('.drawing-editor__canvas canvas').first()).toBeVisible({ timeout: 15_000 })

test.beforeAll(async () => {
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, BOARD), scene([rect('first')]))
  await writeFile(path.join(vault, LINKED), scene([rect('linked')]))
  // A Draw vault: Draw's own dotfolder with a favorite (the import copies, never moves).
  await mkdir(path.join(vault, '.yaseendraw'))
  await writeFile(path.join(vault, '.yaseendraw', 'favorites.json'), `${JSON.stringify({ version: 1, favorites: [BOARD] })}\n`)
  // Two commits of the board: Version history's list. No remote, so sync stays off.
  git(vault, 'init', '-q', '-b', 'main')
  for (const [k, v] of [['user.name', 'Yaseen Docs Test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false']]) git(vault, 'config', k, v)
  git(vault, 'add', '-A')
  git(vault, 'commit', '-q', '-m', 'first shape')
  await writeFile(path.join(vault, BOARD), scene([rect('first'), rect('second', 300)]))
  git(vault, 'commit', '-q', '-am', 'second shape')
  userData = await mkdtemp(path.join(tmpdir(), 'yaz-3044-board-tools-'))
  outDir = await mkdtemp(path.join(tmpdir(), 'yaz-3044-export-'))
})

test.afterAll(async () => {
  if (app !== null) await quitApp(app)
  await Promise.all([vaultSrc, vault, userData, outDir].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the Draw import joins the vault\'s Draw favorites into Docs, once, and leaves app data alone under e2e', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  const favorites = path.join(vault, '.yaseendocs', 'favorites.json')
  await expect.poll(async () => (JSON.parse(await readFile(favorites, 'utf8').catch(() => '{}')) as { favorites?: string[] }).favorites, { timeout: 10_000 }).toEqual([BOARD])
  const marker = JSON.parse(await readFile(path.join(userData, 'draw-import.json'), 'utf8')) as { appData?: number; vaults: Record<string, number> }
  expect(Object.keys(marker.vaults)).toEqual([vault])
  expect(marker.appData).toBeUndefined()
  for (const name of ['secrets.json', 'sharing.json']) await expect(readFile(path.join(userData, name))).rejects.toThrow()
  // Draw's file is untouched (D1: Draw stays).
  expect(JSON.parse(await readFile(path.join(vault, '.yaseendraw', 'favorites.json'), 'utf8'))).toEqual({ version: 1, favorites: [BOARD] })
  await win.locator('.sidebar__lenses [role="tab"][aria-label="Favorites"]').click()
  await expect(fileRow(win, BOARD)).toBeVisible()
  await win.locator('.sidebar__lenses [role="tab"]', { hasText: 'Files' }).click()
})

test('step 2 — resting on a board row shows its picture; Info names its type', async () => {
  await fileRow(win, BOARD).hover()
  const preview = win.locator('.board-preview')
  await expect(preview).toBeVisible({ timeout: 10_000 })
  await expect(preview.locator('.board-preview__img--loaded')).toBeVisible({ timeout: 20_000 })
  await expect(preview.locator('.board-preview__name')).toHaveText(BOARD)
  await shoot(win, 'board-tools-01-hover-preview')
  await win.mouse.move(900, 600)
  await expect(preview).toHaveCount(0)

  await fileRow(win, BOARD).click({ button: 'right' })
  await menuItem(win, 'Info').click()
  const info = win.locator('.board-info')
  await expect(info).toContainText('Excalidraw drawing')
  await expect(info.locator('.board-info__name')).toHaveText(BOARD)
  await shoot(win, 'board-tools-02-info')
  await win.keyboard.press('Escape')
  await expect(info).toHaveCount(0)
})

test('step 3 — Version history lists the two commits, and Restore writes the older one back', async () => {
  await fileRow(win, BOARD).click({ button: 'right' })
  await menuItem(win, 'Version history').click()
  const history = win.getByTestId('version-history')
  await expect(history).toHaveAccessibleName('Version history of Board')
  const versions = history.getByRole('listbox', { name: 'Versions' }).getByRole('option')
  await expect(versions).toHaveCount(2)
  await versions.last().click() // the oldest: one shape
  await expect(history.getByTestId('history-picture')).toBeVisible({ timeout: 20_000 })
  await shoot(win, 'board-tools-03-history')
  await history.getByTestId('history-restore').click()
  await history.getByTestId('history-restore-confirm').click()
  await expect.poll(() => elementIds(path.join(vault, BOARD)), { timeout: 10_000 }).toEqual(['first'])
})

test('step 4 — a yaseendraw:// link opens its board in a tab', async () => {
  await expect(win.getByTestId('version-history')).toHaveCount(0)
  await emitOpenUrl(app as ElectronApplication, `yaseendraw://${encodeURI(path.join(vault, LINKED))}`)
  await expect(activeTab(win)).toContainText('Linked')
  await canvasReady(win)
  await shoot(win, 'board-tools-04-yaseendraw-link')
})

test('step 5 — File › Export Excalidraw Drawing… writes a standalone .excalidraw where the sheet says', async () => {
  const target = path.join(outDir, 'Exported.excalidraw')
  // The native sheet is answered in main: the path a user would have typed.
  await (app as ElectronApplication).evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
  }, target)
  await expect.poll(() => (app as ElectronApplication).evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('menu.file.export-drawing')?.enabled ?? null)).toBe(true)
  await clickMenuItemQuietly(app as ElectronApplication, 'menu.file.export-drawing')
  await expect.poll(() => elementIds(target).catch(() => null), { timeout: 10_000 }).toEqual(['linked'])
  expect(JSON.parse(await readFile(target, 'utf8'))).toMatchObject({ type: 'excalidraw' })
  // The vault file is not touched by an export.
  expect(await elementIds(path.join(vault, LINKED))).toEqual(['linked'])
})

test('step 6 — the canvas panel\'s Images tab opens the Image Studio', async () => {
  const panel = drawingTab(win).locator('.default-sidebar')
  await drawingTab(win).getByRole('button', { name: 'Open workspace panel' }).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('tab', { name: 'Image Studio' }).click() // the tab labelled "Images"
  await expect(panel.getByRole('navigation', { name: 'Image Studio sections' })).toBeVisible()
  await expect(panel.getByRole('searchbox', { name: 'Search graphics, icons, and logos' }).or(panel.getByRole('textbox', { name: 'Search graphics, icons, and logos' }))).toBeVisible()
  await shoot(win, 'board-tools-05-image-studio')
  await panel.getByRole('button', { name: 'Close workspace panel' }).click()
  await expect(panel).toHaveCount(0)
})

test('step 7 — New dated Excalidraw drawing, in the New drawing list, seeds MM_DD- and opens the new drawing', async () => {
  const now = new Date()
  const seed = `${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}- `
  await dirRow(win, 'Projects').click({ button: 'right' })
  // The dated twin lives in the "New drawing ▸" list now (YAZ-3085 D3): a hover opens it.
  await menuParent(win, 'New drawing').hover()
  await menuListItem(win, 'New dated Excalidraw drawing').click()
  const box = win.locator('.create-inline__input')
  await expect(box).toHaveValue(seed)
  await box.fill(`${seed}Sketch`)
  await box.press('Enter')
  const born = path.join(vault, 'Projects', `${seed}Sketch.excalidraw`)
  await expect.poll(async () => (await readFile(born, 'utf8').catch(() => '')).length > 0, { timeout: 10_000 }).toBe(true)
  expect(JSON.parse(await readFile(born, 'utf8'))).toMatchObject({ type: 'excalidraw', elements: [] })
  await expect(activeTab(win)).toContainText(`${seed}Sketch`)
  await canvasReady(win)
  await shoot(win, 'board-tools-06-dated-drawing')
})
