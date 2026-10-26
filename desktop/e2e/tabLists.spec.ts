/**
 * FOCUS AND FAVORITES FROM A TAB'S MENU, END TO END (YAZ-3264): right-click a tab → "Add to focus"
 * and "Add to favorites" (D2), with the sidebar HIDDEN. Only the real app can prove the reason for
 * D1: the hidden sidebar is unmounted, so the lists must live in App for the items to work (S3).
 * The toast confirms; the vault's own files hold the page; the menu reads the new state when it
 * opens again (S2); and the sidebar, shown again, keeps its tab (D3) and draws the rows on the
 * Focus tab and on the Favorites tab.
 *
 * The unit tests (client/src/lists/useVaultListsHere.test.tsx, client/src/tabs/TabMenu.test.tsx)
 * pin the places, the labels, the limit and the roll back.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a COPY of the generated fixture,
 * `tablists-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItemQuietly, copyVault, focusOnDisk, launchApp, lensTab, menuItem, SEED_FILE, seededState, shoot, tabsOf, topLabels, wholeRow } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const sidebar = (w: Page) => w.locator('.sidebar__lenses')
const focusTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Focus"]')
const heartTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Favorites"]')
/** App's one passive toast (`.link-notice`, YAZ-1341) — its text. */
const toast = (w: Page) => w.locator('.link-notice__text')

/** The vault's Favorites file, vault-RELATIVE paths; null while the file is absent. */
async function favoritesOnDisk(): Promise<string[] | null> {
  const raw = await readFile(path.join(vault, '.yaseendocs', 'favorites.json'), 'utf8').catch(() => null)
  return raw === null ? null : (JSON.parse(raw) as { favorites: string[] }).favorites
}

/** Right-click the one tab and take the menu's `label`. */
async function pickFromTabMenu(label: string): Promise<void> {
  await tabsOf(win).first().click({ button: 'right' })
  await expect(menuItem(win, label)).toBeVisible()
  await menuItem(win, label).click()
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'tablists-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — with the sidebar hidden, a tab\'s "Add to focus" and "Add to favorites" toast and write the vault\'s files; the menu then reads "Remove from …" (S2, S3)', async () => {
  app = await launchApp({ userData, seedState: wholeRow(seededState(vault, path.join(vault, SEED_FILE))) })
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveCount(1)
  await expect(sidebar(win)).toBeVisible()
  await clickMenuItemQuietly(app, 'menu.view.toggle-sidebar')
  await expect(sidebar(win)).toHaveCount(0)

  await pickFromTabMenu('Add to focus')
  await expect(toast(win)).toHaveText('Added to focus')
  await expect.poll(() => focusOnDisk(vault)).toEqual([SEED_FILE])
  await shoot(win, 'tablists-01-focus-added-hidden')

  await pickFromTabMenu('Add to favorites')
  await expect(toast(win)).toHaveText('Added to favorites')
  await expect.poll(favoritesOnDisk).toEqual([SEED_FILE])

  // The menu reads the state when it opens (S2): both items now remove.
  await tabsOf(win).first().click({ button: 'right' })
  await expect(menuItem(win, 'Remove from focus')).toBeVisible()
  await expect(menuItem(win, 'Remove from favorites')).toBeVisible()
  await shoot(win, 'tablists-02-menu-reads-remove')
  await win.keyboard.press('Escape')
  await expect(menuItem(win, 'Remove from focus')).toHaveCount(0)
})

test('step 2 — the sidebar, shown again, keeps its tab (D3) and draws the page on the Focus tab and on the Favorites tab', async () => {
  await clickMenuItemQuietly(app, 'menu.view.toggle-sidebar')
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await focusTab(win).click()
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Welcome note'])
  await shoot(win, 'tablists-03-focus-row')
  await heartTab(win).click()
  await expect(heartTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Welcome note'])
  await shoot(win, 'tablists-04-favorites-row')
})
