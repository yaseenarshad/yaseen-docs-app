/**
 * MOVE TO NEW WINDOW (YAZ-2933): a tab's right-click menu starts with "Move to new window". The
 * page saves first, main opens a window that holds that tab ALONE — sidebar hidden, right panel
 * closed — and only then does the tab leave the first window (D2, D4, D5). The saved state is the
 * proof that both windows are what they show: main writes them, and a relaunch reads them.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `newwin-`
 * step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, extraWindow, launchApp, readState, seededState, shoot, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const tabNames = (w: Page) => w.locator('.tabbar [role="tab"]')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz2933-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'yaz2933-vault-'))
  await Promise.all([
    writeFile(path.join(vault, 'Stays.md'), '# Stays\n\nnewwin-stays-body\n'),
    writeFile(path.join(vault, 'Leaves.md'), '# Leaves\n\nnewwin-leaves-body\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('right-click a tab › Move to new window: the tab leaves, and a new window shows it alone with the sidebar hidden', async () => {
  const state = seededState(vault, path.join(vault, 'Stays.md'))
  state.windows[0].tabs = [path.join(vault, 'Stays.md'), path.join(vault, 'Leaves.md')]
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(tabNames(win)).toHaveText(['Stays', 'Leaves'])

  await tabNames(win).nth(1).click({ button: 'right' })
  const items = win.locator('.ctx-menu__item')
  await expect(items.first()).toHaveText('Move to new window')
  await shoot(win, 'newwin-1-menu')
  await items.first().click()

  const popped = await extraWindow(app, ['w1'])
  await expect(activeTab(popped)).toHaveText('Leaves')
  await expect(tabNames(popped)).toHaveCount(1)
  await expect(popped.getByText('newwin-leaves-body')).toBeVisible()
  await expect(popped.getByRole('button', { name: 'Show sidebar' })).toBeVisible() // only a hidden sidebar offers it
  await shoot(popped, 'newwin-2-popped')

  await expect(tabNames(win)).toHaveText(['Stays'])
  expect(await windowCount(app)).toBe(2)

  // Main wrote both windows: the first one lost the tab, the new one is the D5 entry.
  await expect.poll(async () => (await readState(userData)).windows.find((w) => w.id === 'w1')?.tabs.length).toBe(1)
  const saved = await readState(userData)
  const first = saved.windows.find((w) => w.id === 'w1')
  const second = saved.windows.find((w) => w.id === winParam(popped))
  expect(first?.tabs).toEqual([path.join(vault, 'Stays.md')])
  expect(second).toMatchObject({ roots: [vault], file: path.join(vault, 'Leaves.md'), tabs: [path.join(vault, 'Leaves.md')], sidebarCollapsed: true, rightPanel: { open: false, items: [] } })
})
