/**
 * Every key on one page (YAZ-3564) against the REAL app, on a temp vault:
 *   1 Settings › Hotkeys › Note: Bold moves from ⌘B to ⌥⌘B with the recorder and Save (K7, K8)
 *   2 a note opened after it bolds with ⌥⌘B, and ⌘B bolds nothing (K4: a note reads its keys when it opens)
 * The menu item is clicked by id with no focus step (`clickMenuItemQuietly`): a hidden run never takes the focus.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, clickMenuItemQuietly, editorOf, fileRow, launchApp, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'hotkeys-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'hotkeys-vault-'))
  await writeFile(path.join(vault, 'Plain.md'), 'plain words\n')
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Plain')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

const dialog = () => win.locator('.settings-dialog')

test('Settings › Hotkeys › Note: Bold moves to ⌥⌘B', async () => {
  await clickMenuItemQuietly(app, 'menu.app.settings')
  await dialog().locator('.settings-nav__item', { hasText: /^Hotkeys$/ }).click()
  await dialog().locator('.hotkeys__chip', { hasText: /^Note$/ }).click()
  const bold = dialog().locator('[data-setting="hotkey-note-bold"]')
  await expect(bold.locator('.hotkeys__key')).toHaveText('⌘B')
  await bold.locator('.hotkeys__key').click()
  await win.keyboard.press('Meta+Alt+KeyB')
  await dialog().locator('.confirm').getByRole('button', { name: 'Save' }).click()
  await expect(bold.locator('.hotkeys__key')).toHaveText('⌥⌘B')
  await win.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
})

test('a note opened after the change bolds with ⌥⌘B, and ⌘B bolds nothing', async () => {
  await fileRow(win, 'Plain').click()
  const editor = editorOf(win)
  await editor.getByText('plain words').click()
  await win.keyboard.press('Meta+A')
  await win.keyboard.press('Meta+KeyB')
  await expect(editor.locator('strong')).toHaveCount(0)
  await win.keyboard.press('Meta+Alt+KeyB')
  await expect(editor.locator('strong')).toHaveText('plain words')
})
