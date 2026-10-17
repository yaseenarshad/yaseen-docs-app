/**
 * DUPLICATE TAB (YAZ-2940): a tab's right-click menu has "Duplicate tab", right after "Move to new
 * window" (D5). The copy opens right after its source, with the same name, and shows (D6). Each copy
 * keeps its own folds (S21). Text typed in one copy is in the other when you go to it: the switch
 * saves the copy you leave, and the save reaches its twin at once (D4, S22).
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `duplicate-`
 * step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, CHILD_BULLET, copyVault, editorOf, launchApp, layer, menuItem, SEED_FILE, seededState, shoot, tabsOf, typeMarkerAtLastBullet } from './helpers'

test.describe.configure({ mode: 'serial' })

const NAME = SEED_FILE.replace(/\.md$/, '')

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz2940-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('right-click a tab › Duplicate tab: a copy with its own folds, and text typed in the source is in the copy', async () => {
  const notePath = path.join(vault, SEED_FILE)
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText([NAME])
  await expect(editorOf(win).getByText(CHILD_BULLET)).toBeVisible()

  // D5: the item stands right after "Move to new window".
  await tabsOf(win).first().click({ button: 'right' })
  const items = win.locator('.ctx-menu__item')
  await expect(items.nth(0)).toHaveText('Move to new window')
  await expect(items.nth(1)).toHaveText('Duplicate tab')
  await shoot(win, 'duplicate-1-menu')
  // The tab menu has the sidebar's overlay since YAZ-2949, so the shared `menuItem` finds it by its label.
  await menuItem(win, 'Duplicate tab').click()

  // D6: two tabs of one name, and the copy (the second) shows.
  await expect(tabsOf(win)).toHaveText([NAME, NAME])
  await expect(tabsOf(win).nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(editorOf(win).getByText(CHILD_BULLET)).toBeVisible()

  // S21: fold the parent bullet in the copy.
  await editorOf(win).getByText(CHILD_BULLET).hover() // reveal the chevron (opacity)
  await layer(win).locator('.outline-toggle').first().click()
  await expect(layer(win).locator('[data-outline-folded="true"]').first()).toBeAttached()
  await expect(editorOf(win).getByText(CHILD_BULLET)).toBeHidden()
  await shoot(win, 'duplicate-2-copy-folded')

  // The source keeps its own folds: nothing folded there. Type in it; the save is left pending.
  await tabsOf(win).nth(0).click()
  await expect(tabsOf(win).nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(editorOf(win).getByText(CHILD_BULLET)).toBeVisible()
  const marker = await typeMarkerAtLastBullet(win, 'duplicate-')

  // S22: go to the copy. The source saves on the switch; the copy reloads and keeps its fold.
  await tabsOf(win).nth(1).click()
  await expect(tabsOf(win).nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(editorOf(win).getByText(marker)).toBeVisible()
  await expect(editorOf(win).getByText(CHILD_BULLET)).toBeHidden()
  await expect(layer(win).locator('[data-outline-folded="true"]').first()).toBeAttached()
  await expect(win.locator('.conflict-bar')).toHaveCount(0)
  await shoot(win, 'duplicate-3-copy-synced')
  expect(await readFile(notePath, 'utf8')).toContain(marker)

  // The source is still unfolded, with the text.
  await tabsOf(win).nth(0).click()
  await expect(editorOf(win).getByText(marker)).toBeVisible()
  await expect(editorOf(win).getByText(CHILD_BULLET)).toBeVisible()
})
