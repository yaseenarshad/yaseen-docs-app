/**
 * Easy wave (YAZ-721 / 738 / 744 / 741 / 743 / 672): the six small features of the wave driven
 * TOGETHER through the REAL app, over the committed encyclopedia fixture (`fixtures/bible-vault`)
 * — the one vault in the suite with a real `[[wiki link]]` graph, which is exactly what the
 * back/forward stack needs to be exercised over.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1  sidebar drag-to-resize: the 6px edge dragged +120px takes `.sidebar` from 260 to 380 (738)
 *   2  …and it SURVIVES quit → relaunch, on disk as `AppState.sidebarWidth` (738)
 *   3  collapse all groups: one toolbar button folds every group of the grouped base (744)
 *   4  …collapsed across quit → relaunch, and the same button (now "Expand all") unfolds them (744)
 *   5  GUI evidence: table column dividers + the hovered resize handle (741), the ⋯ view menu
 *      opening fully INSIDE the viewport (743)
 *   6  the spell-check context-menu listener is actually wired on the window (672)
 *   7  history (a): A → B → C, Back Back Forward — one tab throughout (721)
 *   8  history (b): navigating away from a walked-back position TRUNCATES forward (721)
 *   9  history (c): a link to an ALREADY-OPEN file activates that tab; the source tab's stack
 *      is left exactly as it was (721)
 *  10  history (d): renaming a page that sits BEHIND the current one — Back lands on the new name (721)
 *  11  history (e): deleting a page that sits behind — Back skips straight past it (721)
 *  12  dragging the sidebar edge to the far left CLOSES the sidebar (738)
 *
 * Same harness as bible.spec.ts / tabs.spec.ts (temp `--user-data-dir`, a COPY of the fixture,
 * `easy-` step screenshots, `quitApp` at the end).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SIDEBAR_DEFAULT_W } from '../../shared/types'
import { appWindow, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia — copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDERS = ['funnel-stages', 'industries', 'kpis', 'problems', 'roles']
const ALL_KPIS = 'All KPIs.base'

/** The drag distance under test: 260 (the default) + 120 = 380, comfortably inside the clamp. */
const DRAG_DX = 120
const WIDENED_W = SIDEBAR_DEFAULT_W + DRAG_DX

/** YAZ-721 (d): the name `Win Rate` is renamed to mid-history. */
const RENAMED = 'Deal Win Rate'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (the suite's shared idioms) ----------

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
const linkIn = (w: Page, text: string) => editorOf(w).locator('.wikilink', { hasText: text }).first()
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

const backBtn = (w: Page) => w.locator('.tabbar-nav [aria-label="Back"]')
const forwardBtn = (w: Page) => w.locator('.tabbar-nav [aria-label="Forward"]')

const openBase = (w: Page) => layer(w).locator('.base-host .base-view')
const dataRows = (scope: Locator) => scope.locator('.base-table tbody tr:not(.base-table__group):not(.base-table__spacer)')
const rowNames = (scope: Locator) => scope.locator('.base-table__link')
const groupToggles = (scope: Locator) => scope.locator('tr.base-table__group .base-group__toggle')
/** The collapse state of every group, in table order — the assertion YAZ-744 B is really about. */
const groupExpansion = (scope: Locator): Promise<(string | null)[]> =>
  groupToggles(scope).evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')))

const sidebar = (w: Page) => w.locator('.sidebar')
const resizeEdge = (w: Page) => w.locator('.sidebar-resize')

// ---------- gestures ----------

/** The measured width of the sidebar box (border-box, so this is the `--side-w` number). */
async function sidebarWidth(w: Page): Promise<number> {
  const box = await sidebar(w).boundingBox()
  if (box === null) throw new Error('the sidebar has no box')
  return Math.round(box.width)
}

/**
 * Presses on the resize edge and drags it `dx` px horizontally, taking `shot` (if given) while
 * the button is still DOWN — the mid-drag evidence. The handler listens on `window`, so the
 * moves have to be real mouse moves, not a synthetic `dragTo`.
 */
async function dragSidebar(w: Page, dx: number, shot?: string): Promise<void> {
  const box = await resizeEdge(w).boundingBox()
  if (box === null) throw new Error('the sidebar resize edge has no box')
  const y = box.y + box.height / 2
  await w.mouse.move(box.x + box.width / 2, y)
  await w.mouse.down()
  await w.mouse.move(box.x + box.width / 2 + dx, y, { steps: 12 })
  if (shot !== undefined) await shoot(w, shot)
  await w.mouse.up()
}

/** Closes every open tab, leaving the empty state — which also RESETS the per-tab history. */
async function closeAllTabs(w: Page): Promise<void> {
  for (;;) {
    const n = await tabsOf(w).count()
    if (n === 0) break
    await w.locator('.tabbar__close').first().click()
    await expect(tabsOf(w)).toHaveCount(n - 1)
  }
  await expect(w.locator('.editor-msg')).toHaveText('Select a file from the sidebar.')
}

/** Opens `label` from the sidebar into a clean, single-entry history (call after `closeAllTabs`). */
async function startAt(w: Page, label: string, body: string): Promise<void> {
  await fileRow(w, label).click()
  await expect(activeTab(w)).toHaveText(label)
  await expect(editorOf(w)).toContainText(body)
  await expect(backBtn(w)).toBeDisabled()
  await expect(forwardBtn(w)).toBeDisabled()
}

/** Clicks the body wiki link `text` and waits for the SAME tab to land on `label`. */
async function followLink(w: Page, text: string, label: string, body: string): Promise<void> {
  await linkIn(w, text).click()
  await expect(activeTab(w)).toHaveText(label)
  await expect(editorOf(w)).toContainText(body)
}

/** ◀ / ▶ , then the page the step must land on. */
async function step(w: Page, dir: 'back' | 'forward', label: string, body: string): Promise<void> {
  await (dir === 'back' ? backBtn(w) : forwardBtn(w)).click()
  await expect(activeTab(w)).toHaveText(label)
  await expect(editorOf(w)).toContainText(body)
}

const gone = async (p: string): Promise<boolean> => stat(p).then(() => false, () => true)

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'easy-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- YAZ-738: sidebar resize

test('step 1 — the sidebar edge drags 260 → 380', async () => {
  app = await launchApp({
    userData,
    seedState: seededState(vault, path.join(vault, ALL_KPIS), { expanded: FOLDERS.map((f) => path.join(vault, f)) }),
  })
  win = await appWindow(app, 'w1')
  await expect(openBase(win)).toBeVisible()

  expect(await sidebarWidth(win)).toBe(SIDEBAR_DEFAULT_W)
  await expect(resizeEdge(win)).toBeVisible()
  await dragSidebar(win, DRAG_DX, 'easy-sidebar-resize')
  expect(await sidebarWidth(win)).toBe(WIDENED_W)
})

test('step 2 — the width survives quit → relaunch, on disk as AppState.sidebarWidth', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect((await readState(userData)).sidebarWidth).toBe(WIDENED_W)

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(openBase(win)).toBeVisible()
  expect(await sidebarWidth(win)).toBe(WIDENED_W)
})

// ---------------------------------------------------------------- YAZ-744: collapse all groups

test('step 3 — one toolbar button collapses every group of the grouped base', async () => {
  // The fixture's "All KPIs" view groups 5 KPI pages into 4 funnel groups (one KPI fans out
  // into two, one has no funnel at all) — see bible.spec.ts step 1.
  await expect(groupToggles(openBase(win))).toHaveCount(4)
  await expect(dataRows(openBase(win))).toHaveCount(6)
  expect(await groupExpansion(openBase(win))).toEqual(['true', 'true', 'true', 'true'])

  await openBase(win).locator('[aria-label="Collapse all groups"]').click()
  expect(await groupExpansion(openBase(win))).toEqual(['false', 'false', 'false', 'false'])
  await expect(rowNames(openBase(win))).toHaveCount(0) // not one row body left on screen
  await expect(groupToggles(openBase(win))).toHaveCount(4) // the headers themselves stay
  await shoot(win, 'easy-collapse-all')
})

test('step 4 — collapsed across quit → relaunch; the same button expands them again', async () => {
  await quitApp(app)
  // The collapse state is main-owned store state, keyed `<basePath>::<viewName>` — never the .base file.
  const groups = (await readState(userData)).folders[vault].baseGroups
  expect(Object.keys(groups)).toEqual([`${path.join(vault, ALL_KPIS)}::All KPIs`])
  expect(groups[`${path.join(vault, ALL_KPIS)}::All KPIs`]).toHaveLength(4)

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(openBase(win)).toBeVisible()
  expect(await groupExpansion(openBase(win))).toEqual(['false', 'false', 'false', 'false'])
  await expect(rowNames(openBase(win))).toHaveCount(0)

  // The button is now the other half of the toggle.
  await expect(openBase(win).locator('[aria-label="Collapse all groups"]')).toHaveCount(0)
  await openBase(win).locator('[aria-label="Expand all groups"]').click()
  expect(await groupExpansion(openBase(win))).toEqual(['true', 'true', 'true', 'true'])
  await expect(dataRows(openBase(win))).toHaveCount(6)
  await shoot(win, 'easy-expand-all')
})

// ---------------------------------------------------------------- YAZ-741 / 743: GUI evidence

test('step 5 — column dividers with the resize handle hovered, and the ⋯ view menu inside the viewport', async () => {
  // YAZ-741: the header's 1px divider thickens to the accent under the pointer.
  const handle = openBase(win).locator('.base-table__resize').first()
  await expect(handle).toBeVisible()
  await handle.hover()
  await shoot(win, 'easy-table-dividers')

  // YAZ-743: the view menu opens ANCHORED — fully on screen, at its natural height.
  await openBase(win).locator('[aria-label="View menu"]').click()
  const menu = win.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  const view = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThan(100)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(view.w)
  expect(box!.y + box!.height).toBeLessThanOrEqual(view.h)
  await shoot(win, 'easy-view-menu')
  await win.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

// ---------------------------------------------------------------- YAZ-672: spell-check listener

test('step 6 — the window carries a context-menu listener (the spell-check menu is wired)', async () => {
  const listeners = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.listenerCount('context-menu'))
  expect(listeners).toBeGreaterThanOrEqual(1)
})

// ---------------------------------------------------------------- YAZ-721: back / forward

test('step 7 — (a) A → B → C, then Back Back Forward, all in ONE tab', async () => {
  // Closing every tab resets the per-tab stacks, so this starts from a genuinely empty history.
  await closeAllTabs(win)
  await startAt(win, 'Lead Nurture', 'Known contacts that are not yet in a deal')

  await followLink(win, 'Sales-Conversion', 'Sales-Conversion', 'Open pipeline through to closed-won')
  await expect(tabsOf(win)).toHaveCount(1) // a link click NAVIGATES, it never opens a tab
  await expect(backBtn(win)).toBeEnabled()
  await expect(forwardBtn(win)).toBeDisabled()

  await followLink(win, 'CRM Hygiene', 'CRM Hygiene', 'The parent SKU')
  await expect(tabsOf(win)).toHaveCount(1)

  await step(win, 'back', 'Sales-Conversion', 'Open pipeline through to closed-won')
  await expect(forwardBtn(win)).toBeEnabled()
  await step(win, 'back', 'Lead Nurture', 'Known contacts that are not yet in a deal')
  await expect(backBtn(win)).toBeDisabled() // the bottom of the stack
  await expect(forwardBtn(win)).toBeEnabled()
  await shoot(win, 'easy-history-back')

  await step(win, 'forward', 'Sales-Conversion', 'Open pipeline through to closed-won')
  await expect(tabsOf(win)).toHaveCount(1) // …and still exactly one tab at the end of the walk
})

test('step 8 — (b) navigating from a walked-back position truncates the forward entries', async () => {
  // Standing at B with C ahead: going somewhere NEW must drop C, exactly like a browser.
  await expect(forwardBtn(win)).toBeEnabled()
  await followLink(win, 'Win Rate', 'Win Rate', 'Closed-won as a share of closed pipeline')
  await expect(forwardBtn(win)).toBeDisabled()
  await expect(tabsOf(win)).toHaveCount(1)

  await step(win, 'back', 'Sales-Conversion', 'Open pipeline through to closed-won')
  await step(win, 'back', 'Lead Nurture', 'Known contacts that are not yet in a deal')
  await expect(backBtn(win)).toBeDisabled()
})

test('step 9 — (c) a link to an already-open file activates ITS tab, and leaves the source stack alone', async () => {
  await closeAllTabs(win)
  // Give the source page a back entry of its own, so "unchanged" is something to see.
  await startAt(win, 'MQL Volume', 'Marketing-qualified leads per period')
  await followLink(win, 'Lead Gen', 'Lead Gen', 'Everything that turns strangers into known contacts')
  await expect(backBtn(win)).toBeEnabled()

  // ⌘-click opens a BACKGROUND tab (the locked I3 ruling): activation never moves.
  await fileRow(win, 'CAC').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Lead Gen', 'CAC'])
  await expect(activeTab(win)).toHaveText('Lead Gen')

  // The body link now points at a file that is ALREADY open: de-dup by path wins — the CAC tab
  // activates, no third tab appears, and nothing is pushed onto anybody's stack.
  await linkIn(win, 'CAC').click()
  await expect(activeTab(win)).toHaveText('CAC')
  await expect(tabsOf(win)).toHaveCount(2)
  await expect(backBtn(win)).toBeDisabled() // CAC was never navigated TO — it has no stack
  await expect(forwardBtn(win)).toBeDisabled()
  await shoot(win, 'easy-history-already-open')

  // Back on the source tab the stack is exactly what it was: one step back, to MQL Volume.
  await tabsOf(win).filter({ hasText: 'Lead Gen' }).click()
  await expect(backBtn(win)).toBeEnabled()
  await step(win, 'back', 'MQL Volume', 'Marketing-qualified leads per period')
  await expect(tabsOf(win)).toHaveText(['MQL Volume', 'CAC'])
})

test('step 10 — (d) renaming a page BEHIND the current one: Back lands on the new name', async () => {
  await closeAllTabs(win)
  await startAt(win, 'Head of Sales', 'Owns quota attainment')
  await followLink(win, 'Win Rate', 'Win Rate', 'Closed-won as a share of closed pipeline')
  await followLink(win, 'Sales-Conversion', 'Sales-Conversion', 'Open pipeline through to closed-won')

  // Rename the MIDDLE page through the sidebar, while it is only in the stack — not on screen.
  await fileRow(win, 'Win Rate').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(win.locator('.create-inline__input')).toHaveValue('Win Rate')
  await win.locator('.create-inline__input').fill(RENAMED)
  await win.keyboard.press('Enter')
  await expect(win.locator('.link-notice')).toContainText('Updated links in')
  await expect.poll(() => gone(path.join(vault, 'kpis', 'Win Rate.md'))).toBe(true)

  // The stack followed the file: Back opens the renamed page, by its new name and new path.
  await step(win, 'back', RENAMED, 'Closed-won as a share of closed pipeline')
  await expect.poll(() => decodeURI(win.url())).toContain(`${RENAMED}.md`)
  await expect(backBtn(win)).toBeEnabled()
  await shoot(win, 'easy-history-renamed')
  await step(win, 'back', 'Head of Sales', 'Owns quota attainment')
})

test('step 11 — (e) deleting a page behind the current one: Back skips straight past it', async () => {
  await closeAllTabs(win)
  await startAt(win, 'Stage Accuracy', 'Deals sit in stages they have already left')
  await followLink(win, 'CRM Hygiene', 'CRM Hygiene', 'The parent SKU')
  await followLink(win, 'RevOps Lead', 'RevOps Lead', 'Owns the systems of record')

  // Delete the MIDDLE page (sidebar → confirm sheet → the Trash).
  await fileRow(win, 'CRM Hygiene').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Delete' }).click()
  await expect(win.locator('.confirm')).toBeVisible()
  await win.locator('.confirm__btn', { hasText: 'Delete' }).click()
  await expect.poll(() => gone(path.join(vault, 'problems', 'CRM Hygiene.md'))).toBe(true)

  // Back must never step onto a file that is gone: the entry left the stack with the file.
  await step(win, 'back', 'Stage Accuracy', 'Deals sit in stages they have already left')
  await expect(backBtn(win)).toBeDisabled()
  await expect(forwardBtn(win)).toBeEnabled()
  await shoot(win, 'easy-history-deleted')
  await step(win, 'forward', 'RevOps Lead', 'Owns the systems of record')
})

// ---------------------------------------------------------------- YAZ-738: drag-to-close

test('step 12 — dragging the edge past the minimum CLOSES the sidebar rather than shrinking it', async () => {
  expect(await sidebarWidth(win)).toBe(WIDENED_W)
  // Well past 60% of the 180px minimum: the gesture reads as "close it", not "make it tiny".
  await dragSidebar(win, -(WIDENED_W - 40))
  await expect(sidebar(win)).toHaveCount(0)
  await expect(win.locator('[aria-label="Show sidebar"]')).toBeVisible()
  await shoot(win, 'easy-sidebar-closed')
  await quitApp(app)
})
