/**
 * ⌘N and ⌘D (YAZ-3556) against the REAL app, on a temp vault with "Default location for new notes" set to the folder
 * Inbox and "Go to your place" set to that folder (Settings › Files & Links, Settings › Sidebar › Go to):
 *   1 File › Go to Your Place shows Inbox in Files: the folder opens and its row has the keyboard (D9)
 *   2 File › New…, ⏎, a name, ⏎: the note is made in Inbox and opens in the active tab (D3, D4, D5)
 * The menu items are clicked by id with no focus step (`clickMenuItemQuietly`): a hidden run never takes the focus.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, clickMenuItemQuietly, dirRow, fileRow, launchApp, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'newitem-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'newitem-vault-'))
  await mkdir(path.join(vault, 'Inbox'))
  await writeFile(path.join(vault, 'Inbox', 'Waiting.md'), 'waiting\n')
  await writeFile(path.join(vault, 'Top.md'), 'top\n')
  const state = seededState(vault, null)
  state.settings = { ...state.settings, newNoteLocation: 'folder', newNoteFolder: 'Inbox', goTo: { kind: 'folder', path: 'Inbox' } }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Top')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('⌘D shows the set folder in Files: open, with the keyboard on its row', async () => {
  await expect(fileRow(win, 'Waiting')).toHaveCount(0) // the tree starts closed (YAZ-1642)
  await clickMenuItemQuietly(app, 'menu.file.go-to')
  await expect(dirRow(win, 'Inbox')).toBeFocused()
  await expect(fileRow(win, 'Waiting')).toBeVisible()
})

test('⌘N, ⏎, a name, ⏎: the note is made in the default folder and opens', async () => {
  await clickMenuItemQuietly(app, 'menu.file.new-item')
  const box = win.locator('.new-item')
  await expect(box).toBeVisible()
  await expect(box.locator('.new-item__tile[aria-checked="true"]')).toHaveText('Note')
  await expect(box.locator('.new-item__place')).toHaveText('Inbox')
  await win.keyboard.press('Enter')
  await expect(box).toHaveCount(0)
  const field = win.locator('.create-inline__input')
  await expect(field).toBeFocused()
  await field.fill('Groceries')
  await win.keyboard.press('Enter')
  await expect(activeTab(win)).toHaveText(/Groceries/)
  await expect(fileRow(win, 'Groceries')).toBeVisible()
  expect((await readdir(path.join(vault, 'Inbox'))).sort()).toEqual(['Groceries.md', 'Waiting.md'])
})
