/**
 * The new tab page (YAZ-2663) against the REAL app: the one flow of D7 — ⌘T, →, ↓, Enter opens a
 * recent page with no mouse — over an open history that the state file is seeded with, and the use
 * that this open adds to it (D1). Then the room of a row (YAZ-2740 D2): in a narrow window with two
 * vaults, the name shows in full and the vault tag gave way — only the real app lays a row out.
 * Same harness as lenses.spec.ts (temp `--user-data-dir`, a COPY of the generated fixture vault).
 * What the page draws, and each other key, are `client/src/workspace/StartPage.test.tsx`'s; the look
 * and the row menu are the hand scenario W13 of docs/REGRESSION.md.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultFolderState } from '../../shared/types'
import { activeTab, appWindow, buildFixtureVault, clickMenuItem, copyVault, editorOf, launchApp, previewTab, quitApp, readState, searchBar, SEED_FILE, seededState, shoot, tabsOf } from './helpers'

/** The body of the fixture's `Ideas.md` (helpers.buildFixtureVault). */
const IDEAS_BODY = 'synthetic-idea-body'
const MINUTE = 60_000
/** A name with more letters than a narrow row has room for beside a whole vault tag, and the name that tag shows (YAZ-2740 S9). */
const LONG_NAME = 'Notes of the weekly meeting'
const LONG_VAULT_NAME = 'Vault of the weekly meeting notes'

let userData: string
let vaultSrc: string
let vault: string
/** The second vault of the window in the narrow-row test: a row of the page has a vault tag only with two (YAZ-2663 S20). */
let vault2: string
let app: ElectronApplication
let win: Page

/** The rows of "Recent", in the order drawn. */
const recent = (w: Page) => w.locator('.start__column[data-col="recent"] .start__row')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'startpage-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  vault2 = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault, vault2].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
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
  await expect(win.locator('.start__heading')).toHaveText(['Recently closed', 'Recently viewed', 'Favorites'])
  // S12: the newest first, each with its folder. The launch added no use (S10): the page the window opened on is no row.
  await expect(recent(win).locator('.start__name')).toHaveText(['Roadmap', 'Ideas'])
  await expect(recent(win).first().locator('.start__where')).toHaveText('Projects')
  // YAZ-2740 D1: how long ago is a few letters — a minute, and two minutes, before the launch.
  await expect(recent(win).locator('.start__when')).toHaveText([/^\d+m$/, /^\d+m$/])
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

// Written for YAZ-2740 without being run; the widths were measured on a copy of the row in headless Chromium. First
// run hidden for YAZ-3343 (26 Oct 2026): it passes once ⌘T waits for the page.
test('a narrow window with two vaults: the long name of a recent page shows in full, and the vault tag gave way (YAZ-2740 S9)', async () => {
  // This test stands by itself: the app of the test above is gone, also when that test stopped before its quit.
  await app?.close().catch(() => undefined)
  const note = path.join(vault, `${LONG_NAME}.md`)
  await writeFile(note, `# ${LONG_NAME}\n`)
  // ONE window on two vaults (`twoVaultState` of sidebarOrder.spec.ts). The page is in the first one, under a display name longer than the folder's.
  const seededAt = Date.now()
  const state = seededState(vault, path.join(vault, SEED_FILE))
  state.windows = state.windows.map((entry) => ({ ...entry, roots: [vault, vault2] }))
  state.recents.push({ path: vault2, lastOpened: seededAt - MINUTE })
  state.folders[vault2] = defaultFolderState()
  state.folders[vault].name = LONG_VAULT_NAME
  state.folders[vault].opens = { [note]: { score: 1, last: seededAt - MINUTE } }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  // The page listens for the menu once its tab shows: ⌘T before that is lost. (The old focus step of `clickMenuItem`
  // waited about 3 s by chance; the hidden run has none since YAZ-3343.)
  await expect(activeTab(win)).toHaveText('Welcome note')
  await clickMenuItem(app, 'menu.file.new-tab', 'w1')
  await expect(recent(win).locator('.start__name')).toHaveText([LONG_NAME])
  await expect(recent(win).locator('.tree__vault')).toHaveText([LONG_VAULT_NAME])

  // 680px of window leave the page area about 417px: one column (S14), and a row with room for the name and the time, not for the whole tag too.
  // On the copy of the row, from 319px to 519px of page area the name is in full and the tag is not.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(680, 700)
  })
  // S9: the tag gave way, and the name did not. Before YAZ-2740 the tag kept its 40% of the row and the name was cut at every page area under 520px.
  await expect
    .poll(() =>
      recent(win)
        .first()
        .evaluate((row) => {
          const cut = (part: string): boolean | null => {
            const el = row.querySelector(part)
            return el === null ? null : el.scrollWidth > el.clientWidth
          }
          return { name: cut('.start__name'), tag: cut('.tree__vault') }
        }),
    )
    .toEqual({ name: false, tag: true })
  await shoot(win, 'startpage-02-narrow-row')
  await quitApp(app)
})
