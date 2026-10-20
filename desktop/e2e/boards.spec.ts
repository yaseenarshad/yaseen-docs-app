/**
 * Drawings and diagrams in Docs tabs (YAZ-3028), end-to-end against the REAL app, headless-safe
 * (`YASEEN_DOCS_E2E=1` through `launchApp`; a temp `--user-data-dir` and a COPY of a generated
 * fixture vault — never Yasin's vault).
 *
 *   1 a `.excalidraw` row is a NORMAL row: one click opens it in a tab on Draw's canvas (YAZ-3033);
 *     a rectangle drawn with the real mouse autosaves 500 ms later through `drawing:save` — the file
 *     on disk gains the element, keeps `files: {}` and carries its `yaseendraw` dates first.
 *   2 quit and relaunch: the restored tab opens the saved drawing again, clean.
 *
 * The diagram tab (YAZ-3034) and the folder menu's "New Excalidraw drawing" (YAZ-3036) add their
 * own steps below.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, buildFixtureVault, copyVault, fileRow, launchApp, layer, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const BOARD = 'Board.excalidraw'
/** The scene a Draw-made board starts as: empty, `yaseen-draw` source, no dates yet. */
const EMPTY_BOARD = `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-draw', elements: [], appState: {}, files: {} }, null, 2)}\n`

let vaultSrc: string
let vault: string
let userData: string
let app: ElectronApplication | null = null
let win: Page

const readScene = async (name: string): Promise<Record<string, unknown> & { elements: unknown[] }> => JSON.parse(await readFile(path.join(vault, name), 'utf8')) as Record<string, unknown> & { elements: unknown[] }
/** The visible tab's drawing host and its canvas frame. */
const drawingTab = (w: Page) => layer(w).locator('.editor--drawing')
const canvasFrame = (w: Page) => drawingTab(w).locator('.drawing-editor__canvas')
const saveChip = (w: Page) => drawingTab(w).locator('.save-indicator')

test.beforeAll(async () => {
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, BOARD), EMPTY_BOARD)
  userData = await mkdtemp(path.join(tmpdir(), 'yaz-3028-boards-'))
})

test.afterAll(async () => {
  if (app !== null) await quitApp(app)
  await Promise.all([vaultSrc, vault, userData].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a drawing row opens in a tab, and a drawn rectangle autosaves to disk', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')

  // A normal row now, not a grey external one: one click opens it in this window.
  await fileRow(win, BOARD).click()
  await expect(activeTab(win)).toContainText('Board')
  await expect(canvasFrame(win).locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(saveChip(win)).toHaveText('Saved')
  await shoot(win, 'boards-01-drawing-open')

  await drawingTab(win).locator('[data-testid="toolbar-rectangle"]').click()
  const box = await canvasFrame(win).boundingBox()
  if (box === null) throw new Error('the drawing canvas has no box')
  const x = box.x + box.width * 0.5
  const y = box.y + box.height * 0.5
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.move(x + 160, y + 110, { steps: 12 })
  await win.mouse.up()

  // Autosave: 500 ms after the last change, through `drawing:save`, then the chip settles.
  await expect.poll(async () => (await readScene(BOARD)).elements.length, { timeout: 10_000 }).toBe(1)
  await expect(saveChip(win)).toHaveText('Saved')
  const saved = await readScene(BOARD)
  expect(Object.keys(saved)[0]).toBe('yaseendraw')
  expect(saved.files).toEqual({})
  expect((saved.elements[0] as { type: string }).type).toBe('rectangle')
  await shoot(win, 'boards-02-drawing-saved')
})

test('step 2 — after a relaunch the restored tab shows the saved drawing, clean', async () => {
  if (app === null) throw new Error('step 1 did not launch the app')
  await quitApp(app)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(activeTab(win)).toContainText('Board')
  await expect(canvasFrame(win).locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(saveChip(win)).toHaveText('Saved')
  expect((await readScene(BOARD)).elements).toHaveLength(1)
  await shoot(win, 'boards-03-drawing-reopened')
})
