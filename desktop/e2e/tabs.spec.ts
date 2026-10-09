/**
 * Tabs I3 (GRO-2235) and tab management (YAZ-2648): the tab strip against the REAL app — the
 * preview tab a sidebar click opens and reuses, the double click that keeps it, ⌘-click
 * background tabs, per-tab buffer preservation across switches, ⌃Tab cycling through the menu
 * accelerator ids, the tab board (the grid button and ⌘⇧M: islands, the filter, Enter), the
 * blank tab (⌘T and "+": a search result fills it as a kept tab), quit → relaunch tab restore
 * (every tab kept, no blank tab), and the ⌘W ladder down to the window close. Same harness as
 * smoke.spec.ts (temp `--user-data-dir`, COPY of a generated fixture vault, `i3-` step
 * screenshots); serial by design — each step continues the previous state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  activeTab,
  appWindow,
  buildFixtureVault,
  clickMenuItem,
  copyVault,
  editorOf,
  expandDirs,
  extraWindow,
  fileRow,
  launchApp,
  lensTab,
  previewTab,
  quitApp,
  readState,
  searchBar,
  SEED_BODY,
  SEED_FILE,
  seededState,
  shoot,
  tabsOf,
  windowCount,
  winParam,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const TYPED_MARKER = 'tab-buffer-5c1'
/** Bodies of the fixture's other files (helpers.buildFixtureVault). */
const IDEAS_BODY = 'synthetic-idea-body'
const ROADMAP_BODY = 'synthetic-roadmap-body'
const ARCHIVE_BODY = 'synthetic-archive-body'
/** A fifth note, this spec's own: the page that is the preview tab when the app quits. */
const SCRATCH_BODY = 'synthetic-scratch-body'
/** The strip after the blank tab was filled, in order; `Scratch` joins it as the preview tab before the quit. */
const KEPT = ['Welcome note', 'Roadmap', 'Ideas', 'Old plan']

const board = (w: Page) => w.locator('.taboverview')
const gridButton = (w: Page) => w.locator('.tabbar-nav [aria-label="Show all open tabs"]')
const pageTitles = (w: Page) => w.locator('.taboverview__page[data-path] .taboverview__title')

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page


test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'i3-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, 'Scratch.md'), `# Scratch\n\n${SCRATCH_BODY}\n`)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

test('step 1 — a sidebar click opens the PREVIEW tab and never replaces a kept tab; the next click reuses it; a double click keeps it; ⌘-click appends a kept background tab', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(SEED_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  await expect(previewTab(win)).toHaveCount(0) // a restored tab is a kept tab
  // A launch is collapsed since YAZ-1642: `Roadmap` is under `Projects`, so open it first.
  await expandDirs(win, [path.join(vault, 'Projects')])

  // A plain sidebar click opens a NEW tab at the end, italic: the preview tab (YAZ-2648 D1). The
  // seeded tab is a kept tab, and stays.
  await fileRow(win, 'Ideas').click()
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await expect(tabsOf(win)).toHaveText(['Welcome note', 'Ideas'])
  await expect(activeTab(win)).toHaveText('Ideas')
  await expect(previewTab(win)).toHaveText(['Ideas'])
  await shoot(win, 'i3-01a-preview-tab')

  // The next click shows its file in the SAME tab: the count does not move.
  await fileRow(win, 'Roadmap').click()
  await expect(editorOf(win)).toContainText(ROADMAP_BODY)
  await expect(tabsOf(win)).toHaveText(['Welcome note', 'Roadmap'])
  await expect(previewTab(win)).toHaveText(['Roadmap'])

  // A double click on the row keeps the tab its first click previewed (D2): the name is upright.
  await fileRow(win, 'Roadmap').dblclick()
  await expect(tabsOf(win)).toHaveText(['Welcome note', 'Roadmap'])
  await expect(previewTab(win)).toHaveCount(0)

  // ⌘-click another file: a KEPT background tab appends; activation (and the editor) stay put.
  await fileRow(win, 'Ideas').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Welcome note', 'Roadmap', 'Ideas'])
  await expect(activeTab(win)).toHaveText('Roadmap')
  await expect(previewTab(win)).toHaveCount(0)
  await expect(editorOf(win)).toContainText(ROADMAP_BODY)
  expect(await windowCount(app)).toBe(1) // never a new window (the LOCKED I3 ruling)
  await shoot(win, 'i3-01b-kept-and-background')
})

test('step 2 — switching tabs by click preserves each tab\'s content and typed buffer', async () => {
  // Type into Roadmap, switch to Ideas and back — the typed text survives the round-trip
  // (the layer stays mounted; no reload, no conflict bar). The first activation of the
  // background Ideas tab lazy-mounts its editor.
  await editorOf(win).getByText(ROADMAP_BODY).click()
  await win.keyboard.press('End')
  await win.keyboard.type(` ${TYPED_MARKER}`, { delay: 10 })
  await expect(editorOf(win)).toContainText(TYPED_MARKER)
  await tabsOf(win).filter({ hasText: 'Ideas' }).click()
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await tabsOf(win).filter({ hasText: 'Roadmap' }).click()
  await expect(editorOf(win)).toContainText(TYPED_MARKER)
  await expect(win.locator('.conflict-bar')).toHaveCount(0)
  await shoot(win, 'i3-02-buffer-survives-switch')
})

test('step 3 — ⌃Tab / ⌃⇧Tab cycle the strip with wraparound (the menu accelerator ids)', async () => {
  // Active: Roadmap, the middle of [Welcome note, Roadmap, Ideas]. Next twice wraps to the first tab; Previous wraps back to the last.
  await clickMenuItem(app, 'menu.window.next-tab', 'w1')
  await expect(activeTab(win)).toHaveText('Ideas')
  await clickMenuItem(app, 'menu.window.next-tab', 'w1')
  await expect(activeTab(win)).toHaveText('Welcome note')
  await clickMenuItem(app, 'menu.window.prev-tab', 'w1')
  await expect(activeTab(win)).toHaveText('Ideas')
  await clickMenuItem(app, 'menu.window.prev-tab', 'w1')
  await expect(activeTab(win)).toHaveText('Roadmap')
  await shoot(win, 'i3-03-cycle-wraparound')
})

test('step 3b — the tab board: the grid button and ⌘⇧M open it, each folder is an island, the filter narrows the pages, Enter goes to the page', async () => {
  // The grid button, right of ▶ (YAZ-2648 D8): the board stands in the editor's place, and the strip stays.
  await gridButton(win).click()
  await expect(board(win)).toBeVisible()
  await expect(gridButton(win)).toHaveAttribute('aria-pressed', 'true')
  await expect(tabsOf(win)).toHaveText(['Welcome note', 'Roadmap', 'Ideas'])
  // One island per folder that directly holds an open page (D9): the vault's top level, named by
  // the vault, then `Projects`; each label ends with its count. Three pages: nothing is a stack.
  await expect(win.locator('.taboverview__island-leaf')).toHaveText([path.basename(vault), 'Projects'])
  await expect(win.locator('.taboverview__island-count')).toHaveText(['2', '1'])
  await expect(pageTitles(win)).toHaveText(['Welcome note', 'Ideas', 'Roadmap'])
  await expect(win.locator('.taboverview__stack')).toHaveCount(0)
  await expect(win.locator('.taboverview__page[aria-current="page"] .taboverview__title')).toHaveText('Roadmap')
  await shoot(win, 'i3-03b-board')

  // The filter box has the keys: typing narrows the pages, and Enter opens the highlighted one.
  await expect(win.locator('.taboverview__filter')).toBeFocused()
  await win.keyboard.type('idea')
  await expect(pageTitles(win)).toHaveText(['Ideas'])
  await win.keyboard.press('Enter')
  await expect(board(win)).toHaveCount(0) // gone once the zoom is over
  await expect(activeTab(win)).toHaveText('Ideas')
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await expect(gridButton(win)).toHaveAttribute('aria-pressed', 'false')

  // ⌘⇧M — Window › Tab Overview, by its menu id — opens the board, and closes it again: the page that was open is back.
  await clickMenuItem(app, 'menu.window.tab-overview', 'w1')
  await expect(board(win)).toBeVisible()
  await expect(pageTitles(win)).toHaveText(['Welcome note', 'Ideas', 'Roadmap']) // the filter is the board's own, and went with it
  await clickMenuItem(app, 'menu.window.tab-overview', 'w1')
  await expect(board(win)).toHaveCount(0)
  await expect(activeTab(win)).toHaveText('Ideas')
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
})

test('step 3c — ⌘T shows the blank tab with the caret in the search bar; the result chosen fills it as a KEPT tab; "+" shows it again and ⌘W closes it alone', async () => {
  // ⌘T — File › New Tab, by its menu id (YAZ-2655 D10, D11): "New tab", last and active, over the empty page.
  await clickMenuItem(app, 'menu.file.new-tab', 'w1')
  await expect(tabsOf(win)).toHaveText(['Welcome note', 'Roadmap', 'Ideas', 'New tab'])
  await expect(activeTab(win)).toHaveText('New tab')
  await expect(win.locator('.editor-msg')).toHaveText('Select a file from the sidebar.')
  await expect(searchBar(win)).toBeFocused()
  await shoot(win, 'i3-03c-blank-tab')

  // A search, then Enter on the match: the page takes the blank tab's place, and it is a kept tab.
  await win.keyboard.type('Old plan')
  await expect(fileRow(win, 'Old plan')).toBeVisible()
  await searchBar(win).press('Enter')
  await expect(tabsOf(win)).toHaveText(KEPT)
  await expect(activeTab(win)).toHaveText('Old plan')
  await expect(previewTab(win)).toHaveCount(0)
  await expect(editorOf(win)).toContainText(ARCHIVE_BODY)

  // The "+" after the last tab is ⌘T's button. ⌘W on the blank tab closes it alone: the tab that was active is active again.
  await win.locator('.tabbar-row button[aria-label="New tab"]').click()
  await expect(activeTab(win)).toHaveText('New tab')
  await expect(searchBar(win)).toBeFocused()
  await clickMenuItem(app, 'menu.file.close-tab', 'w1')
  await expect(tabsOf(win)).toHaveText(KEPT)
  await expect(activeTab(win)).toHaveText('Old plan')
  await expect(editorOf(win)).toContainText(ARCHIVE_BODY)
})

test('step 4 — quit and relaunch restores the tabs and the active tab: every tab a kept tab, and no blank tab', async () => {
  // What the quit must NOT carry over: a preview tab (Scratch, by a plain click on its Files row) and the blank tab over it.
  await lensTab(win, 'Files').click() // step 3c left the sidebar on its Search tab
  await fileRow(win, 'Scratch').click()
  await expect(tabsOf(win)).toHaveText([...KEPT, 'Scratch'])
  await expect(previewTab(win)).toHaveText(['Scratch'])
  await expect(editorOf(win)).toContainText(SCRATCH_BODY)
  await clickMenuItem(app, 'menu.file.new-tab', 'w1')
  await expect(activeTab(win)).toHaveText('New tab')

  await quitApp(app) // the REAL quit path: flush handshake, windows[] kept
  const flushed = await readState(userData)
  expect(flushed.windows).toHaveLength(1)
  // The blank tab is in no stored field (D10): the tabs are the files, and the file is the last real active tab.
  expect(flushed.windows[0].tabs.map((t) => path.basename(t))).toEqual(['Welcome note.md', 'Roadmap.md', 'Ideas.md', 'Old plan.md', 'Scratch.md'])
  expect(path.basename(flushed.windows[0].file!)).toBe('Scratch.md')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText([...KEPT, 'Scratch'])
  await expect(activeTab(win)).toHaveText('Scratch')
  await expect(previewTab(win)).toHaveCount(0) // the preview mark is the session's (D4): after a restart each tab is a kept tab
  await tabsOf(win).filter({ hasText: 'Roadmap' }).click()
  await expect(editorOf(win)).toContainText(TYPED_MARKER) // step 2's autosaved edit
  await shoot(win, 'i3-04-restored')
})

test('step 4b — the tab context menu sits above the editor and accepts a real click', async () => {
  await activeTab(win).click({ button: 'right' })
  const menu = win.locator('.ctx-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Copy path', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await shoot(win, 'i3-04b-tab-menu-click')
})

test('step 5 — the ⌘W ladder: tabs → empty state with the window ALIVE → window close', async () => {
  // A second window (⌘⇧N duplicate — it carries the same tabs, each a kept tab) keeps the app alive
  // while the ladder closes the first one all the way down.
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  const dup = await extraWindow(app, ['w1'])
  const dupId = winParam(dup)!
  expect(await windowCount(app)).toBe(2)
  await expect(tabsOf(dup)).toHaveText([...KEPT, 'Scratch'])
  await expect(previewTab(dup)).toHaveCount(0)

  // ⌘W closes the active tab (Roadmap → its right neighbour Ideas takes over), then each tab that is left.
  await clickMenuItem(app, 'menu.file.close-tab', dupId)
  await expect(tabsOf(dup)).toHaveText(['Welcome note', 'Ideas', 'Old plan', 'Scratch'])
  await expect(activeTab(dup)).toHaveText('Ideas')
  for (let left = 3; left >= 0; left--) {
    await clickMenuItem(app, 'menu.file.close-tab', dupId)
    await expect(tabsOf(dup)).toHaveCount(left)
  }
  // Zero tabs: the empty state renders and the window is still ALIVE (rule 7).
  await expect(dup.locator('.editor-msg')).toHaveText('Select a file from the sidebar.')
  expect(await windowCount(app)).toBe(2)
  await shoot(dup, 'i3-05a-empty-state-window-alive')

  // ⌘W once more: the WINDOW closes through the real close path; the first window survives.
  await clickMenuItem(app, 'menu.file.close-tab', dupId)
  await expect.poll(() => windowCount(app)).toBe(1)
  await expect.poll(async () => (await readState(userData)).windows.map((w) => w.id)).toEqual(['w1'])
  await expect(tabsOf(win)).toHaveText([...KEPT, 'Scratch']) // untouched
  await shoot(win, 'i3-05b-window-closed')
  await quitApp(app)
})
