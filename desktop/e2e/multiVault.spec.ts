/**
 * SEVERAL VAULTS IN ONE WINDOW, END TO END (YAZ-2602 — decisions D1 to D8, amendments A1 to A9):
 * the user flow of the hand walk, in its order. A window on vault Alpha, with Beta a recent vault:
 * add Beta from the blank-space menu → two vault rows and the header's two names → a tab of each
 * vault, and the window title follows the vault of the tab in front → a folder of each vault on the
 * Focus tab, each with its vault's name → a favorite in each vault, both in the one flat list of the
 * ♥ tab, each with its vault's name (YAZ-2631 D1) → a search, on the Search tab (YAZ-2638 D2), that
 * finds a note of the same name in both, each under its vault's row → "Save as workspace…" from the header → "Remove from this
 * window" on Beta's row → the workspace opened from the ⌘O list, in a NEW window with both vaults →
 * `yaseendocs.json` holds `roots` of two vaults and one `vaultSets` entry. The drag of a favorite
 * across vaults and the drag of a vault row are `sidebarOrder.spec.ts`.
 *
 * What only the real app can prove: that the list of vaults is WINDOW identity written through main
 * (`WindowEntry.roots`), that each vault's favorites land in ITS `.yaseendocs/favorites.json`, and
 * that main's `window.openSet` door opens ONE window on the whole set. The unit tests fake the
 * bridge and pin every notice, menu and refusal (`docs/REGRESSION.md` S17, W9).
 *
 * Both vaults are copies of the generated fixture under FIXED folder names, so each row is found by
 * its `data-path` — the two trees hold the same names — and the titles read as sentences. Each
 * vault has answered "Not for this vault" on IDs before the launch (`.yaseendocs/ids.json`), so the
 * box that asks never stands over the window and a row reads its file name.
 *
 * Never the system folder picker: Beta is a KNOWN vault, added by its row in the flyout. ⌘O is a
 * native accelerator Playwright cannot press, so step 8 drives its menu item by id
 * (`menu.file.switch-vault`).
 * Same harness as the rest of the suite: temp `--user-data-dir`, copies of the generated fixture,
 * `multi-vault-` step screenshots, serial.
 */
// Written for YAZ-2602 and NOT RUN: Playwright is off limits for agents here, so every selector was
// read from the source, not observed. The first person who runs it corrects what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppState } from '../../shared/types'
import { activeTab, appWindow, buildFixtureVault, clickMenuItem, editorOf, extraWindow, launchApp, lensTab, menuItem, quitApp, readState, searchBar, SEED_BODY, SEED_FILE, seededState, shoot, showSearchTab, tabsOf, topLabels, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The two vaults' FOLDER names — what the vault rows, the header and the titles show. */
const ALPHA = 'Alpha Notes'
const BETA = 'Beta Notes'
/** The name step 6 saves the two vaults under. */
const WORKSPACE = 'Client work'
/** Beta's `Ideas.md` is rewritten before the launch, so the editor says which vault's note is in front. */
const BETA_IDEAS_BODY = 'beta-idea-body'

/** The OS window title contract (client/src/lib/windowTitle.ts): `<vault NAME — page>`, the vault of the tab in front (YAZ-2602 R3). */
const titleOf = (file: string, vaultName: string): string => `${vaultName} — ${path.basename(file).replace(/\.md$/, '')}`

let userData: string
let vaultSrc: string
/** The parent of both vaults — one temp dir, two fixed-name copies inside it. */
let vaultsDir: string
let vaultA: string
let vaultB: string
let app: ElectronApplication
let win: Page

// ---------- locators (client/src/sidebar/Sidebar.tsx, Tree.tsx, VaultSwitcher.tsx, client/src/tabs/TabBar.tsx) ----------

/** A row of whichever tree the sidebar draws, by its absolute path: the two vaults hold the same names. */
const fileAt = (w: Page, file: string) => w.locator(`.sidebar__body .tree__row--file[data-path="${file}"]`)
const dirAt = (w: Page, dir: string) => w.locator(`.sidebar__body .tree__row--dir[data-path="${dir}"]`)
/** The vault rows (D3): one folder row per vault, only while the window has two or more. */
const vaultRows = (w: Page) => w.locator('.sidebar__body .tree__row--vault')
const vaultRowLabels = (w: Page) => vaultRows(w).locator('.tree__label')
/** The vault name a top row of the Focus tab and of the ♥ tab shows, small and light (A4; YAZ-2631 D4). */
const vaultTags = (w: Page) => w.locator('.sidebar__body ul[role="tree"] > li > .tree__row .tree__vault')
const focusTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Focus"]')
const heartTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Favorites"]')
const countLine = (w: Page) => w.locator('.sidebar__body .sidebar__focus-bar span')
/** A search result is a tree row (YAZ-2620): a MATCH, or — dim — a row that only gives a match its place. */
const matchRows = (w: Page) => w.locator('.sidebar__body .tree__row:not(.tree__row--context)')
/** App's one passive toast (`.link-notice`) — its text. */
const toast = (w: Page) => w.locator('.link-notice__text')
/** A tab's button: its `title` is the page's path. */
const tabAt = (w: Page, file: string) => w.locator(`.tabbar__btn[title="${file}"]`)
/** The header's trigger and the name it shows: one vault's, several joined with " + ", or a workspace's (S15). */
const trigger = (w: Page) => w.locator('.sidebar__header .sidebar__root')
const headerName = (w: Page) => w.locator('.sidebar__header .sidebar__root-name')
/** The ⌘O panel, its filter, its rows — the workspaces' and the vaults' alike — and its group labels. */
const panel = (w: Page) => w.locator('.ctx-menu--panel')
const filter = (w: Page) => w.locator('.vault-switcher__filter')
const rowNamed = (w: Page, name: string) => w.locator('.vault-switcher__rows .vault-switcher__row').filter({ has: w.locator('.vault-switcher__name', { hasText: new RegExp(`^${name}$`) }) })
const groupLabels = (w: Page) => w.locator('.vault-switcher__rows .vault-switcher__label')
const highlighted = (w: Page) => w.locator('.vault-switcher__row--active')
/** The items of the menu that is open, top level: a flyout's items join them only once it is open. */
const menuItems = (w: Page) => w.locator('.ctx-overlay .ctx-menu [role="menuitem"]')

// ---------- gestures ----------

/** Right-click the sidebar body under its last row: the blank space, wherever the tree ends. */
async function rightClickBlank(w: Page): Promise<void> {
  const body = await w.locator('.sidebar__body').boundingBox()
  const tree = await w.locator('.sidebar__body ul[role="tree"]').first().boundingBox()
  if (body === null || tree === null) throw new Error('the sidebar has no tree to click under')
  await w.locator('.sidebar__body').click({ button: 'right', position: { x: 20, y: tree.y + tree.height - body.y + 24 } })
}

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

/**
 * One window on Alpha with Beta a recents-only vault: `seededState` for the window, then Beta as
 * the OLDER recent — a KNOWN vault, which is what the "Add vault to this window" flyout lists.
 */
function oneVaultState(): AppState {
  const state = seededState(vaultA, path.join(vaultA, SEED_FILE))
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
  userData = await mkdtemp(path.join(tmpdir(), 'multi-vault-userdata-'))
  vaultSrc = await buildFixtureVault()
  vaultsDir = await mkdtemp(path.join(tmpdir(), 'multi-vault-vaults-'))
  vaultA = path.join(vaultsDir, ALPHA)
  vaultB = path.join(vaultsDir, BETA)
  await Promise.all([cp(vaultSrc, vaultA, { recursive: true }), cp(vaultSrc, vaultB, { recursive: true })])
  await writeFile(path.join(vaultB, 'Ideas.md'), `# Ideas\n\n${BETA_IDEAS_BODY}\n`)
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

// ---------------------------------------------------------------- add a vault

test('step 1 — "Add vault to this window ▸" on the blank space adds a known vault: two vault rows, both open, the header names both, the tab stays, `roots` holds both', async () => {
  app = await launchApp({ userData, seedState: oneVaultState() })
  win = await appWindow(app, 'w1')
  // One vault: the sidebar of before this work — no vault row (S11), the header is the vault's name.
  await expect(fileAt(win, path.join(vaultA, 'Ideas.md'))).toBeVisible()
  await expect(vaultRows(win)).toHaveCount(0)
  await expect(headerName(win)).toHaveText(ALPHA)

  // The flyout lists the known vaults that are not in this window, then "Open folder…" (S1).
  await rightClickBlank(win)
  await menuItem(win, 'Add vault to this window').hover()
  await expect(win.locator('.ctx-menu__sub .ctx-menu__item')).toHaveText([BETA, 'Open folder…'])
  await shoot(win, 'multi-vault-01-add-flyout')
  await win.locator('.ctx-menu__sub .ctx-menu__item', { hasText: BETA }).click()

  // One folder row per vault, in the order added, each open (D3, R9), with its own tree below it.
  await expect(vaultRowLabels(win)).toHaveText([ALPHA, BETA])
  await expect(win.locator('.sidebar__body li[role="treeitem"][aria-expanded="true"]:has(> .tree__row--vault)')).toHaveCount(2)
  await expect(fileAt(win, path.join(vaultA, 'Ideas.md'))).toBeVisible()
  await expect(fileAt(win, path.join(vaultB, 'Ideas.md'))).toBeVisible()
  // The header names the vaults (S15), and the tab that was open stays (S2).
  await expect(headerName(win)).toHaveText(`${ALPHA} + ${BETA}`)
  await expect(tabsOf(win)).toHaveCount(1)
  await expect.poll(() => win.title()).toBe(titleOf(SEED_FILE, ALPHA))
  // The list of vaults is the window's identity: `root` is its first entry. The added vault leads the recents (S2).
  await expect.poll(async () => (await readState(userData)).windows[0]?.roots).toEqual([vaultA, vaultB])
  expect((await readState(userData)).windows[0]?.root).toBe(vaultA)
  await expect.poll(async () => (await readState(userData)).recents[0]?.path).toBe(vaultB)
  await shoot(win, 'multi-vault-02-two-vault-rows')

  // With two or more vaults the blank space is no one vault's: its menu holds the add item alone (S10).
  await rightClickBlank(win)
  await expect(menuItems(win)).toHaveText(['Add vault to this window'])
  await win.keyboard.press('Escape')
})

// ---------------------------------------------------------------- tabs of two vaults

test('step 2 — a tab of each vault: the switch shows each note, and the window title starts with the vault of the tab in front', async () => {
  const welcomeA = path.join(vaultA, SEED_FILE)
  const ideasB = path.join(vaultB, 'Ideas.md')
  // ⌘-click opens a background tab (I3): the strip holds a tab of each vault (S29).
  await fileAt(win, ideasB).click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveCount(2)
  await expect.poll(() => win.title()).toBe(titleOf(SEED_FILE, ALPHA))

  await tabAt(win, ideasB).click()
  await expect(activeTab(win)).toHaveAttribute('title', ideasB)
  await expect(editorOf(win)).toContainText(BETA_IDEAS_BODY)
  await expect.poll(() => win.title()).toBe(titleOf('Ideas.md', BETA)) // the ACTIVE vault's name (R3, S36)
  await shoot(win, 'multi-vault-03-tab-of-beta')

  await tabAt(win, welcomeA).click()
  await expect(activeTab(win)).toHaveAttribute('title', welcomeA)
  await expect(editorOf(win)).toContainText(SEED_BODY)
  await expect.poll(() => win.title()).toBe(titleOf(SEED_FILE, ALPHA))
  await expect.poll(async () => (await readState(userData)).windows[0]?.tabs).toEqual([welcomeA, ideasB])
  // A note is the last file of the vault that HOLDS it, not of the window's first vault.
  expect((await readState(userData)).folders[vaultB]?.lastFile).toBe(ideasB)
})

// ---------------------------------------------------------------- focus across vaults

test('step 3 — "Add to focus" on a folder of each vault: the Focus tab lists both in the order added, each with its vault\'s name', async () => {
  const projectsA = path.join(vaultA, 'Projects')
  const projectsB = path.join(vaultB, 'Projects')
  await pickFromRowMenu(dirAt(win, projectsA), 'Add to focus')
  await expect(toast(win)).toHaveText('Added to focus')
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true') // an add shows the Focus tab
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(vaultTags(win)).toHaveText([ALPHA]) // said only with two or more vaults (A4)

  await lensTab(win, 'Files').click()
  await pickFromRowMenu(dirAt(win, projectsB), 'Add to focus')
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  // ONE list for the window, across its vaults (A1): the order ADDED, and each top row says whose it is.
  await expect(topLabels(win)).toHaveText(['Projects', 'Projects'])
  await expect(vaultTags(win)).toHaveText([ALPHA, BETA])
  await expect(countLine(win)).toHaveText('2 in focus')
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusList).toEqual([projectsA, projectsB])
  await shoot(win, 'multi-vault-04-focus-two-vaults')
})

// ---------------------------------------------------------------- favorites across vaults

test('step 4 — a favorite in each vault is written to THAT vault\'s favorites.json, and the ♥ tab shows both in ONE flat list, each with its vault\'s name (YAZ-2631 S2, S3, S41)', async () => {
  const ideasA = path.join(vaultA, 'Ideas.md')
  const welcomeB = path.join(vaultB, SEED_FILE)
  await lensTab(win, 'Files').click()
  await pickFromRowMenu(fileAt(win, ideasA), 'Add to favorites')
  await expect(toast(win)).toHaveText('Added to favorites')
  await pickFromRowMenu(fileAt(win, welcomeB), 'Add to favorites')
  // Each vault keeps its own list (S25; YAZ-2631 D1): one file per vault, vault-relative paths.
  await expect.poll(() => favoritesOf(vaultA)).toEqual(['Ideas.md'])
  await expect.poll(() => favoritesOf(vaultB)).toEqual([SEED_FILE])

  await heartTab(win).click()
  await expect(heartTab(win)).toHaveAttribute('aria-selected', 'true')
  // ONE flat list across the vaults, and no vault row (S2): with no stored order, in vault order (S3).
  await expect(vaultRows(win)).toHaveCount(0)
  await expect(win.locator('.sidebar__body .tree__row--file')).toHaveCount(2)
  await expect(topLabels(win)).toHaveText(['Ideas', 'Welcome note'])
  await expect(fileAt(win, ideasA)).toBeVisible()
  await expect(fileAt(win, welcomeB)).toBeVisible()
  // Two notes of two vaults: each top row says whose it is (S41).
  await expect(vaultTags(win)).toHaveText([ALPHA, BETA])
  await shoot(win, 'multi-vault-05-favorites-two-vaults')
})

// ---------------------------------------------------------------- search across vaults

test('step 5 — a search finds the note of the same name in both vaults, each match under its vault\'s row; Esc goes back to Files', async () => {
  await lensTab(win, 'Files').click()
  // The bar is on the Search tab only (YAZ-2638 D2): show the tab, then type.
  await showSearchTab(win)
  // The fill lives INSIDE the retry (search.spec.ts): each vault's index is read on the first query, and lands when it lands.
  await expect(async () => {
    await searchBar(win).fill('Roadmap')
    expect(await matchRows(win).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-path')))).toEqual([path.join(vaultA, 'Projects', 'Roadmap.md'), path.join(vaultB, 'Projects', 'Roadmap.md')])
  }).toPass({ timeout: 15_000 })
  // The tree that is cut is the forest (A9): a vault's row is a parent row, never a match.
  await expect(win.locator('.sidebar__body .tree__row--vault.tree__row--context .tree__label')).toHaveText([ALPHA, BETA])
  await shoot(win, 'multi-vault-06-search-two-vaults')
  // Esc goes back to the lens the window last showed, Files, and keeps the text in the Search tab
  // (YAZ-2638 S12; before, the query was emptied to bring the Files tree back).
  await searchBar(win).press('Escape')
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(win.locator('.sidebar__body .tree__row--context')).toHaveCount(0)
  await expect(vaultRowLabels(win)).toHaveText([ALPHA, BETA])
})

// ---------------------------------------------------------------- save the workspace

test('step 6 — "Save as workspace…" on the header saves the window\'s vaults under a name; the header shows it and `vaultSets` holds one entry', async () => {
  // With two or more vaults the header's right-click is this ONE item: the vault menu is one vault's (S15, S63).
  await trigger(win).click({ button: 'right' })
  await expect(menuItems(win)).toHaveText(['Save as workspace…'])
  await menuItem(win, 'Save as workspace…').click()

  // The header's name becomes a field that holds every vault name, joined with " + ".
  const field = win.locator('.sidebar__header .vault-switcher__rename')
  await expect(field).toBeVisible()
  await expect(field).toHaveValue(`${ALPHA} + ${BETA}`)
  await field.fill(WORKSPACE)
  await win.keyboard.press('Enter')

  await expect(toast(win)).toHaveText(`Saved workspace "${WORKSPACE}"`)
  await expect(field).toHaveCount(0)
  // The window's vaults are exactly a saved workspace: the header shows its name (S15).
  await expect(headerName(win)).toHaveText(WORKSPACE)
  await expect.poll(async () => (await readState(userData)).vaultSets.map((set) => [set.name, set.roots])).toEqual([[WORKSPACE, [vaultA, vaultB]]])
  await shoot(win, 'multi-vault-07-workspace-saved')
})

// ---------------------------------------------------------------- remove a vault

test('step 7 — "Remove from this window" on a vault row closes that vault\'s tab and drops its focus item; one vault is left, with no vault row, and nothing on disk changes', async () => {
  const betaRow = win.locator(`.sidebar__body .tree__row--vault[data-path="${vaultB}"]`)
  await betaRow.click({ button: 'right' })
  // A vault row is a folder that is a vault (S13, A2): it creates and pastes; it is not renamed, deleted, favorited or put in focus.
  await expect(menuItem(win, 'New note')).toBeVisible()
  await expect(menuItem(win, 'Copy path')).toBeVisible()
  for (const label of ['Add to focus', 'Add to favorites', 'Rename', 'Delete', 'Cut', 'Copy']) await expect(menuItem(win, label)).toHaveCount(0)
  await menuItem(win, 'Remove from this window').click()

  // The tab of the vault that left is closed (D7), and the window is a window on one vault again (S51).
  await expect(tabsOf(win)).toHaveCount(1)
  await expect(activeTab(win)).toHaveAttribute('title', path.join(vaultA, SEED_FILE))
  await expect(vaultRows(win)).toHaveCount(0)
  await expect(fileAt(win, path.join(vaultA, 'Ideas.md'))).toBeVisible()
  await expect(headerName(win)).toHaveText(ALPHA)
  await expect.poll(async () => (await readState(userData)).windows[0]?.roots).toEqual([vaultA])
  // Its focus item left with it (A5); the workspace is a COPY, so it still holds both vaults (S69).
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusList).toEqual([path.join(vaultA, 'Projects')])
  expect((await readState(userData)).vaultSets.map((set) => set.roots)).toEqual([[vaultA, vaultB]])
  // Nothing on disk changed (S50): the vault's own favorites are as they were.
  expect(await favoritesOf(vaultB)).toEqual([SEED_FILE])
  await shoot(win, 'multi-vault-08-vault-removed')
})

// ---------------------------------------------------------------- open the workspace

test('step 8 — the ⌘O list shows "Workspaces" first; the workspace opens a NEW window on both vaults, and this window stays', async () => {
  // ⌘O is the menu accelerator (menu.file.switch-vault): the panel drops with the filter focused.
  await clickMenuItem(app, 'menu.file.switch-vault', 'w1')
  await expect(panel(win)).toBeVisible()
  await expect(filter(win)).toBeFocused()
  // "Workspaces" stands first, a label and not a row (S64); its row says how many vaults it holds.
  await expect(groupLabels(win)).toHaveText(['Workspaces', 'Open', 'Not open'])
  await expect(rowNamed(win, WORKSPACE).locator('.vault-switcher__when')).toHaveText('2 vaults')
  // ⌘O ⏎ is still "the vault you used last" (YAZ-2555): an empty query never starts on a workspace.
  await expect(highlighted(win)).toHaveCount(1)
  await expect(highlighted(win)).toContainText(BETA)
  await shoot(win, 'multi-vault-09-workspaces-group')

  // A typed query starts on the top row, and the filter matches a workspace by its name.
  await filter(win).fill('Client')
  await expect(highlighted(win)).toContainText(WORKSPACE)
  await win.keyboard.press('Enter')

  // No window shows exactly that set (this one shows Alpha alone), so main opens ONE new window on it (S65).
  const winW = await extraWindow(app, ['w1'])
  expect(await windowCount(app)).toBe(2)
  await expect(vaultRowLabels(winW)).toHaveText([ALPHA, BETA])
  await expect(headerName(winW)).toHaveText(WORKSPACE)
  await expect.poll(() => winW.title()).toBe(titleOf(SEED_FILE, ALPHA)) // on the first vault's last file
  await expect(panel(win)).toHaveCount(0)
  await expect(vaultRows(win)).toHaveCount(0)
  await expect(headerName(win)).toHaveText(ALPHA)
  await shoot(winW, 'multi-vault-10-workspace-window')
})

// ---------------------------------------------------------------- the state file

test('step 9 — after a real quit, yaseendocs.json holds the new window with `roots` of two vaults, and one `vaultSets` entry', async () => {
  const winWId = winParam(await extraWindow(app, ['w1']))
  await quitApp(app) // the REAL quit: the pending state write flushes before exit, and a quit keeps each window's entry
  const state = await readState(userData)
  const entry = state.windows.find((w) => w.id === winWId)
  expect(entry?.roots).toEqual([vaultA, vaultB])
  expect(entry?.root).toBe(vaultA) // `roots[0] === root`
  expect(state.windows.find((w) => w.id === 'w1')?.roots).toEqual([vaultA])
  expect(state.vaultSets).toHaveLength(1)
  expect(state.vaultSets[0]).toMatchObject({ name: WORKSPACE, roots: [vaultA, vaultB] })
})
