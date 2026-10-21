/**
 * MOVE TO ▸ A WINDOW (YAZ-3091): a tab's right-click menu has "Move to ▸", whose flyout lists the
 * other open windows that show the page's vault, a line, then "Right panel" (D2, D3). A click on a
 * window saves the page, main hands the tab to that window (`window:move-to` → `link:take-tab`, D1),
 * and only then does the tab leave. The target adds it as a new tab at the end, active — a copy
 * when the page is open there (D5). A window that the move leaves with no tab and an empty right
 * panel closes through its real close (D6). The saved state is the proof: main writes it.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, hidden windows
 * (`YASEEN_DOCS_E2E_HIDDEN`, helpers.ts), `movewin-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, extraWindow, launchApp, readState, seededState, shoot, windowCount } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const tabNames = (w: Page) => w.locator('.tabbar [role="tab"]')
/** An item of a tab menu or of its flyout, by its exact label. */
const menuEntry = (w: Page, label: string | RegExp) => w.locator('.ctx-menu [role="menuitem"]').filter({ hasText: typeof label === 'string' ? new RegExp(`^${label}$`) : label })
/** The groups of the open "Move to ▸" flyout, each as its labels. */
const flyoutGroups = (w: Page) =>
  w.locator('.ctx-menu__sub [role="group"]').evaluateAll((groups) => groups.map((g) => Array.from(g.querySelectorAll('[role="menuitem"]'), (b) => b.textContent)))

/** "Move to new window" on strip tab `tab` of `w`: resolves with the new window. */
async function popOut(w: Page, tab: Locator, known: readonly string[]): Promise<Page> {
  await tab.click({ button: 'right' })
  await menuEntry(w, 'Move to new window').click()
  return extraWindow(app, known)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3091-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'yaz3091-vault-'))
  await Promise.all([
    writeFile(path.join(vault, 'Stays.md'), '# Stays\n\nmovewin-stays-body\n'),
    writeFile(path.join(vault, 'Travels.md'), '# Travels\n\nmovewin-travels-body\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('pop a tab out, then Move to ▸ the first window: the tab comes back last and active, and the small window closes', async () => {
  const stays = path.join(vault, 'Stays.md')
  const travels = path.join(vault, 'Travels.md')
  const state = seededState(vault, stays)
  state.windows[0].tabs = [stays, travels]
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(tabNames(win)).toHaveText(['Stays', 'Travels'])

  const popped = await popOut(win, tabNames(win).nth(1), ['w1'])
  await expect(activeTab(popped)).toHaveText('Travels')
  await expect(tabNames(win)).toHaveText(['Stays'])
  expect(await windowCount(app)).toBe(2)

  // D3: Move to new window · Duplicate tab · Move to ▸ (the first window, a line, Right panel). D7: "<vault> — <page> · N tabs".
  await tabNames(popped).first().click({ button: 'right' })
  await expect(popped.locator('.ctx-menu [role="group"]').first().locator('[role="menuitem"]')).toHaveText(['Move to new window', 'Duplicate tab', 'Move to'])
  await menuEntry(popped, 'Move to').click()
  expect(await flyoutGroups(popped)).toEqual([[`${path.basename(vault)} — Stays · 1 tab`], ['Right panel']])
  await shoot(popped, 'movewin-1-flyout')
  await menuEntry(popped, /· 1 tab$/).click()

  // D5: the first window shows it, last and active, with its page. D6: the small window had no other tab, so it closed.
  await expect(tabNames(win)).toHaveText(['Stays', 'Travels'])
  await expect(activeTab(win)).toHaveText('Travels')
  await expect(win.getByText('movewin-travels-body')).toBeVisible()
  await expect.poll(() => windowCount(app)).toBe(1)
  await shoot(win, 'movewin-2-back')

  // Main wrote it: one window left, and it holds both pages.
  await expect.poll(async () => (await readState(userData)).windows.map((w) => w.id)).toEqual(['w1'])
  await expect.poll(async () => (await readState(userData)).windows[0]).toMatchObject({ file: travels, tabs: [stays, travels] })
})

test('the page is open in the first window too: the move adds a copy at the end, and the open tab stays', async () => {
  const travels = path.join(vault, 'Travels.md')
  // A copy of Travels stays here (YAZ-2940 D5); the other copy pops out.
  await tabNames(win).nth(1).click({ button: 'right' })
  await menuEntry(win, 'Duplicate tab').click()
  await expect(tabNames(win)).toHaveText(['Stays', 'Travels', 'Travels'])
  const popped = await popOut(win, tabNames(win).nth(2), ['w1'])
  await expect(activeTab(popped)).toHaveText('Travels')
  await expect(tabNames(win)).toHaveText(['Stays', 'Travels'])

  await tabNames(popped).first().click({ button: 'right' })
  await menuEntry(popped, 'Move to').click()
  await menuEntry(popped, /· 2 tabs$/).click()

  // D5, S11: a copy at the end, active; the tab that was open keeps its place.
  await expect(tabNames(win)).toHaveText(['Stays', 'Travels', 'Travels'])
  await expect(win.locator('.tabbar__tab').nth(2).locator('[role="tab"]')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => windowCount(app)).toBe(1)
  await shoot(win, 'movewin-3-copy')
  await expect.poll(async () => (await readState(userData)).windows[0].tabStrip).toEqual([{ path: path.join(vault, 'Stays.md') }, { path: travels }, { path: travels, active: true }])
})
