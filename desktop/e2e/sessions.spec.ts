/**
 * SESSIONS (YAZ-3147): a session is a saved copy of a window's tabs, on the 5th sidebar tab (D4).
 * The grid button's "Save and close all tabs" saves the tabs and clears the window (D5, S3); the new
 * row opens its name field (S1). "Restore session" puts the tabs back, the active one active (D3,
 * S16). A restore adds a vault the window does not show, and skips a gone file with one notice (S20,
 * S21). The sessions and the Sessions tab stay after a restart (S35).
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, temp vaults, `sessions-` step
 * screenshots, serial, out of sight (`YASEEN_DOCS_E2E_HIDDEN`).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, launchApp, menuItem, quitApp, readState, seededState, shoot, tabsOf } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaults: string[] = []
let app: ElectronApplication
let win: Page

const note = async (vault: string, name: string): Promise<string> => {
  const file = path.join(vault, `${name}.md`)
  await writeFile(file, `${name.toLowerCase()} body\n`)
  return file
}
const sessionsTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Sessions"]')
const sessionRow = (w: Page, name: string) => w.locator('.sidebar__body [aria-label="Sessions"] > li > .tree__row').filter({ hasText: name })
const toast = (w: Page) => w.locator('.link-notice__text')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3147-userdata-'))
  vaults = await Promise.all(['alpha', 'bravo', 'charlie'].map(async (n) => {
    const dir = await mkdtemp(path.join(tmpdir(), `yaz3147-${n}-`))
    await mkdir(path.join(dir, '.yaseendocs'), { recursive: true })
    return dir
  }))
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, ...vaults].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('save and close all tabs, name the session, restore it; a restore adds a vault and skips a gone file; all of it stays after a restart', async () => {
  const [a, b, c] = vaults
  const alpha = await note(a, 'Alpha')
  const beta = await note(a, 'Beta')
  const bravo = await note(b, 'Bravo')
  const charlie = await note(c, 'Charlie')
  const state = seededState(a, beta)
  state.windows[0] = { ...state.windows[0], roots: [a, b], tabs: [alpha, beta, bravo] }
  state.recents = [a, b, c].map((p) => ({ path: p, lastOpened: Date.now() }))
  // A session saved earlier: its vault is not in the window (S21), and one of its files is gone (S20).
  state.sessions = [{ id: 's-outside', name: 'Outside', tabs: [{ path: charlie, active: true }, { path: path.join(a, 'Gone.md') }], roots: [c, a], lastUsed: 1 }]
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText(['Alpha', 'Beta', 'Bravo'])
  await expect(activeTab(win)).toHaveText('Beta')

  // D5, S3: the grid button's menu saves the tabs, then closes them all, with no sheet.
  await win.locator('.tabbar-nav [aria-label="Show all open tabs"]').click({ button: 'right' })
  await shoot(win, 'sessions-1-grid-menu')
  await win.locator('.ctx-menu').getByRole('menuitem', { name: 'Save and close all tabs', exact: true }).click()
  await expect(tabsOf(win)).toHaveCount(0)

  // S1: the Sessions tab shows, and the new row's name field is open with "New session" selected.
  await expect(sessionsTab(win)).toHaveAttribute('aria-selected', 'true')
  const field = win.locator('[aria-label="Session name"]')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('New session')
  await win.keyboard.type('Project A')
  await win.keyboard.press('Enter')
  await expect(sessionRow(win, 'Project A')).toContainText('3 tabs')
  await shoot(win, 'sessions-2-saved')

  // D3, S16: the tabs come back in the saved order, and the tab that was active is active.
  await sessionRow(win, 'Project A').click({ button: 'right' })
  await menuItem(win, 'Restore session').click()
  await expect(tabsOf(win)).toHaveText(['Alpha', 'Beta', 'Bravo'])
  await expect(activeTab(win)).toHaveText('Beta')

  // S25: a second restore opens nothing new.
  await sessionRow(win, 'Project A').click({ button: 'right' })
  await menuItem(win, 'Restore session').click()
  await expect(tabsOf(win)).toHaveText(['Alpha', 'Beta', 'Bravo'])

  // S17, S20, S21: the outside vault joins, its tab opens at the end, and the gone file gives one notice.
  await sessionRow(win, 'Outside').click({ button: 'right' })
  await menuItem(win, 'Restore session').click()
  await expect(tabsOf(win)).toHaveText(['Alpha', 'Beta', 'Bravo', 'Charlie'])
  await expect(activeTab(win)).toHaveText('Charlie')
  await expect(toast(win)).toHaveText("1 tab did not open: the file is gone or its vault can't join")
  await shoot(win, 'sessions-3-restored')

  // S26: the last restored session stands first. S35: sessions and the lens stay after a restart.
  await quitApp(app)
  const saved = await readState(userData)
  expect(saved.sessions.map((s) => s.name)).toEqual(['Outside', 'Project A'])
  expect(saved.windows[0].roots).toEqual([a, b, c])
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(sessionsTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(sessionRow(win, 'Project A')).toContainText('3 tabs')
  await expect(sessionRow(win, 'Outside')).toContainText('2 tabs')
  await shoot(win, 'sessions-4-after-restart')
})
