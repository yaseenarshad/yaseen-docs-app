/**
 * The lens tabs (6A-, YAZ-847) end-to-end against the REAL app: chrome v2 ROW 1 — Files, Search,
 * Focus, Favorites since YAZ-2638 D2. Files is the DEFAULT lens (YAZ-1846) and is the file
 * explorer; the Favorites tab is `favorites.spec.ts`'s and the Focus tab `focus.spec.ts`'s, switch
 * and relaunch included; what the Search tab finds is `search.spec.ts`'s. Here: Search is a tab and
 * no lens — the bar is on it alone, Esc leaves it, and it is never stored.
 *
 * The seed here is deliberately NOT `seededState`'s: that helper pre-selects Files for the rest
 * of the suite (every other spec is about the tree), so this one seeds a PRE-847 state file —
 * every key of a valid state except `sidebarLens` — which is also the honest upgrade case: an
 * existing user's `yaseendocs.json` gains the lens and lands on the default, Files (YAZ-1846).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppState, WindowEntry } from '../../shared/types'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, editorOf, fileRow, launchApp, lensTab, quitApp, readState, searchBar, searchTab, SEED_BODY, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators ----------

const bodyMsg = (w: Page) => w.locator('.sidebar__body .sidebar__msg')
/** Row 1 of the sidebar, in the order drawn. */
const sidebarTabs = (w: Page) => w.locator('.sidebar__lenses [role="tab"]')
/** The Focus tab: a glyph (the eye), so its name lives in `aria-label` (YAZ-2619 D4). */
const focusTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Focus"]')
/** The `esc` keycap of the search bar (YAZ-2638 S13). */
const keycap = (w: Page) => w.locator('.sidebar__search-back')
/** The Focus tab's text while its list is empty (YAZ-2619 S15). */
const FOCUS_EMPTY = 'Nothing in focus. Right-click a file or folder → Add to focus.'
/** The Search tab's text while its bar is empty (YAZ-2638 S7). */
const SEARCH_EMPTY = 'Type to search every note and folder.'

/** The lens a tab row reports through `aria-selected` — exactly one at a time. */
async function expectLens(w: Page, lens: 'Files'): Promise<void> {
  await expect(lensTab(w, lens)).toHaveAttribute('aria-selected', 'true')
  await expect(w.locator('.sidebar__lenses [aria-selected="true"]')).toHaveCount(1)
}

/**
 * A PRE-847 `yaseendocs.json`: `seededState`'s window/folder seed with the window's lens key
 * removed (and no retired global one either), so the store's sanitize pass is what supplies the
 * default. `JSON.stringify` drops `undefined`, so the key never reaches disk.
 */
function preLensState(vaultPath: string, file: string): AppState {
  const state = seededState(vaultPath, file)
  delete (state.windows[0] as Partial<WindowEntry>).sidebarLens
  return state
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'lenses-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the default

test('a state file with no lens boots on FILES (YAZ-1846 D1): the file tree', async () => {
  app = await launchApp({ userData, seedState: preLensState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(lensTab(win, 'Files')).toBeVisible()
  await expectLens(win, 'Files')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(bodyMsg(win)).toHaveCount(0)
  // Four tabs, Search right after Files (YAZ-2638 S1), and Files has NO search bar (S6) — the
  // "always visible, on every lens" rule of YAZ-739 / YAZ-797 is overturned.
  await expect.poll(() => sidebarTabs(win).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label') ?? tab.textContent))).toEqual(['Files', 'Search', 'Focus', 'Favorites'])
  await expect(searchBar(win)).toHaveCount(0)
  await shoot(win, 'lens-01-files-default')
})

// ---------------------------------------------------------------- the Search tab (YAZ-2638 D2)

test('the Search tab has the bar, one line of help and the keys of the search; a click on the tab and Esc in the page put the caret in the bar; Esc in the bar and the `esc` keycap go back to the lens the window last showed and put the caret in the open page; no lens has the bar', async () => {
  // A click on the tab shows it, with the caret in its bar (S5) and no tree below (S7).
  await searchTab(win).click()
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(win.locator('.sidebar__lenses [aria-selected="true"]')).toHaveCount(1)
  await expect(searchBar(win)).toBeFocused()
  await expect(keycap(win)).toBeVisible()
  await expect(bodyMsg(win)).toHaveText(SEARCH_EMPTY)
  // Below the line, the keys of the search: seven rows (YAZ-2662 S59). `search.spec.ts` reads their words.
  await expect(win.locator('.sidebar__body .sidebar__keys dd')).toHaveCount(7)
  await expect(fileRow(win, 'Ideas')).toHaveCount(0)
  await shoot(win, 'lens-02-search-tab')

  // Esc in the page, while the Search tab shows, puts the caret in the search bar — with an EMPTY bar too.
  await editorOf(win).getByText(SEED_BODY).click()
  await expect(searchBar(win)).not.toBeFocused()
  await win.keyboard.press('Escape')
  await expect(searchBar(win)).toBeFocused()
  // A click on the Search tab while it already shows puts the caret in the bar too: the click and ⌘K share one path.
  await editorOf(win).getByText(SEED_BODY).click()
  await expect(searchBar(win)).not.toBeFocused()
  await searchTab(win).click()
  await expect(searchBar(win)).toBeFocused()

  // A plain show of the sidebar on the Search tab — hidden, then shown, with no ⌘K — does NOT take the caret.
  await editorOf(win).getByText(SEED_BODY).click()
  await clickMenuItem(app, 'menu.view.toggle-sidebar', 'w1')
  await expect(searchTab(win)).toHaveCount(0)
  await clickMenuItem(app, 'menu.view.toggle-sidebar', 'w1')
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(bodyMsg(win)).toHaveText(SEARCH_EMPTY)
  await expect(searchBar(win)).toBeVisible()
  await expect(searchBar(win)).not.toBeFocused()

  // Esc goes back to the lens the window last showed: Files (S12). The caret goes into the open
  // page (YAZ-2662 S56; before, the focus was given up).
  await searchBar(win).press('Escape')
  await expectLens(win, 'Files')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(editorOf(win)).toBeFocused()

  // From the Focus tab the way back is the Focus tab — by the keycap this time (S13). Focus has no bar either (S6).
  await focusTab(win).click()
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(bodyMsg(win)).toHaveText(FOCUS_EMPTY)
  await searchTab(win).click()
  await expect(bodyMsg(win)).toHaveText(SEARCH_EMPTY)
  await keycap(win).click()
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(bodyMsg(win)).toHaveText(FOCUS_EMPTY)
  // A click on the keycap is the Esc key (YAZ-2662 S58): the caret is in the open page after it too.
  await expect(editorOf(win)).toBeFocused()
})

test('the Search tab is never stored (YAZ-2638 S15): a window that quits on it starts again on its last lens', async () => {
  // The last LENS is Focus; the tab that shows at the quit is Search.
  await searchTab(win).click()
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect((await readState(userData)).windows[0]?.sidebarLens).toBe('focus')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'false')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(bodyMsg(win)).toHaveText(FOCUS_EMPTY)
  await shoot(win, 'lens-03-restarts-on-last-lens')
  await quitApp(app)
})
