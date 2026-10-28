/**
 * Drawings and diagrams in Docs tabs (YAZ-3028), end-to-end against the REAL app, headless-safe
 * (`YASEEN_DOCS_E2E=1` through `launchApp`; a temp `--user-data-dir` and a COPY of a generated
 * fixture vault — never Yasin's vault).
 *
 *   1 a `.excalidraw` row is a NORMAL row: one click opens it in a tab on Draw's canvas (YAZ-3033);
 *     a rectangle drawn with the real mouse autosaves 500 ms later through `drawing:save` — the file
 *     on disk gains the element, keeps `files: {}` and carries its `yaseendraw` dates first.
 *   2 quit and relaunch: the restored tab opens the saved drawing again, clean.
 *   3 a `.drawio` row opens the bundled draw.io on its own `app://drawio` origin, offline and locked
 *     down (YAZ-3034); an edit (⌘D on a box) autosaves plain XML with its `yaseendraw-*` dates, and
 *     no request leaves the app.
 *
 *   4 the create rows (YAZ-3085 D1, D3; YAZ-3036, D9): right-click a folder → hover "New drawing" →
 *     its list (Excalidraw, dated Excalidraw | draw.io) → New draw.io diagram → a name → Enter: the
 *     `.drawio` is born on disk with its dates and opens in a tab. A click on the "New note" row
 *     itself opens the name box (Escape makes nothing). A click on the "New drawing" row itself is
 *     an Excalidraw drawing: the file is born with the empty scene and its dates, and opens on the
 *     canvas — the tab step 5 needs in front.
 *   5 the board menu items and the canvas panel (YAZ-3037, YAZ-3038): with the drawing tab in front,
 *     File › Export Image… and View › Canvas Background are enabled; the rail's hamburger opens the
 *     panel with its three tabs, and ⌘C on an empty selection opens Components. No search is typed:
 *     the Image Studio would reach a provider.
 *   7 the names (YAZ-3536 D1–D5): a drawing and a diagram read without their extension in the tree and the
 *     tab; Rename shows the name alone and keeps the extension on disk; with File icons Off the board's
 *     extension shows again, and a note stays bare.
 *   6 the draw.io panels and an outside change (YAZ-3420 D1, D2): with draw.io's own saved state
 *     saying Format and Layers were open, a 2-page diagram with 2 layers opens with Shapes, Format
 *     and Layers closed. On Page-2, zoomed in, a write from outside shows on Page-2 at the same zoom
 *     and place, and nothing is written back.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SEED_FILE, activeTab, appWindow, buildFixtureVault, confirmSheet, copyVault, dirRow, fileRow, launchApp, layer, menuListItem, menuParent, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const BOARD = 'Board.excalidraw'
const DIAGRAM = 'Flow.drawio'
/** A one-box diagram, as draw.io writes one: the box's text is how the test finds it in the frame. */
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
const PAGES = 'Pages.drawio'
/** Two pages; Page-2 has a second layer ("Notes"), so draw.io would open its Layers window on load. */
const twoPages = (extra = '') =>
  [
    '<mxfile>',
    '  <diagram id="p1" name="Page-1">',
    '    <mxGraphModel grid="0" page="0">',
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    '        <mxCell id="a1" value="First page box" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1">',
    '          <mxGeometry x="40" y="40" width="160" height="80" as="geometry" />',
    '        </mxCell>',
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '  <diagram id="p2" name="Page-2">',
    '    <mxGraphModel grid="0" page="0">',
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    '        <mxCell id="l2" value="Notes" parent="0" />',
    '        <mxCell id="b1" value="Second page box" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1">',
    '          <mxGeometry x="40" y="40" width="160" height="80" as="geometry" />',
    '        </mxCell>',
    '        <mxCell id="b2" value="Note box" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="l2">',
    '          <mxGeometry x="240" y="40" width="160" height="80" as="geometry" />',
    '        </mxCell>',
    extra,
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
    '',
  ].join('\n')
/** The cells of a diagram file on disk, not counting draw.io's two root cells. */
const cellCount = async (name: string): Promise<number> => ((await readFile(path.join(vault, name), 'utf8')).match(/<mxCell id="(?!0"|1")/g) ?? []).length
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
  await writeFile(path.join(vault, DIAGRAM), ONE_BOX)
  await writeFile(path.join(vault, PAGES), twoPages())
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

test('step 3 — a diagram row opens draw.io offline on app://drawio, and an edit autosaves plain XML with its dates', async () => {
  if (app === null) throw new Error('step 2 did not relaunch the app')
  const outside: string[] = []
  win.on('request', (req) => {
    if (/^https?:/i.test(req.url())) outside.push(req.url())
  })
  await fileRow(win, DIAGRAM).click()
  const frame = layer(win).locator('iframe.drawio-editor__frame')
  const src = new URL((await frame.getAttribute('src')) ?? '')
  expect(`${src.protocol}//${src.host}`).toBe('app://drawio')
  expect(Object.fromEntries(src.searchParams)).toMatchObject({ embed: '1', offline: '1', lockdown: '1', stealth: '1' })
  const box = layer(win).frameLocator('iframe.drawio-editor__frame').getByText('Hello box', { exact: true })
  await expect(box).toBeVisible({ timeout: 30_000 })
  await expect(layer(win).locator('.editor--diagram .save-indicator')).toHaveText('Saved')
  expect(await readFile(path.join(vault, DIAGRAM), 'utf8')).toBe(ONE_BOX) // opened, never rewritten
  await shoot(win, 'boards-04-diagram-open')

  await box.click()
  await win.keyboard.press('Meta+d') // duplicate the selected box
  await expect.poll(() => cellCount(DIAGRAM), { timeout: 10_000 }).toBe(2)
  const xml = await readFile(path.join(vault, DIAGRAM), 'utf8')
  expect(xml).toMatch(/^<mxfile yaseendraw-created="[\d.]+" yaseendraw-updated="\d+"/)
  expect(xml).not.toContain('compressed="true"')
  expect(outside).toEqual([])
  await shoot(win, 'boards-05-diagram-saved')
})

test('step 4 — the create rows: hover New drawing → New draw.io diagram → a name makes and opens a .drawio; a click on New note opens the name box; a click on New drawing makes an Excalidraw drawing', async () => {
  if (app === null) throw new Error('step 2 did not relaunch the app')
  const box = win.locator('.create-inline__input')

  // The three rows, in order (D3), and the drawing list behind a hover — with its separator (two groups).
  await dirRow(win, 'Projects').click({ button: 'right' })
  await expect(menuParent(win, 'New note')).toBeVisible()
  const rows = await menuParent(win).allTextContents()
  expect(rows.slice(0, 3)).toEqual(['New note', 'New drawing', 'New folder'])
  await menuParent(win, 'New drawing').hover()
  const list = win.locator('.ctx-overlay .ctx-menu__sub')
  await expect(list.locator('[role="menuitem"]')).toHaveText(['New Excalidraw drawing', 'New dated Excalidraw drawing', 'New draw.io diagram'])
  await expect(list.locator('[role="group"]')).toHaveCount(2)
  await shoot(win, 'boards-06a-new-drawing-list')
  await menuListItem(win, 'New draw.io diagram').click()
  await expect(box).toHaveAttribute('placeholder', 'New diagram')
  await box.fill('Roadmap')
  await box.press('Enter')
  const diagram = path.join(vault, 'Projects', 'Roadmap.drawio')
  await expect.poll(async () => (await readFile(diagram, 'utf8').catch(() => '')).length > 0, { timeout: 10_000 }).toBe(true)
  expect(await readFile(diagram, 'utf8')).toMatch(/^<mxfile yaseendraw-created="[\d.]+" yaseendraw-updated="\d+"/)
  await expect(activeTab(win)).toContainText('Roadmap')
  await expect(layer(win).locator('iframe.drawio-editor__frame')).toBeVisible({ timeout: 15_000 })
  await expect(fileRow(win, 'Roadmap.drawio')).toBeVisible()
  await shoot(win, 'boards-06b-new-diagram')

  // A click on the "New note" row itself is the everyday note (D1): the name box opens at once.
  await dirRow(win, 'Projects').click({ button: 'right' })
  await menuParent(win, 'New note').click()
  await expect(win.locator('.ctx-overlay')).toHaveCount(0)
  await expect(box).toHaveAttribute('placeholder', 'New note')
  await expect(box).toHaveValue('')
  await box.press('Escape')
  await expect(box).toHaveCount(0)

  // A click on the "New drawing" row itself is an Excalidraw drawing (D1).
  await dirRow(win, 'Projects').click({ button: 'right' })
  await menuParent(win, 'New drawing').click()
  await expect(box).toHaveAttribute('placeholder', 'New drawing')
  await box.fill('Whiteboard')
  await box.press('Enter')
  const born = path.join(vault, 'Projects', 'Whiteboard.excalidraw')
  await expect.poll(async () => (await readFile(born, 'utf8').catch(() => '')).length > 0, { timeout: 10_000 }).toBe(true)
  const scene = JSON.parse(await readFile(born, 'utf8')) as Record<string, unknown>
  expect(Object.keys(scene)[0]).toBe('yaseendraw')
  expect(scene).toMatchObject({ type: 'excalidraw', source: 'yaseen-docs', elements: [], files: {} })
  await expect(activeTab(win)).toContainText('Whiteboard')
  await expect(canvasFrame(win).locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(fileRow(win, 'Whiteboard.excalidraw')).toBeVisible()
  await shoot(win, 'boards-06-new-drawing')
})

test('step 5 — on a drawing tab the board menu items are on, and the rail and ⌘C open the canvas panel (YAZ-3037, YAZ-3038)', async () => {
  if (app === null) throw new Error('step 4 did not run')
  const enabled = (id: string) => (app as ElectronApplication).evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.enabled ?? null, id)
  await expect.poll(() => enabled('menu.file.export-image')).toBe(true)
  expect(await enabled('menu.file.export-drawing')).toBe(true)
  expect(await enabled('menu.view.canvas-background')).toBe(true)

  const panel = drawingTab(win).locator('.default-sidebar')
  await drawingTab(win).getByRole('button', { name: 'Open workspace panel' }).click()
  await expect(panel).toBeVisible()
  await expect(panel.locator('.app-sidebar-tab-label')).toHaveText(['Images', 'Components', 'Present'])
  await shoot(win, 'boards-07-canvas-panel')
  await panel.getByRole('button', { name: 'Close workspace panel' }).click()
  await expect(panel).toHaveCount(0)

  await canvasFrame(win).click()
  await win.keyboard.press('Meta+c')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Components', selected: true })).toBeVisible()
})

test('step 6 — every draw.io panel opens closed, and an outside change keeps the page and the zoom (YAZ-3420 D1, D2)', async () => {
  if (app === null) throw new Error('step 5 did not run')
  // Wide enough that draw.io's `simple` UI would open Format (1024 px) and Shapes (864 px) by itself.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.setSize(1800, 1000)))
  // draw.io's own memory (`mxSettings`, one store for every tab) says Format and Layers were open.
  // (Step 3 duplicated Flow's box, so it shows twice.)
  await fileRow(win, DIAGRAM).click()
  const flow = layer(win).frameLocator('iframe.drawio-editor__frame')
  await expect(flow.getByText('Hello box', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  const drawio = win.frames().find((f) => f.url().startsWith('app://drawio/index.html'))
  if (drawio === undefined) throw new Error('no draw.io frame')
  await drawio.evaluate(() => {
    const key = '.drawio-config'
    const settings = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
    const layers = { x: 300, y: 120, w: 212, h: 200, visible: true, minimized: false }
    localStorage.setItem(key, JSON.stringify({ ...settings, formatWidth: 240, windowStates: { layers } }))
  })

  // D1 (S1, S3, S6): a 2-layer diagram opens with every panel closed.
  await fileRow(win, PAGES).click()
  const frame = layer(win).frameLocator('iframe.drawio-editor__frame')
  await expect(frame.getByText('First page box', { exact: true })).toBeVisible({ timeout: 30_000 })
  const layersWindow = frame.locator('.mxWindow').filter({ hasText: 'Layers' })
  /** A closed panel is 0 px wide plus its 1 px border — still "visible" to Playwright, so its width is the test. */
  const closed = async () => {
    await expect.poll(() => frame.locator('.geSidebarContainer').evaluateAll((panels) => panels.map((p) => (p as HTMLElement).offsetWidth))).toEqual([1, 1])
    await expect(layersWindow.filter({ visible: true })).toHaveCount(0)
  }
  await closed()
  await shoot(win, 'boards-08-diagram-panels-closed')

  // D2 (K1, K8): on Page-2, zoomed in, a write from outside keeps the page, the zoom and the place.
  await frame.getByText('Page-2', { exact: true }).click()
  const box = frame.getByText('Second page box', { exact: true })
  await expect(box).toBeVisible()
  const fitted = await box.boundingBox()
  await box.hover()
  await win.keyboard.down('Control')
  await win.mouse.wheel(0, -300)
  await win.keyboard.up('Control')
  await expect.poll(async () => (await box.boundingBox())?.width ?? 0).toBeGreaterThan((fitted?.width ?? 0) + 10)
  await win.waitForTimeout(800) // draw.io zooms with a CSS preview first, then sets the real scale and scroll
  const zoomed = await box.boundingBox()
  await expect(layer(win).locator('.editor--diagram .save-indicator')).toHaveText('Saved')

  const edited = twoPages(
    ['        <mxCell id="b3" value="Agent box" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1">', '          <mxGeometry x="40" y="160" width="160" height="80" as="geometry" />', '        </mxCell>'].join('\n'),
  )
  await writeFile(path.join(vault, PAGES), edited)
  await expect(frame.getByText('Agent box', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(frame.locator('.geActivePage')).toHaveText('Page-2')
  const kept = await box.boundingBox()
  expect(Math.abs((kept?.width ?? 0) - (zoomed?.width ?? 0))).toBeLessThan(1)
  expect(Math.abs((kept?.x ?? 0) - (zoomed?.x ?? 0))).toBeLessThan(2)
  expect(Math.abs((kept?.y ?? 0) - (zoomed?.y ?? 0))).toBeLessThan(2)
  await closed()
  await win.waitForTimeout(1500) // past the 500 ms autosave
  expect(await readFile(path.join(vault, PAGES), 'utf8')).toBe(edited)
  await shoot(win, 'boards-09-diagram-outside-change')
})

test('step 7 — a board reads without its extension, renames by its name alone, and shows its extension with File icons Off (YAZ-3536)', async () => {
  if (app === null) throw new Error('step 1 did not launch the app')
  // `innerText`, not `textContent`: the extension is in the DOM, hidden by app.css until File icons Off (D4).
  const shown = (row: ReturnType<typeof fileRow>) => row.locator('.tree__label')
  await expect(shown(fileRow(win, DIAGRAM))).toHaveText('Flow', { useInnerText: true })
  await expect(shown(fileRow(win, BOARD))).toHaveText('Board', { useInnerText: true })
  await fileRow(win, DIAGRAM).click()
  await expect(activeTab(win).locator('.tabbar__label')).toHaveText('Flow', { useInnerText: true })

  // D3: the box holds the name alone; the extension stays on disk.
  await fileRow(win, BOARD).click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  const input = win.locator('.create-inline__input')
  await expect(input).toHaveValue('Board')
  await input.fill('Board v2')
  await input.press('Enter')
  const sheet = confirmSheet(win)
  if (await sheet.isVisible().catch(() => false)) await sheet.locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect.poll(async () => (await readScene('Board v2.excalidraw')).type, { timeout: 10_000 }).toBe('excalidraw')
  await expect(shown(fileRow(win, 'Board v2.excalidraw'))).toHaveText('Board v2', { useInnerText: true })
  await shoot(win, 'boards-10-names-bare')

  // D4, D5: with File icons Off, a board names its kind; a note stays bare.
  await quitApp(app)
  const state = await readState(userData)
  state.settings.sidebarFileIcons = 'off'
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(shown(fileRow(win, DIAGRAM))).toHaveText('Flow.drawio', { useInnerText: true })
  await expect(activeTab(win).locator('.tabbar__label')).toHaveText('Flow.drawio', { useInnerText: true })
  const note = fileRow(win, SEED_FILE.replace(/\.md$/, ''))
  await expect(note).toBeVisible()
  await expect(note.locator('.name-ending')).toHaveCount(0)
  await shoot(win, 'boards-11-names-icons-off')
})
