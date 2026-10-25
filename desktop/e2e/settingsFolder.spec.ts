/**
 * THE SETTINGS FOLDER, end to end (YAZ-3276): Settings › General › Settings folder against the REAL app.
 * "Choose…" points the settings at an empty folder and this Mac's file appears (D6); another Mac's newer
 * file changes the open window's theme (D3, D4); a folder that went away keeps the settings and shows
 * the red line (D5); "Reset to default" keeps the settings (D6). The folder dialog is the one stub:
 * `dialog.showOpenDialog` answers the temp folder, as boardTools.spec.ts does for its save dialog.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, readState, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const LIGHT_BG = 'rgb(255, 255, 255)'
const DARK_BG = 'rgb(30, 30, 30)'
const bgOf = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')
const navItem = (w: Page, title: string) => dialog(w).locator('.settings-nav__item', { hasText: new RegExp(`^${title}$`) })
const folderRow = (w: Page) => dialog(w).locator('[data-setting="settingsFolder"]')
const openSettings = async (w: Page) => {
  await w.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog(w)).toBeVisible()
}
/** The × button: after the folder dialog, focus is outside the sheet, where Escape does not reach it. */
const closeSettings = async (w: Page) => {
  await dialog(w).getByRole('button', { name: 'Close settings', exact: true }).click()
  await expect(dialog(w)).toHaveCount(0)
}
/** The "other Mac"'s file, which this test writes. */
const OTHER = 'settings-othermacmac1.json'
/** This Mac's file: the one `settings-<Mac ID>.json` this test did not write. */
const ownFiles = async (dir: string) => (await readdir(dir)).filter((name) => /^settings-[0-9a-z]{12}\.json$/.test(name) && name !== OTHER)

let userData: string
let vaultSrc: string
let vault: string
let root: string
let folder: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'settings-folder-userdata-'))
  root = await mkdtemp(path.join(tmpdir(), 'settings-folder-sync-'))
  folder = path.join(root, 'yaseen-docs-settings')
  await mkdir(folder)
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, root, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — Settings opens on General; "Choose…" points at an empty folder, and this Mac writes its file there (D6, D7)', async () => {
  const seed = seededState(vault, path.join(vault, SEED_FILE))
  app = await launchApp({ userData, seedState: { ...seed, settings: { ...seed.settings, theme: 'light' } } })
  win = await appWindow(app, 'w1')
  await expect.poll(() => bgOf(win)).toBe(LIGHT_BG)
  await app.evaluate(({ dialog: electronDialog }, picked) => {
    electronDialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof electronDialog.showOpenDialog
  }, folder)

  await openSettings(win)
  await expect(navItem(win, 'General')).toHaveAttribute('aria-current', 'page')
  await expect(folderRow(win).getByTestId('settings-folder-path')).toHaveText('On this Mac only (default)')
  await expect(folderRow(win).getByRole('button', { name: 'Reset to default', exact: true })).toBeDisabled()
  await shoot(win, 'settings-folder-01-default')

  await folderRow(win).getByRole('button', { name: 'Choose settings folder', exact: true }).click()
  await expect(folderRow(win).getByTestId('settings-folder-path')).toHaveText(folder)
  await expect(folderRow(win).getByRole('button', { name: 'Reset to default', exact: true })).toBeEnabled()
  await expect.poll(async () => (await readState(userData)).settingsFolder).toBe(folder)
  await expect.poll(() => ownFiles(folder)).toHaveLength(1)
  const own = JSON.parse(await readFile(path.join(folder, (await ownFiles(folder))[0]), 'utf8')) as { settings: Record<string, unknown> }
  expect(own.settings.theme).toBe('light')
  expect(own.settings).not.toHaveProperty('libraryFolder') // D1: a local field stays on this Mac
  await shoot(win, 'settings-folder-02-chosen')
  await closeSettings(win)
})

test('step 2 — another Mac\'s newer file changes the open window\'s theme, with no restart (D3, D4)', async () => {
  const own = JSON.parse(await readFile(path.join(folder, (await ownFiles(folder))[0]), 'utf8')) as { settings: Record<string, unknown> }
  await writeFile(path.join(folder, OTHER), JSON.stringify({ name: 'Other Mac', savedAt: Date.now() + 60_000, settings: { ...own.settings, theme: 'dark' } }, null, 2))
  await expect.poll(() => bgOf(win), { timeout: 10_000 }).toBe(DARK_BG)
  await expect.poll(async () => (await readState(userData)).settings.theme).toBe('dark')
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await shoot(win, 'settings-folder-03-other-mac-dark')
})

test('step 3 — a folder that went away: the settings stay and the row says so; "Reset to default" keeps them (D5, D6)', async () => {
  const away = path.join(root, 'moved-away')
  await rename(folder, away)
  // A change on this Mac tries to write its file, and the folder is not there.
  await openSettings(win)
  await navItem(win, 'Appearance').click()
  await dialog(win).locator('[data-setting="contentWidth"]').getByRole('button', { name: 'Full', exact: true }).click()
  await closeSettings(win)
  // The row asks main when it shows (D7): reopen until the failed write (150 ms after the change) is what it hears.
  await expect
    .poll(async () => {
      await openSettings(win)
      const shown = await folderRow(win).getByRole('alert').count()
      if (shown === 0) await closeSettings(win)
      return shown
    }, { timeout: 10_000 })
    .toBe(1)
  await expect(folderRow(win).getByRole('alert')).toHaveText("Can't find this folder. This Mac uses its last settings. It reads the folder again when it comes back.", { timeout: 10_000 })
  expect(await bgOf(win)).toBe(DARK_BG) // the last settings, not the defaults
  await shoot(win, 'settings-folder-04-missing')

  // YAZ-3296: the folder comes back with the same files, while the app runs. Within the retry (5 s) the app
  // reads it again, the line goes, and this Mac's file gets the change it made while the folder was gone.
  await closeSettings(win)
  await rename(away, folder)
  await expect
    .poll(async () => (JSON.parse(await readFile(path.join(folder, (await ownFiles(folder))[0]), 'utf8')) as { settings: Record<string, unknown> }).settings.contentWidth, { timeout: 15_000 })
    .toBe('full')
  await openSettings(win)
  await expect(folderRow(win).getByRole('alert')).toHaveCount(0)
  await folderRow(win).getByRole('button', { name: 'Reset to default', exact: true }).click()
  await expect(folderRow(win).getByTestId('settings-folder-path')).toHaveText('On this Mac only (default)')
  await expect(folderRow(win).getByRole('alert')).toHaveCount(0)
  await expect.poll(async () => (await readState(userData)).settingsFolder).toBeNull()
  expect(await bgOf(win)).toBe(DARK_BG)
  expect(await ownFiles(folder)).toHaveLength(1) // Reset never deletes this Mac's file
  await closeSettings(win)
  await quitApp(app)
})
