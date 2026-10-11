/**
 * THE VAULT SWITCHER, END TO END (S14 of YAZ-2171 — YAZ-1767 / 1798 / 1974): the sidebar header's
 * name button drops the recent-vaults panel, and what a row does depends on the key that takes it.
 *
 * Only the real app can prove the half that matters: `⏎` goes through main's ONE open-recent door
 * (`window.openRecent`) — a vault with no window gets a NEW one on its remembered last file (D2),
 * a vault that already has one is RAISED and never copied (🔒 D9) — while `⇧⏎` is the one
 * deliberate in-place switch (YAZ-1974 D8): THIS window changes vault, title and state entry. The
 * unit tests fake the door; here the windows are counted, the titles read, `yaseendocs.json` opened.
 *
 * Display names (YAZ-1974 D3–D6) are the other durable claim: "Set display name" from the header's
 * right-click menu reaches the header, the OS window title and `folders[root].name` on disk,
 * survives quit → relaunch, and "Reset to folder name" undoes all three.
 *
 * A vault's number (YAZ-2555 D2, D3) is the last claim: the Window menu's row for vault 2 goes
 * through the same door from ANOTHER window — a minimized window is restored and comes to the
 * front, and nothing new opens (S23).
 *
 * ⌘O and ⌘2 are native accelerators Playwright cannot press, so steps 2 and 6 drive their menu
 * items by id (`menu.file.switch-vault`, `menu.window.vault.2`); every other open is the trigger's
 * own click. Two vaults are seeded in `recents` under FIXED folder names so the titles and the rows
 * read as sentences.
 * Same harness as the rest of the suite: temp `--user-data-dir`, copies of the generated fixture,
 * `vault-switcher-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppState } from '../../shared/types'
import { appWindow, buildFixtureVault, clickMenuItem, closeWindow, editorOf, extraWindow, launchApp, lensTab, multiWindowState, quitApp, readState, SEED_FILE, seededState, shoot, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The two vaults' FOLDER names — what the rows, the filter and the titles show until a display name is set. */
const ALPHA = 'Alpha Notes'
const BETA = 'Beta Notes'
/** The display name step 4 gives Beta (YAZ-1974 D5). */
const DISPLAY = 'Work Vault'
/** Bodies of the fixture's files (helpers.buildFixtureVault). */
const IDEAS_BODY = 'synthetic-idea-body'

/** The OS window title contract (client/src/lib/windowTitle.ts): `<vault NAME — file>`, the vault first (YAZ-2555 D6). */
const titleOf = (file: string, vaultName: string): string => `${vaultName} — ${path.basename(file).replace(/\.md$/, '')}`

let userData: string
let vaultSrc: string
/** The parent of both vaults — one temp dir, two fixed-name copies inside it. */
let vaultsDir: string
let vaultA: string
let vaultB: string
let app: ElectronApplication
let win: Page

// ---------- locators (client/src/sidebar/VaultSwitcher.tsx) ----------

/** The header's trigger: the vault's name + chevron (D6). */
const trigger = (w: Page) => w.locator('.sidebar__header .sidebar__root')
const headerName = (w: Page) => w.locator('.sidebar__header .sidebar__root-name')
/** The panel — a `ContextMenuSurface` restyled as a drop-down (D5). */
const panel = (w: Page) => w.locator('.ctx-menu--panel')
const filter = (w: Page) => w.locator('.vault-switcher__filter')
/** The vault rows, MRU or ranked order — never the "Open folder…" row below them. */
const rows = (w: Page) => w.locator('.vault-switcher__rows .vault-switcher__row')
const rowNames = (w: Page) => rows(w).locator('.vault-switcher__name')
const rowNamed = (w: Page, name: string) => rows(w).filter({ has: w.locator('.vault-switcher__name', { hasText: new RegExp(`^${name}$`) }) })
/** The group labels (YAZ-2555 D1): "Open" above the vaults that have a window, "Not open" above the others. */
const groupLabels = (w: Page) => w.locator('.vault-switcher__rows .vault-switcher__label')
/** The ONE highlighted row (D7) — a vault row or the Open folder… row. */
const highlighted = (w: Page) => w.locator('.vault-switcher__row--active')
const openFolderRow = (w: Page) => w.locator('.vault-switcher__open')
/** The vault MENU (YAZ-1798): the sidebar's own `ContextMenu`, overlay included — the panel has none. */
const vaultMenuItems = (w: Page) => w.locator('.ctx-overlay .ctx-menu [role="menuitem"]')
const vaultMenuItem = (w: Page, label: string) => vaultMenuItems(w).filter({ hasText: new RegExp(`^${label}$`) })
/** The inline display-name field, wherever it stands (YAZ-1974 D5). */
const nameField = (w: Page) => w.locator('.vault-switcher__rename')

/** Opens the panel by the trigger's click and waits for the filter to hold focus (D7) — every keystroke below goes to it. */
async function openPanel(w: Page): Promise<void> {
  await trigger(w).click()
  await expect(panel(w)).toBeVisible()
  await expect(filter(w)).toBeFocused()
}

/**
 * One window on Alpha with Beta a recents-only vault: `seededState` for the window, then Beta as
 * the OLDER recent and a folder bucket remembering its last file — what D2 opens a new window on.
 */
function twoVaultState(): AppState {
  const state = seededState(vaultA, path.join(vaultA, SEED_FILE))
  const now = Date.now()
  state.recents = [
    { path: vaultA, lastOpened: now },
    { path: vaultB, lastOpened: now - 60_000 },
  ]
  state.folders[vaultB] = { expanded: [], lastFile: path.join(vaultB, 'Ideas.md'), folds: {}, baseGroups: {}, opens: {}, name: null, key: null }
  return state
}

/** The window of state entry `winId` as main sees it: minimized or not, and whether it is the focused one — in front. */
const windowIs = (a: ElectronApplication, winId: string): Promise<{ minimized: boolean; focused: boolean } | null> =>
  a.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes(`win=${id}`))
    return w === undefined ? null : { minimized: w.isMinimized(), focused: w.isFocused() }
  }, winId)

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'vault-switcher-userdata-'))
  vaultSrc = await buildFixtureVault()
  // `copyVault` names its copies randomly; these two are copied by hand under FIXED names so the
  // panel's rows, the filter and the window titles read as the sentences the steps assert.
  vaultsDir = await mkdtemp(path.join(tmpdir(), 'vault-switcher-vaults-'))
  vaultA = path.join(vaultsDir, ALPHA)
  vaultB = path.join(vaultsDir, BETA)
  await Promise.all([cp(vaultSrc, vaultA, { recursive: true }), cp(vaultSrc, vaultB, { recursive: true })])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vaultsDir].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the panel

test('step 1 — the header button drops the panel: filter focused, both recents as rows, the current vault aria-current, Esc closes', async () => {
  app = await launchApp({ userData, seedState: twoVaultState() })
  win = await appWindow(app, 'w1')
  await expect(headerName(win)).toHaveText(ALPHA)
  await expect.poll(() => win.title()).toBe(titleOf(SEED_FILE, ALPHA))
  await expect(trigger(win)).toHaveAttribute('aria-expanded', 'false')

  await openPanel(win)
  await expect(trigger(win)).toHaveAttribute('aria-expanded', 'true')
  // MRU order (D7's empty query), the current vault INCLUDED and marked (D3); Open folder… LAST (D4).
  await expect(rowNames(win)).toHaveText([ALPHA, BETA])
  await expect(rowNamed(win, ALPHA)).toHaveAttribute('aria-current', 'true')
  await expect(rowNamed(win, BETA)).not.toHaveAttribute('aria-current', 'true')
  await expect(openFolderRow(win)).toHaveText('Open folder…')
  // The highlight starts on the first NON-current row, so ⌘O ⏎ jumps to the last-used OTHER vault (D7).
  await expect(highlighted(win)).toHaveCount(1)
  await expect(highlighted(win)).toContainText(BETA)
  await shoot(win, 'vault-switcher-01-panel')

  // Esc closes on the FIRST press (the menu convention).
  await win.keyboard.press('Escape')
  await expect(panel(win)).toHaveCount(0)
  await expect(trigger(win)).toHaveAttribute('aria-expanded', 'false')
})

// ---------------------------------------------------------------- ⏎: beside, then raise

test('step 2 — ⌘O then ⏎ opens the other vault BESIDE, on its remembered file; a second ⏎ RAISES that window instead of copying it', async () => {
  // ⌘O is the menu accelerator (menu.file.switch-vault): main sends `menu:switch-vault` to the
  // focused renderer, and each request TOGGLES the panel — open, with the filter focused (D8).
  await clickMenuItem(app, 'menu.file.switch-vault', 'w1')
  await expect(panel(win)).toBeVisible()
  await expect(filter(win)).toBeFocused()
  await expect(highlighted(win)).toContainText(BETA)

  // ⏎ on the highlighted row → `window.openRecent(vaultB)`: no window shows Beta, so a NEW one
  // opens on Beta's remembered last file (D2) — and THIS window stays exactly where it was.
  await win.keyboard.press('Enter')
  const winB = await extraWindow(app, ['w1'])
  const winBId = winParam(winB)!
  expect(await windowCount(app)).toBe(2)
  await expect.poll(() => winB.title()).toBe(titleOf('Ideas.md', BETA))
  await expect(editorOf(winB)).toContainText(IDEAS_BODY)
  await expect(panel(win)).toHaveCount(0) // `true` from the door closes the panel
  await expect.poll(() => win.title()).toBe(titleOf(SEED_FILE, ALPHA))
  await expect(headerName(win)).toHaveText(ALPHA)
  // The state file: a second entry rooted at Beta on its last file, and Beta bumped to the MRU's head.
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === winBId)?.root).toBe(vaultB)
  const entryB = (await readState(userData)).windows.find((w) => w.id === winBId)!
  expect(entryB.file).toBe(path.join(vaultB, 'Ideas.md'))
  await expect.poll(async () => (await readState(userData)).recents.map((r) => r.path)).toEqual([vaultB, vaultA])
  await shoot(winB, 'vault-switcher-03-opened-beside')

  // RAISE, not copy (🔒 D9): Beta now HAS a window, so ⏎ on its row brings that one forward and
  // opens nothing. The panel closing is the door's `true`; the count is read after it, when any
  // third window would already exist.
  await openPanel(win)
  // Both vaults have a window now, so both rows stand under "Open" and there is no "Not open" group
  // (YAZ-2555 D1). Their ORDER is not asserted: it is last-used order, and a real focus on Alpha's
  // window since Beta's opened is a use (D5) — whether one landed is the OS's call. The highlight
  // does not depend on it: the first row that is not THIS window's vault is Beta either way.
  await expect(groupLabels(win)).toHaveText(['Open'])
  await expect.poll(async () => (await rowNames(win).allTextContents()).sort()).toEqual([ALPHA, BETA])
  await expect(highlighted(win)).toContainText(BETA)
  await win.keyboard.press('Enter')
  await expect(panel(win)).toHaveCount(0)
  expect(await windowCount(app)).toBe(2)
  await expect.poll(async () => (await readState(userData)).windows.length).toBe(2)

  // Back to one window, so the in-place switch below is about THIS window alone.
  await closeWindow(app, winBId)
  await expect.poll(() => windowCount(app)).toBe(1)
})

// ---------------------------------------------------------------- ⇧⏎: in THIS window

test('step 3 — holding ⇧ says "Open here" on the highlighted row, and ⇧⏎ switches THIS window to the vault in place', async () => {
  await openPanel(win)
  await expect(highlighted(win)).toContainText(BETA)
  // While ⇧ is held the highlighted row's time slot reads what ⇧⏎ will do (YAZ-1974 D9).
  await win.keyboard.down('Shift')
  await expect(highlighted(win).locator('.vault-switcher__when--here')).toHaveText('Open here')
  await expect(rowNamed(win, ALPHA).locator('.vault-switcher__when--here')).toHaveCount(0) // never on the current vault
  await shoot(win, 'vault-switcher-04-open-here-cue')
  await win.keyboard.press('Enter')
  await win.keyboard.up('Shift')

  // The ONE deliberate in-place switch (D8/D11): same window, new vault — header, title, editor,
  // the Files lens (YAZ-1846), and the state entry's root — with NO second window.
  await expect(headerName(win)).toHaveText(BETA)
  await expect.poll(() => win.title()).toBe(titleOf('Ideas.md', BETA))
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(panel(win)).toHaveCount(0)
  expect(await windowCount(app)).toBe(1)
  await expect.poll(async () => (await readState(userData)).windows[0]?.root).toBe(vaultB)
  expect((await readState(userData)).windows[0]?.file).toBe(path.join(vaultB, 'Ideas.md'))
  await shoot(win, 'vault-switcher-05-opened-here')
})

// ---------------------------------------------------------------- display names

test('step 4 — "Set display name" from the header menu renames the header, the window title and `folders[root].name`', async () => {
  // The header IS the current vault (YAZ-1798): its menu has the middle three groups only — no
  // "Open in this window", no "Remove", and no "Reset" while no display name is set (YAZ-1974 D5).
  await trigger(win).click({ button: 'right' })
  await expect(vaultMenuItems(win)).toHaveText(['Set display name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
  await vaultMenuItem(win, 'Set display name').click()

  // The name becomes a field WHERE it stood — the header — the folder name as its placeholder (D5).
  const field = win.locator('.sidebar__header').locator(nameField(win))
  await expect(field).toBeVisible()
  await expect(field).toHaveValue(BETA)
  await expect(field).toHaveAttribute('placeholder', BETA)
  await field.fill(DISPLAY)
  await win.keyboard.press('Enter')

  await expect(field).toHaveCount(0)
  await expect(headerName(win)).toHaveText(DISPLAY)
  await expect.poll(() => win.title()).toBe(titleOf('Ideas.md', DISPLAY)) // the title takes the NAME (YAZ-1974 D4)
  await expect.poll(async () => (await readState(userData)).folders[vaultB]?.name).toBe(DISPLAY)
  expect((await readState(userData)).folders[vaultA]?.name).toBeNull() // the other vault's bucket untouched
  await shoot(win, 'vault-switcher-06-display-name')
})

test('step 5 — the display name survives quit → relaunch; "Reset to folder name" puts the folder name back everywhere', async () => {
  await quitApp(app) // the REAL quit: the pending state write flushes before exit
  expect((await readState(userData)).folders[vaultB]?.name).toBe(DISPLAY)

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(headerName(win)).toHaveText(DISPLAY)
  await expect.poll(() => win.title()).toBe(titleOf('Ideas.md', DISPLAY))
  await shoot(win, 'vault-switcher-07-name-restored')

  // With a display name set the menu gains "Reset to folder name" — never "Rename" (D5).
  await trigger(win).click({ button: 'right' })
  await expect(vaultMenuItems(win)).toHaveText(['Set display name', 'Reset to folder name', 'Set shortcut', 'Copy vault name', 'Copy path', 'Reveal in Finder', 'Open in VS Code'])
  await vaultMenuItem(win, 'Reset to folder name').click()
  await expect(headerName(win)).toHaveText(BETA)
  await expect.poll(() => win.title()).toBe(titleOf('Ideas.md', BETA))
  await expect.poll(async () => (await readState(userData)).folders[vaultB]?.name).toBeNull()
  await shoot(win, 'vault-switcher-08-name-reset')
  await quitApp(app)
})

// ---------------------------------------------------------------- ⌘<n>: the Window menu's vault row

test('step 6 — ⌘2 from another window restores vault 2\'s minimized window and brings it to the front; nothing new opens', async () => {
  // Both vaults open, one window each, and Beta has number 2 (`folders[root].key`, YAZ-2555 D2).
  const state = multiWindowState(
    [
      { id: 'w1', root: vaultA, file: path.join(vaultA, SEED_FILE) },
      { id: 'w2', root: vaultB, file: path.join(vaultB, 'Ideas.md') },
    ],
    [vaultA, vaultB],
  )
  state.folders[vaultB].key = 2
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  const winB = await appWindow(app, 'w2')
  await expect.poll(() => win.title()).toBe(titleOf(SEED_FILE, ALPHA))
  await expect.poll(() => winB.title()).toBe(titleOf('Ideas.md', BETA))
  expect(await windowCount(app)).toBe(2)

  // Beta's window goes to the Dock — the case ⌘` cannot reach (the reason for the key).
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('win=w2'))
      ?.minimize()
  })
  await expect.poll(async () => (await windowIs(app, 'w2'))?.minimized).toBe(true)

  // ⌘2 is the Window menu's row for vault 2 (D3), pressed from Alpha's window: main's one door
  // restores Beta's window and raises it (S23) — it never asks the focused renderer (A5).
  await clickMenuItem(app, 'menu.window.vault.2', 'w1')
  await expect.poll(() => windowIs(app, 'w2')).toEqual({ minimized: false, focused: true })
  // RAISE, not copy (🔒 D9): read after the raise, when any third window would already exist.
  expect(await windowCount(app)).toBe(2)
  await expect.poll(async () => (await readState(userData)).windows.map((w) => w.id)).toEqual(['w1', 'w2'])
  await shoot(winB, 'vault-switcher-09-vault-key')
  await quitApp(app)
})
