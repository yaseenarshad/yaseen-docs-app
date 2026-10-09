/**
 * The new tab page (YAZ-2663) against the REAL app: the one flow of D7 — ⌘T, →, ↓, Enter opens a
 * recent page with no mouse — over an open history that the state file is seeded with, and the use
 * that this open adds to it (D1). Same harness as lenses.spec.ts (temp `--user-data-dir`, a COPY of
 * the generated fixture vault). What the page draws, and each other key, are
 * `client/src/workspace/StartPage.test.tsx`'s; the look and the row menu are the hand scenario W13
 * of docs/REGRESSION.md.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, buildFixtureVault, clickMenuItem, copyVault, editorOf, launchApp, previewTab, quitApp, readState, searchBar, SEED_FILE, seededState, shoot, tabsOf } from './helpers'

/** The body of the fixture's `Ideas.md` (helpers.buildFixtureVault). */
const IDEAS_BODY = 'synthetic-idea-body'
const MINUTE = 60_000

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

/** The rows of "Recent", in the order drawn. */
const recent = (w: Page) => w.locator('.start__column[data-col="recent"] .start__row')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'startpage-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('⌘T, →, ↓, Enter: a recent page opens from the new tab page with no mouse, as a kept tab, and that is one more use of it', async () => {
  const roadmap = path.join(vault, 'Projects', 'Roadmap.md')
  const ideas = path.join(vault, 'Ideas.md')
  // The open history of the vault (YAZ-2663 D1): two pages were on show before this launch, Roadmap last.
  const seededAt = Date.now()
  const state = seededState(vault, path.join(vault, SEED_FILE))
  state.folders[vault].opens = { [roadmap]: { score: 1, last: seededAt - MINUTE }, [ideas]: { score: 1, last: seededAt - 2 * MINUTE } }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText(['Welcome note'])

  // ⌘T — File › New Tab, by its menu id: the page shows under "New tab", and the caret is in the empty search bar.
  await clickMenuItem(app, 'menu.file.new-tab', 'w1')
  await expect(win.locator('.start__heading')).toHaveText(['Recent', 'Favorites', 'Used a lot, not a favorite yet'])
  // S12: the newest first, each with its folder. The launch added no use (S10): the page the window opened on is no row.
  await expect(recent(win).locator('.start__name')).toHaveText(['Roadmap', 'Ideas'])
  await expect(recent(win).first().locator('.start__where')).toHaveText('Projects')
  await expect(searchBar(win)).toBeFocused()
  await expect(searchBar(win)).toHaveValue('')

  // → in the empty bar goes to the first row of the page (S33), and ↓ walks the column (S35).
  await win.keyboard.press('ArrowRight')
  await expect(recent(win).nth(0)).toBeFocused()
  await win.keyboard.press('ArrowDown')
  await expect(recent(win).nth(1)).toBeFocused()
  await shoot(win, 'startpage-01-row-focus')

  // Enter fills the blank tab (S38): ONE kept tab, and the page is gone.
  await win.keyboard.press('Enter')
  await expect(tabsOf(win)).toHaveText(['Welcome note', 'Ideas'])
  await expect(activeTab(win)).toHaveText('Ideas')
  await expect(previewTab(win)).toHaveCount(0)
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await expect(win.locator('.start')).toHaveCount(0)

  // S1: that page came on show — one more use of it, with the time, in the record that the quit wrote. Roadmap got none.
  await quitApp(app)
  const { opens } = (await readState(userData)).folders[vault]
  expect(opens[ideas].score).toBeGreaterThan(1)
  expect(opens[ideas].last).toBeGreaterThanOrEqual(seededAt)
  expect(opens[roadmap]).toEqual({ score: 1, last: seededAt - MINUTE })
})
