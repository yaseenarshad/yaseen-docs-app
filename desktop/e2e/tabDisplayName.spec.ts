/**
 * TAB DISPLAY NAME (YAZ-2949): a tab's menu has four groups, and "Set display name" in the third
 * (D3, D6). The name is typed where the tab was right-clicked, and the field grows with the text
 * (D4). A named tab shows its name on the strip and on the tab board, and the page name in its
 * tooltip (D5). A copy shows the page name (D2). "Reset to page name" puts the page name back.
 * "Move to new window" takes the name to the new window (D7, S19). Since YAZ-3057 the window STORES its copies
 * and names: a reload and a restart bring back the copies, the names and the copy that was on show (S1 to S4, S12).
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `display-name-`
 * step screenshots, serial. It opens windows on screen: run it only where that is fine.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, buildFixtureVault, copyVault, extraWindow, launchApp, menuItem, quitApp, SEED_FILE, seededState, shoot, tabsOf } from './helpers'

test.describe.configure({ mode: 'serial' })

const NAME = SEED_FILE.replace(/\.md$/, '')
const LONG = 'Welcome note · the outline I keep open on the left'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz2949-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

const groups = (w: Page) =>
  w.locator('.ctx-overlay .ctx-menu > [role="group"]').evaluateAll((nodes) => nodes.map((g) => Array.from(g.querySelectorAll('[role="menuitem"]'), (b) => b.textContent)))

test('right-click a tab › Set display name: the copy gets its own name, on the strip and the board, and Reset puts the page name back', async () => {
  const notePath = path.join(vault, SEED_FILE)
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText([NAME])

  // D2: a copy first, so there are two tabs of one page.
  await tabsOf(win).first().click({ button: 'right' })
  await menuItem(win, 'Duplicate tab').click()
  await expect(tabsOf(win)).toHaveText([NAME, NAME])

  // D6, S26: four groups, the name items in the third.
  await tabsOf(win).nth(1).click({ button: 'right' })
  expect((await groups(win)).map((g) => g.filter((label) => !label?.startsWith('Turn review')))).toEqual([
    ['Move to new window', 'Duplicate tab', 'Move to right panel'],
    ['Show in sidebar', 'Copy path'],
    ['Set display name'],
    ['Reveal in Finder', 'Open in VS Code'],
  ])
  await shoot(win, 'display-name-1-menu')
  await menuItem(win, 'Set display name').click()

  // D4, S1, S6: the field stands in the tab, the page name selected, and it grows as the text grows.
  const field = win.locator('.tabbar__rename')
  await expect(field).toBeFocused()
  const narrow = (await field.boundingBox())!.width
  await win.keyboard.type(LONG)
  const wide = (await field.boundingBox())!.width
  expect(wide).toBeGreaterThan(narrow + 100)
  await expect(field).toHaveValue(LONG)
  await shoot(win, 'display-name-2-typing')
  await win.keyboard.press('Enter')

  // D5, S11: the copy shows its name; the source shows the page name; the tooltip gives the page name back.
  await expect(tabsOf(win)).toHaveText([NAME, LONG])
  // S7: after ⏎ the tab is as wide as every tab again: 200 px at most, its long name fades out.
  expect((await win.locator('.tabbar__tab').nth(1).boundingBox())!.width).toBeLessThanOrEqual(202)
  await expect(tabsOf(win).nth(1)).toHaveAttribute('title', `${NAME}\n${notePath}`)
  await shoot(win, 'display-name-3-strip')

  // S12, S13: the board shows the name, and its filter finds the tab by it.
  await win.locator('.tabbar-nav [aria-label="Show all open tabs"]').click()
  await expect(win.locator('.taboverview__page .taboverview__title')).toContainText([NAME, LONG])
  await win.keyboard.type('outline I keep')
  await expect(win.locator('.taboverview__page .taboverview__title')).toHaveText([LONG])
  await shoot(win, 'display-name-4-board')
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')

  // S10: "Reset to page name" is there only now, and puts the page name back.
  await tabsOf(win).nth(1).click({ button: 'right' })
  await menuItem(win, 'Reset to page name').click()
  await expect(tabsOf(win)).toHaveText([NAME, NAME])

  // YAZ-3059 S1, S2, S3: a double-click on a tab opens the same field, the name selected; type, then ⏎. Esc changes nothing.
  await tabsOf(win).first().dblclick()
  await expect(field).toBeFocused()
  await win.keyboard.type('Today')
  await win.keyboard.press('Enter')
  await expect(tabsOf(win)).toHaveText(['Today', NAME])
  await tabsOf(win).first().dblclick()
  await win.keyboard.type('Not saved')
  await win.keyboard.press('Escape')
  await expect(tabsOf(win)).toHaveText(['Today', NAME])
  // The next test starts from this window: give the tab its page name back.
  await tabsOf(win).first().click({ button: 'right' })
  await menuItem(win, 'Reset to page name').click()
  await expect(tabsOf(win)).toHaveText([NAME, NAME])
})

test('Move to new window › the named tab keeps its name there, and a reload of that window keeps it (D7, S19; YAZ-3057 S12)', async () => {
  await tabsOf(win).nth(1).click({ button: 'right' })
  await menuItem(win, 'Set display name').click()
  await win.keyboard.type('Outline')
  await win.keyboard.press('Enter')
  await expect(tabsOf(win)).toHaveText([NAME, 'Outline'])

  await tabsOf(win).nth(1).click({ button: 'right' })
  await menuItem(win, 'Move to new window').click()
  const popped = await extraWindow(app, ['w1'])
  await expect(tabsOf(popped)).toHaveText(['Outline'])
  await expect(tabsOf(win)).toHaveText([NAME])
  await shoot(popped, 'display-name-5-new-window')

  // The name is stored with the new window's tab (YAZ-3057 D3): a reload reads it again.
  await popped.reload()
  await expect(tabsOf(popped)).toHaveText(['Outline'])
})

test('YAZ-3057: a copy, its display name and the copy on show come back after a reload (⌘R) and after a quit and a restart', async () => {
  await expect(tabsOf(win)).toHaveText([NAME])
  await tabsOf(win).first().click({ button: 'right' })
  await menuItem(win, 'Duplicate tab').click()
  await tabsOf(win).nth(1).click({ button: 'right' })
  await menuItem(win, 'Set display name').click()
  await win.keyboard.type('Draft view')
  await win.keyboard.press('Enter')
  await expect(tabsOf(win)).toHaveText([NAME, 'Draft view'])
  await expect(activeTab(win)).toHaveText('Draft view')

  // S3: a reload reads the stored strip.
  await win.reload()
  await expect(tabsOf(win)).toHaveText([NAME, 'Draft view'])
  await expect(activeTab(win)).toHaveText('Draft view')

  // S1, S2, S4: the REAL quit path, then a launch with no re-seed: the restore is whatever quit wrote.
  await quitApp(app)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText([NAME, 'Draft view'])
  await expect(activeTab(win)).toHaveText('Draft view')
  await shoot(win, 'display-name-6-after-restart')
})
