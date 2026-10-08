/**
 * THE FOCUS TAB, END TO END (S12 of YAZ-2171 — YAZ-2619, which replaces the Focus Mode of
 * YAZ-1605 / 1628): right-click a folder or a file → "Add to focus" puts it in the window's focus
 * list and shows the Focus tab (the eye, between the Search tab and the heart), where each item is a top
 * row in the order added. The Files tab is never narrowed. "Remove from focus" takes one item
 * out, and "Clear" — on the line above the list — empties it.
 *
 * What only the real app can prove is WHERE the list lives: it is WINDOW identity
 * (`WindowEntry.focusList`, next to the lens), written to `yaseendocs.json` through main and
 * restored from it — so quit → relaunch comes back on the Focus tab with the same rows, on a tree
 * that is otherwise folded (expansion is session state, YAZ-1642: a focused folder's row is there,
 * its children are not).
 *
 * The unit tests (client/src/sidebar/Sidebar.test.tsx, `focus tab (YAZ-2619)`) fake the bridge and
 * pin the labels, the notices and every case S1 to S40 that needs no real window.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a COPY of the generated fixture,
 * `focus-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, dirRow, fileRow, launchApp, lensTab, menuItem, quitApp, readState, SEED_FILE, seededState, shoot, topLabels } from './helpers'

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

/** The window's stored list — window identity (YAZ-1628): the window's entry, never the vault bucket. */
const focusListOnDisk = async (): Promise<string[] | undefined> => (await readState(userData)).windows[0]?.focusList

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

test('step 1 — "Add to focus" on a folder shows the Focus tab with the folder as an open top row, leaves the Files tab whole and writes `focusList` to the window\'s state entry', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(dirRow(win, 'Projects')).toBeVisible()
  // The tab row reads Files, magnifier, eye, heart (S18; the Search tab since YAZ-2638 D2) — and no eye button stands at its far end.
  await expect(win.locator('.sidebar__lenses [role="tab"]')).toHaveCount(4)
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
  await expect.poll(focusListOnDisk).toEqual([path.join(vault, 'Projects')])
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
  await expect.poll(focusListOnDisk).toEqual([path.join(vault, 'Projects'), path.join(vault, 'Ideas.md')])
  await expect.poll(async () => (await readState(userData)).windows[0]?.sidebarLens).toBe('focus')
  await shoot(win, 'focus-03-file-added')
})

// ---------------------------------------------------------------- the relaunch

test('step 3 — the list and the active tab survive quit → relaunch: the Focus tab comes back with both rows, the folder folded', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect(await focusListOnDisk()).toEqual([path.join(vault, 'Projects'), path.join(vault, 'Ideas.md')])
  expect((await readState(userData)).windows[0]?.sidebarLens).toBe('focus')

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

// ---------------------------------------------------------------- remove one

test('step 4 — "Remove from focus" on one item takes that row out and keeps the tab', async () => {
  await pickFromRowMenu(fileRow(win, 'Ideas'), 'Remove from focus')
  await expect(toast(win)).toHaveText('Removed from focus')
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true') // a remove keeps the tab (R5)
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(countLine(win)).toHaveText('1 in focus')
  await expect.poll(focusListOnDisk).toEqual([path.join(vault, 'Projects')])
  await shoot(win, 'focus-05-one-removed')
})

// ---------------------------------------------------------------- clear

test('step 5 — "Clear" empties the list: the empty message shows, the count line goes, the tab stays, `focusList` is empty', async () => {
  await clearButton(win).click()
  await expect(bodyMsg(win)).toHaveText('Nothing in focus. Right-click a file or folder → Add to focus.')
  await expect(countLine(win)).toHaveCount(0)
  await expect(topLabels(win)).toHaveCount(0)
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true') // "Clear" keeps the tab (R5)
  await expect.poll(focusListOnDisk).toEqual([])
  await shoot(win, 'focus-06-cleared')
  await quitApp(app)
})
