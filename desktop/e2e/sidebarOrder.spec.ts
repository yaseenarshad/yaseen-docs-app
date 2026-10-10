/**
 * THE ORDER OF THE SIDEBAR, END TO END (YAZ-2631 — decisions D1, D2, D4 and D5): a window on two
 * vaults, Alpha and Beta. A favorite from each → the ♥ tab is ONE flat list, each top row with its
 * vault's name, no vault row, and no folder row with a number → one favorite dragged across the
 * other → quit → relaunch: the order holds → on Files, Beta's vault row dragged above Alpha's →
 * quit → relaunch: the vault rows hold their order.
 *
 * What only the real app can prove is WHERE each order lives. The order across vaults is
 * `favoritesOrder` in `yaseendocs.json`, written through main (`state:set-favorites-order`), while
 * each vault's `.yaseendocs/favorites.json` stays as it was. The order of the vault rows is the
 * window identity's `roots`. Each is read cold after a real quit. The unit tests fake the bridge
 * and pin the cases S1 to S62 that need no real window (`docs/REGRESSION.md` S18 to S22, F14).
 *
 * Both vaults are copies of the generated fixture under FIXED folder names, as in
 * `multiVault.spec.ts`: each row is found by its `data-path`, since the two trees hold the same
 * names, and each vault has answered "Not for this vault" on IDs, so a row reads its file name.
 * THE DRAG is `dragAbove` (helpers.ts), the one `favorites.spec.ts` reorders with.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, copies of the generated fixture,
 * `sidebar-order-` step screenshots, serial.
 */
// Written for YAZ-2631 and NOT RUN: Playwright is off limits for agents here, so every selector was
// read from the source, not observed. The first person who runs it corrects what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppState } from '../../shared/types'
import { activeTab, appWindow, buildFixtureVault, dragAbove, launchApp, lensTab, menuItem, quitApp, readState, SEED_FILE, seededState, shoot, tabsOf, topLabels } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The two vaults' FOLDER names — what the vault rows, the header and a top row's vault name show. */
const ALPHA = 'Alpha Notes'
const BETA = 'Beta Notes'

let userData: string
let vaultSrc: string
/** The parent of both vaults — one temp dir, two fixed-name copies inside it. */
let vaultsDir: string
let vaultA: string
let vaultB: string
let app: ElectronApplication
let win: Page

// ---------- locators (client/src/sidebar/Sidebar.tsx, Tree.tsx) ----------

/** A row of whichever tree the sidebar draws, by its absolute path: the two vaults hold the same names. */
const fileAt = (w: Page, file: string) => w.locator(`.sidebar__body .tree__row--file[data-path="${file}"]`)
const dirAt = (w: Page, dir: string) => w.locator(`.sidebar__body .tree__row--dir[data-path="${dir}"]`)
/** The vault rows (YAZ-2602 D3): one folder row per vault on Files, and none on the ♥ tab (YAZ-2631 S2). */
const vaultRows = (w: Page) => w.locator('.sidebar__body .tree__row--vault')
const vaultRowLabels = (w: Page) => vaultRows(w).locator('.tree__label')
/** The vault name a top row of the ♥ tab shows, small and light (YAZ-2631 D4). */
const vaultTags = (w: Page) => w.locator('.sidebar__body ul[role="tree"] > li > .tree__row .tree__vault')
/** A number on a folder row: there is none (YAZ-2631 D2). The Inbox row's due number is no folder row's. */
const folderNumbers = (w: Page) => w.locator('.sidebar__body .tree__row--dir .tree__count')
const heartTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Favorites"]')
/** The header's name: the vault names joined with " + ", in the window's order (YAZ-2631 S53). */
const headerName = (w: Page) => w.locator('.sidebar__header .sidebar__root-name')
/** App's one passive toast (`.link-notice`) — its text. */
const toast = (w: Page) => w.locator('.link-notice__text')

// ---------- gestures and reads ----------

/** Right-click `row` and take the menu's `label`. */
async function pickFromRowMenu(row: Locator, label: string): Promise<void> {
  await row.click({ button: 'right' })
  await expect(menuItem(win, label)).toBeVisible()
  await menuItem(win, label).click()
}

/** A vault's stored favorites, parsed — vault-RELATIVE paths; null while the file is absent. */
async function favoritesOf(vault: string): Promise<string[] | null> {
  const raw = await readFile(path.join(vault, '.yaseendocs', 'favorites.json'), 'utf8').catch(() => null)
  return raw === null ? null : (JSON.parse(raw) as { favorites: string[] }).favorites
}

/** ONE window on Alpha and Beta, in that order: `seededState` for the window, then its second vault. */
function twoVaultState(): AppState {
  const state = seededState(vaultA, path.join(vaultA, SEED_FILE))
  state.windows = state.windows.map((entry) => ({ ...entry, roots: [vaultA, vaultB] }))
  const now = Date.now()
  state.recents = [
    { path: vaultA, lastOpened: now },
    { path: vaultB, lastOpened: now - 60_000 },
  ]
  state.folders[vaultB] = { expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, name: null, key: null }
  return state
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sidebar-order-userdata-'))
  vaultSrc = await buildFixtureVault()
  vaultsDir = await mkdtemp(path.join(tmpdir(), 'sidebar-order-vaults-'))
  vaultA = path.join(vaultsDir, ALPHA)
  vaultB = path.join(vaultsDir, BETA)
  await Promise.all([cp(vaultSrc, vaultA, { recursive: true }), cp(vaultSrc, vaultB, { recursive: true })])
  // Each vault has said no to IDs ("Two kinds of vault"): no box asks, and nothing is written into a note.
  for (const vault of [vaultA, vaultB]) {
    await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
    await writeFile(path.join(vault, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: false }))
  }
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vaultsDir].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the flat list

test('step 1 — a favorite from each vault: the ♥ tab is ONE flat list in vault order, each top row with its vault\'s name, no vault row, and no folder row with a number (YAZ-2631 S2, S3, S21, S41, R4)', async () => {
  const projectsA = path.join(vaultA, 'Projects')
  const ideasB = path.join(vaultB, 'Ideas.md')
  app = await launchApp({ userData, seedState: twoVaultState() })
  win = await appWindow(app, 'w1')
  // Two vaults: one vault row each on Files, in the window's order, each open with its tree below it.
  await expect(vaultRowLabels(win)).toHaveText([ALPHA, BETA])
  await expect(headerName(win)).toHaveText(`${ALPHA} + ${BETA}`)
  await expect(dirAt(win, projectsA)).toBeVisible()
  await expect(fileAt(win, ideasB)).toBeVisible()

  // Beta's FIRST, then Alpha's: each lands in its own vault's file, and the store is not written (R4).
  await pickFromRowMenu(fileAt(win, ideasB), 'Add to favorites')
  await expect(toast(win)).toHaveText('Added to favorites')
  await pickFromRowMenu(dirAt(win, projectsA), 'Add to favorites')
  await expect.poll(() => favoritesOf(vaultB)).toEqual(['Ideas.md'])
  await expect.poll(() => favoritesOf(vaultA)).toEqual(['Projects'])
  expect((await readState(userData)).favoritesOrder).toEqual([])

  await heartTab(win).click()
  await expect(heartTab(win)).toHaveAttribute('aria-selected', 'true')
  // ONE flat list, and no vault row (S2). With no stored order it is in VAULT order, not the order added (S3).
  await expect(vaultRows(win)).toHaveCount(0)
  await expect(topLabels(win)).toHaveText(['Projects', 'Ideas'])
  // Each top row says whose it is (S41), and the folder row shows no number (S21).
  await expect(vaultTags(win)).toHaveText([ALPHA, BETA])
  await expect(folderNumbers(win)).toHaveCount(0)
  await shoot(win, 'sidebar-order-01-flat-favorites')
})

// ---------------------------------------------------------------- a drag across vaults, and the relaunch

test('step 2 — Beta\'s favorite dragged above Alpha\'s: the new order shows, `favoritesOrder` in yaseendocs.json holds it and no vault file changes; the order holds after quit → relaunch (YAZ-2631 S4, R1, R3)', async () => {
  const projectsA = path.join(vaultA, 'Projects')
  const ideasB = path.join(vaultB, 'Ideas.md')
  await dragAbove(win, fileAt(win, ideasB), dirAt(win, projectsA))
  await expect(topLabels(win)).toHaveText(['Ideas', 'Projects'])
  await expect(vaultTags(win)).toHaveText([BETA, ALPHA])
  await expect(win.locator('.tree__row--drop-before, .tree__row--drop-after')).toHaveCount(0) // the line goes with the drag
  // The order ACROSS vaults is the store's (R1). Each vault's own order is as it was, so no vault file is written (S4, R3).
  await expect.poll(async () => (await readState(userData)).favoritesOrder).toEqual([ideasB, projectsA])
  expect(await favoritesOf(vaultA)).toEqual(['Projects'])
  expect(await favoritesOf(vaultB)).toEqual(['Ideas.md'])
  await shoot(win, 'sidebar-order-02-dragged-across-vaults')

  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect((await readState(userData)).favoritesOrder).toEqual([ideasB, projectsA])
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(heartTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Ideas', 'Projects'])
  await expect(vaultTags(win)).toHaveText([BETA, ALPHA])
  await shoot(win, 'sidebar-order-03-favorites-restored')
})

// ---------------------------------------------------------------- the vault rows

test('step 3 — on Files, Beta\'s vault row dragged above Alpha\'s: the vault rows and the header take the new order, the tab stays, and `roots` holds it (YAZ-2631 S45, S47, S53)', async () => {
  await lensTab(win, 'Files').click()
  await expect(vaultRowLabels(win)).toHaveText([ALPHA, BETA])
  // A vault row is a folder row whose path is the vault's root.
  await dragAbove(win, dirAt(win, vaultB), dirAt(win, vaultA))

  await expect(vaultRowLabels(win)).toHaveText([BETA, ALPHA])
  await expect(headerName(win)).toHaveText(`${BETA} + ${ALPHA}`)
  await expect(win.locator('.tree__row--drop-before, .tree__row--drop-after')).toHaveCount(0)
  // The tab that was open stays (S47), and no file moved: each vault still holds its own tree.
  await expect(tabsOf(win)).toHaveCount(1)
  await expect(activeTab(win)).toHaveAttribute('title', path.join(vaultA, SEED_FILE))
  await expect(fileAt(win, path.join(vaultA, 'Ideas.md'))).toBeVisible()
  await expect(fileAt(win, path.join(vaultB, 'Ideas.md'))).toBeVisible()
  // The order of the vault rows is the window identity's `roots`, and `root` is its first entry (S46).
  await expect.poll(async () => (await readState(userData)).windows[0]?.roots).toEqual([vaultB, vaultA])
  expect((await readState(userData)).windows[0]?.root).toBe(vaultB)
  await shoot(win, 'sidebar-order-04-vault-rows-reordered')
})

test('step 4 — the order of the vault rows holds after quit → relaunch, and the favorites keep their stored order (YAZ-2631 S46)', async () => {
  await quitApp(app)
  expect((await readState(userData)).windows[0]?.roots).toEqual([vaultB, vaultA])

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(vaultRowLabels(win)).toHaveText([BETA, ALPHA])
  await expect(headerName(win)).toHaveText(`${BETA} + ${ALPHA}`)
  await expect(folderNumbers(win)).toHaveCount(0)
  await shoot(win, 'sidebar-order-05-vault-rows-restored')

  // The stored order across vaults still says which vault has each place: a new vault order does not move it.
  await heartTab(win).click()
  await expect(topLabels(win)).toHaveText(['Ideas', 'Projects'])
  expect((await readState(userData)).favoritesOrder).toEqual([path.join(vaultB, 'Ideas.md'), path.join(vaultA, 'Projects')])
  await quitApp(app)
})
