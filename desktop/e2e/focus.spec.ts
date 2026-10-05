/**
 * FOCUS MODE, END TO END (S12 of YAZ-2171 — YAZ-1605 / 1628): right-click a folder → "Focus on
 * folder" narrows the Files lens to that folder alone, the eye ("Exit focus mode") lights in the
 * lens row, and one click on it brings the whole tree back.
 *
 * What only the real app can prove is WHERE the focus lives: it is WINDOW identity since YAZ-1628
 * (`WindowEntry.focusDirs`, next to the lens), written to `yaseendocs.json` through main and
 * restored from it — so quit → relaunch comes back NARROWED, on a tree that is otherwise folded
 * (expansion is session state, YAZ-1642: the focused folder's row is there, its children are not).
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a COPY of the generated fixture,
 * `focus-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, dirRow, fileRow, launchApp, lensTab, menuItem, quitApp, readState, SEED_FILE, seededState, shoot, topLabels } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (client/src/sidebar/Sidebar.tsx, Tree.tsx) ----------

/** Focus Mode's eye: in the lens row, lit ONLY while the active lens is focused (YAZ-1605). */
const eye = (w: Page) => w.locator('.sidebar__lenses .sidebar__focus-off')
const openDirs = (w: Page) => w.locator('.sidebar__body li[role="treeitem"][aria-expanded="true"]')

/** Right-click `row` and take the menu's Focus item — the only way in (Sidebar.test.tsx's `focusRow`). */
async function focusVia(row: Locator, label: 'Focus on folder'): Promise<void> {
  await row.click({ button: 'right' })
  await expect(menuItem(win, label)).toBeVisible()
  await menuItem(win, label).click()
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'focus-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the focus

test('step 1 — "Focus on folder" makes the folder the only top row, opens it, lights the eye and writes `focusDirs` to the window\'s state entry', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(dirRow(win, 'Projects')).toBeVisible()
  await expect(eye(win)).toHaveCount(0) // nothing focused: no eye
  // Focus is a FOLDER verb: a file row's menu has no such item (Sidebar.test.tsx pins blank space too).
  await fileRow(win, 'Ideas').click({ button: 'right' })
  await expect(menuItem(win, 'Cut')).toBeVisible()
  await expect(menuItem(win, 'Focus on folder')).toHaveCount(0)
  await win.keyboard.press('Escape')

  await focusVia(dirRow(win, 'Projects'), 'Focus on folder')
  // The tree narrows to the folder — and OPENS it, so the focus never lands on a closed chevron.
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(fileRow(win, 'Roadmap')).toBeVisible()
  await expect(dirRow(win, 'archive')).toBeVisible()
  await expect(fileRow(win, 'Ideas')).toHaveCount(0)
  await expect(fileRow(win, 'Welcome note')).toHaveCount(0) // the ACTIVE file's row is hidden too
  await expect(eye(win)).toHaveAttribute('aria-label', 'Exit focus mode')
  // Window identity (YAZ-1628): the window's entry, never the vault bucket.
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusDirs).toEqual([path.join(vault, 'Projects')])
  expect((await readState(userData)).folders[vault]).not.toHaveProperty('focusDirs')
  await shoot(win, 'focus-01-folder-focused')
})

// ---------------------------------------------------------------- the relaunch

test('step 2 — the focus survives quit → relaunch: the Files lens comes back narrowed, the folder folded, the eye lit', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect((await readState(userData)).windows[0]?.focusDirs).toEqual([path.join(vault, 'Projects')])

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect(fileRow(win, 'Ideas')).toHaveCount(0)
  await expect(eye(win)).toHaveAttribute('aria-label', 'Exit focus mode')
  // Folded: the focus is durable, the expansion is not (YAZ-1642) — the row, without its children.
  await expect(openDirs(win)).toHaveCount(0)
  await expect(fileRow(win, 'Roadmap')).toHaveCount(0)
  await shoot(win, 'focus-02-restored-folded')
})

// ---------------------------------------------------------------- the eye

test('step 3 — one click on the eye ends the focus: the whole tree is back, the eye is gone, `focusDirs` is empty', async () => {
  await eye(win).click()
  await expect(eye(win)).toHaveCount(0)
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  await expect(fileRow(win, 'Welcome note')).toBeVisible()
  await expect(dirRow(win, 'Projects')).toBeVisible()
  await expect(topLabels(win)).toHaveCount(3) // Projects + Ideas, Welcome note
  await expect.poll(async () => (await readState(userData)).windows[0]?.focusDirs).toEqual([])
  await shoot(win, 'focus-03-exited')
  await quitApp(app)
})
