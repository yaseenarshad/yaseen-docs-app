/**
 * The lens tabs (6A-, YAZ-847) end-to-end against the REAL app: chrome v2 ROW 1 above the
 * persistent search bar. Files is the DEFAULT lens (YAZ-1846) and is the file explorer; the
 * Favorites tab beside it is `favorites.spec.ts`'s, switch and relaunch included.
 *
 * The seed here is deliberately NOT `seededState`'s: that helper pre-selects Files for the rest
 * of the suite (every other spec is about the tree), so this one seeds a PRE-847 state file —
 * every key of a valid state except `sidebarLens` — which is also the honest upgrade case: an
 * existing user's `yaseendocs.json` gains the lens and lands on the default, Files (YAZ-1846).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppState, WindowEntry } from '../../shared/types'
import { appWindow, buildFixtureVault, copyVault, fileRow, launchApp, lensTab, quitApp, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators ----------

const bodyMsg = (w: Page) => w.locator('.sidebar__body .sidebar__msg')
const searchBar = (w: Page) => w.locator('[aria-label="Search notes"]')

/** The lens a tab row reports through `aria-selected` — exactly one at a time. */
async function expectLens(w: Page, lens: 'Files'): Promise<void> {
  await expect(lensTab(w, lens)).toHaveAttribute('aria-selected', 'true')
  await expect(w.locator('.sidebar__lenses [aria-selected="true"]')).toHaveCount(1)
}

/**
 * A PRE-847 `yaseendocs.json`: `seededState`'s window/folder seed with the window's lens key
 * removed (and no retired global one either), so the store's sanitize pass is what supplies the
 * default. `JSON.stringify` drops `undefined`, so the key never reaches disk.
 */
function preLensState(vaultPath: string, file: string): AppState {
  const state = seededState(vaultPath, file)
  delete (state.windows[0] as Partial<WindowEntry>).sidebarLens
  return state
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'lenses-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the default

test('a state file with no lens boots on FILES (YAZ-1846 D1): the file tree', async () => {
  app = await launchApp({ userData, seedState: preLensState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(lensTab(win, 'Files')).toBeVisible()
  await expectLens(win, 'Files')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(bodyMsg(win)).toHaveCount(0)
  await expect(searchBar(win)).toBeVisible() // ALWAYS visible (the locked YAZ-739 rule)
  await shoot(win, 'lens-01-files-default')
  await quitApp(app)
})
