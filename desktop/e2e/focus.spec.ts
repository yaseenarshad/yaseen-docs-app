/**
 * THE FOCUS TAB, END TO END (S12 of YAZ-2171 — YAZ-2619, which replaces the Focus Mode of
 * YAZ-1605 / 1628): right-click a folder or a file → "Add to focus" puts it in the focus list of
 * its vault and shows the Focus tab (the eye, between the Search tab and the heart), where each item
 * is a top row in the order added. The Files tab is never narrowed. "Remove from focus" takes one
 * item out, and "Clear" — on the line above the list — empties it.
 *
 * What only the real app can prove is WHERE the list lives: IN THE VAULT (YAZ-2702 Decisions 1 and
 * 2), in `<vault>/.yaseendocs/focus.<mac id>.json`, written through main — never in the window's
 * entry of `yaseendocs.json`, which keeps the active tab alone. So quit → relaunch comes back on
 * the Focus tab with the same rows (S8), a second window on the vault shows the same list and
 * follows a change made in the first (S7, S10), and the tree is otherwise folded (expansion is
 * session state, YAZ-1642: a focused folder's row is there, its children are not).
 *
 * The unit tests (client/src/sidebar/Sidebar.test.tsx, `focus tab (YAZ-2619)`) fake the bridge and
 * pin the labels, the notices and every case that needs no real window.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a COPY of the generated fixture,
 * `focus-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, tabsOf, appWindow, buildFixtureVault, clickMenuItem, closeWindow, copyVault, dirRow, extraWindow, fileRow, focusOnDisk, launchApp, lensTab, menuItem, quitApp, readState, searchBar, SEED_FILE, seededState, wholeRow, shoot, topLabels, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (client/src/sidebar/Sidebar.tsx, Tree.tsx) ----------

/** The Focus tab: a glyph (the eye), so its name lives in `aria-label` (YAZ-2619 D4). */
const focusTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Focus"]')
/** The line above the Focus list (D4): the count of top rows, and "Clear". */
const countLine = (w: Page) => w.locator('.sidebar__body .sidebar__focus-bar span')
const clearButton = (w: Page) => w.locator('.sidebar__body .sidebar__focus-clear')
const bodyMsg = (w: Page) => w.locator('.sidebar__body .sidebar__msg')
/** App's one passive toast (`.link-notice`, YAZ-1341) — its text. */
const toast = (w: Page) => w.locator('.link-notice__text')
const openDirs = (w: Page) => w.locator('.sidebar__body li[role="treeitem"][aria-expanded="true"]')

/** The vault's stored list (YAZ-2702): its focus file, vault-RELATIVE paths; null while the vault has none. */
const focusListOnDisk = (): Promise<string[] | null> => focusOnDisk(vault)

/** Right-click `row` and take the menu's `label` — the only way in for the add and the remove. */
async function pickFromRowMenu(row: Locator, label: 'Add to focus' | 'Remove from focus'): Promise<void> {
  await row.click({ button: 'right' })
  await expect(menuItem(win, label)).toBeVisible()
  await menuItem(win, label).click()
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'focus-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- add a folder

test('step 1 — "Add to focus" on a folder shows the Focus tab with the folder as an open top row, leaves the Files tab whole and writes the list to the VAULT\'s focus file, not to the state file', async () => {
  app = await launchApp({ userData, seedState: wholeRow(seededState(vault, path.join(vault, SEED_FILE))) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  expect(await focusListOnDisk()).toBeNull() // a read creates nothing (YAZ-2702 R6): no focus file until the first add
  await expect(dirRow(win, 'Projects')).toBeVisible()
  // The tab row reads Files, magnifier, eye, heart, stack, clock (S18; the Search tab since YAZ-2638 D2, Sessions since YAZ-3147 D4, Recents since YAZ-3235 D4) — and no eye button stands at its far end.
  await expect(win.locator('.sidebar__lenses [role="tab"]')).toHaveCount(6)
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'false')

  await pickFromRowMenu(dirRow(win, 'Projects'), 'Add to focus')
  await expect(toast(win)).toHaveText('Added to focus')
  // The add shows the Focus tab (D3): the folder is its one top row — and OPEN (R4).
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(fileRow(win, 'Roadmap')).toBeVisible()
  await expect(dirRow(win, 'archive')).toBeVisible()
  await expect(fileRow(win, 'Ideas')).toHaveCount(0)
  await expect(countLine(win)).toHaveText('1 in focus')
  await expect.poll(focusListOnDisk).toEqual(['Projects'])
  // The state file holds no focus list (YAZ-2702 Decision 1): not on the window's entry, not in the vault bucket.
  expect((await readState(userData)).windows[0]).not.toHaveProperty('focusList')
  expect((await readState(userData)).folders[vault]).not.toHaveProperty('focusList')
  await shoot(win, 'focus-01-folder-added')

  // The Files tab is never narrowed (S40): the full vault, and the row there now reads Remove (S5).
  await lensTab(win, 'Files').click()
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(fileRow(win, 'Welcome note')).toBeVisible()
  await expect(topLabels(win)).toHaveCount(3) // Projects + Ideas, Welcome note
  await expect(countLine(win)).toHaveCount(0)
  await dirRow(win, 'Projects').click({ button: 'right' })
  await expect(menuItem(win, 'Remove from focus')).toBeVisible()
  await win.keyboard.press('Escape')
  await shoot(win, 'focus-02-files-still-whole')
})

// ---------------------------------------------------------------- add a file

test('step 2 — "Add to focus" on a file, from the Files tab, puts it at the end of the list and shows the Focus tab again', async () => {
  await pickFromRowMenu(fileRow(win, 'Ideas'), 'Add to focus')
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  // The order ADDED, never the tree's (D2): the folder first, then the file.
  await expect(topLabels(win)).toHaveText(['Projects', 'Ideas'])
  await expect(countLine(win)).toHaveText('2 in focus')
  await expect.poll(focusListOnDisk).toEqual(['Projects', 'Ideas.md'])
  await expect.poll(async () => (await readState(userData)).windows[0]?.sidebarLens).toBe('focus')
  await shoot(win, 'focus-03-file-added')
})

// ---------------------------------------------------------------- the relaunch

test('step 3 — the list and the active tab survive quit → relaunch: the list is the vault\'s file, the tab the window\'s, and the Focus tab comes back with both rows, the folder folded (YAZ-2702 S8)', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect(await focusListOnDisk()).toEqual(['Projects', 'Ideas.md'])
  expect((await readState(userData)).windows[0]?.sidebarLens).toBe('focus')
  expect((await readState(userData)).windows[0]).not.toHaveProperty('focusList')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Projects', 'Ideas'])
  await expect(countLine(win)).toHaveText('2 in focus')
  // Folded: the list is durable, the expansion is not (YAZ-1642) — the row, without its children.
  await expect(openDirs(win)).toHaveCount(0)
  await expect(fileRow(win, 'Roadmap')).toHaveCount(0)
  await shoot(win, 'focus-04-restored-folded')
})

// ---------------------------------------------------------------- a second window, and remove one

test('step 4 — a second window on the vault shows the same list (YAZ-2702 S7, S10); "Remove from focus" in the first takes that row out of both and keeps the tab', async () => {
  // ⌘⇧N (menu.file.new-window) opens a window on the same vault — lens included — on the blank tab, whose caret is
  // in the search (YAZ-3343 D35). The Focus tab is its stored lens, one click away. It was handed no list: it read
  // the vault's, as each window does (S10).
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  const dup = await extraWindow(app, ['w1'])
  const dupId = winParam(dup)!
  expect(await windowCount(app)).toBe(2)
  await expect(searchBar(dup)).toBeFocused()
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === dupId)?.sidebarLens).toBe('focus')
  await focusTab(dup).click()
  await expect(focusTab(dup)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(dup)).toHaveText(['Projects', 'Ideas'])
  await expect(countLine(dup)).toHaveText('2 in focus')

  // Remove in the FIRST window: the toast, the file, and the OTHER window's rows — which it can
  // only know through main's `focus:changed` off the file it just wrote (S7).
  await pickFromRowMenu(fileRow(win, 'Ideas'), 'Remove from focus')
  await expect(toast(win)).toHaveText('Removed from focus')
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true') // a remove keeps the tab (R5)
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(countLine(win)).toHaveText('1 in focus')
  await expect.poll(focusListOnDisk).toEqual(['Projects'])
  await expect(topLabels(dup)).toHaveText(['Projects'])
  await expect(countLine(dup)).toHaveText('1 in focus')
  await shoot(dup, 'focus-05-second-window')

  // The window closes and is forgotten; the list is the vault's, so it stays (S8).
  await closeWindow(app, dupId)
  await expect.poll(() => windowCount(app)).toBe(1)
  expect(await focusListOnDisk()).toEqual(['Projects'])
})

// ---------------------------------------------------------------- a folder and its subfolder (YAZ-3131)

test('step 4b — a folder and its subfolder both in focus: each copy of the subfolder folds on its own, and the open page lights in the copy that was clicked (YAZ-3131 S1, S2, S4, S11)', async () => {
  // Projects is the one item; open it and put its subfolder in focus too, so `archive` shows two times.
  await dirRow(win, 'Projects').click()
  await pickFromRowMenu(dirRow(win, 'archive'), 'Add to focus')
  await expect(toast(win)).toHaveText('Added to focus')
  await expect(topLabels(win)).toHaveText(['Projects', 'archive'])
  const archive = dirRow(win, 'archive') // 0: inside Projects, 1: the top row
  const item = (copy: number) => archive.nth(copy).locator('..')
  const plan = fileRow(win, 'Old plan')
  await expect(archive).toHaveCount(2)
  // The add opened the new item's own row alone (S4): the copy inside Projects stays closed.
  await expect(item(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(plan).toHaveCount(1)

  // A click folds one copy, never the other (S1).
  await archive.nth(1).click()
  await expect(item(1)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(0)).toHaveAttribute('aria-expanded', 'false')
  await archive.nth(0).click()
  await expect(item(0)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(1)).toHaveAttribute('aria-expanded', 'false')
  await archive.nth(1).click()
  await expect(plan).toHaveCount(2)

  // Files keeps its own folds (S2): no fold of the Focus tab opened anything there. (An OPENED page
  // still opens its folders in Files, its rule since YAZ-1642, so this is checked before any page opens.)
  await lensTab(win, 'Files').click()
  await expect(dirRow(win, 'Projects').locator('..')).toHaveAttribute('aria-expanded', 'false')
  await focusTab(win).click()
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(plan).toHaveCount(2) // the tab's folds outlived the trip to Files

  // The open page lights in the copy that was clicked, and only there (S11).
  await plan.nth(1).click()
  await expect(plan.nth(1)).toHaveClass(/tree__row--active/)
  await expect(plan.nth(0)).not.toHaveClass(/tree__row--active/)
  await expect(win.locator('.sidebar__body .tree__row--active')).toHaveCount(1)
  await plan.nth(0).click()
  await expect(plan.nth(0)).toHaveClass(/tree__row--active/)
  await expect(plan.nth(1)).not.toHaveClass(/tree__row--active/)
  await shoot(win, 'focus-05b-two-copies')
})

test('step 4c — ← and → fold one copy in the real app, and a click that closes the folder of the open page in its copy leaves no row lit (YAZ-3131 S6, S13)', async () => {
  const archive = dirRow(win, 'archive') // 0: inside Projects, 1: the top row
  const item = (copy: number) => archive.nth(copy).locator('..')
  const plan = fileRow(win, 'Old plan')
  await expect(item(0)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(1)).toHaveAttribute('aria-expanded', 'true')
  // S6: the arrow keys fold the copy that has the keyboard focus.
  await archive.nth(1).focus()
  await win.keyboard.press('ArrowLeft')
  await expect(item(1)).toHaveAttribute('aria-expanded', 'false')
  await expect(item(0)).toHaveAttribute('aria-expanded', 'true')
  await win.keyboard.press('ArrowRight')
  await expect(item(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(plan).toHaveCount(2)
  // S13: open the page from copy 1, then close archive in copy 1 with a click.
  await plan.nth(1).click()
  await expect(plan.nth(1)).toHaveClass(/tree__row--active/)
  await archive.nth(1).click()
  await expect(item(1)).toHaveAttribute('aria-expanded', 'false')
  await expect(plan).toHaveCount(1)
  await shoot(win, 'focus-4c-s13')
  await expect(win.locator('.sidebar__body .tree__row--active')).toHaveCount(0)
})

test('step 4d — a page clicked in copy 1, a fold click, another tab, then its own tab again: the page lights in the first copy that shows it (YAZ-3131 S12, Decision 3)', async () => {
  const archive = dirRow(win, 'archive') // 0: inside Projects, 1: the top row
  const item = (copy: number) => archive.nth(copy).locator('..')
  const plan = fileRow(win, 'Old plan')
  // After 4c: the page was clicked in copy 1, and copy 1 is closed. Open copy 1 again with a click.
  await archive.nth(1).click()
  await expect(item(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(item(0)).toHaveAttribute('aria-expanded', 'true')
  await expect(plan).toHaveCount(2)
  const other = tabsOf(win).filter({ hasNotText: 'Old plan' }).first()
  await expect(other).toHaveCount(1)
  await other.click()
  await expect(activeTab(win)).not.toHaveText(/Old plan/)
  await tabsOf(win).filter({ hasText: 'Old plan' }).first().click()
  await expect(activeTab(win)).toHaveText(/Old plan/)
  await shoot(win, 'focus-4d-s12')
  // S12: opened from the tab bar, the page lights in the first copy whose folds show it — copy 0.
  await expect(plan.nth(0)).toHaveClass(/tree__row--active/)
  await expect(plan.nth(1)).not.toHaveClass(/tree__row--active/)
})

test('step 4e — "Open folder page" opens the FOLDER page of archive in copy 1: its row lights in copy 1 (Decision 3; YAZ-3377 D2)', async () => {
  const archive = dirRow(win, 'archive') // 0: inside Projects, 1: the top row
  await expect(archive).toHaveCount(2)
  await archive.nth(1).click({ button: 'right' })
  await menuItem(win, 'Open folder page').click()
  await expect(activeTab(win)).toHaveText(/archive/)
  await expect(archive).toHaveCount(2)
  await shoot(win, 'focus-4e-folder-page')
  await expect(archive.nth(1)).toHaveClass(/tree__row--active/)
  await expect(archive.nth(0)).not.toHaveClass(/tree__row--active/)
})

// ---------------------------------------------------------------- clear

test('step 5 — "Clear" empties the list: the empty message shows, the count line goes, the tab stays, and the vault\'s focus file holds an empty list', async () => {
  await clearButton(win).click()
  await expect(bodyMsg(win)).toHaveText('Nothing in focus. Right-click a file or folder → Add to focus.')
  await expect(countLine(win)).toHaveCount(0)
  await expect(topLabels(win)).toHaveCount(0)
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true') // "Clear" keeps the tab (R5)
  await expect.poll(focusListOnDisk).toEqual([])
  await shoot(win, 'focus-06-cleared')
  await quitApp(app)
})
