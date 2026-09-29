/**
 * FAVORITES, END TO END (S13 of YAZ-2171 — YAZ-1766 / 1794): "Add to favorites" on a file and a
 * folder, the ♥ lens listing them in STORED order, a root row dragged to reorder that order, the
 * list removed from, and — the claim only the real app can make — every one of those landing in the
 * vault's own `.yaseendocs/favorites.json` as vault-relative paths, where a SECOND window on the
 * same vault reads it back through main's `favorites:changed`.
 *
 * The unit tests (client/src/sidebar/Sidebar.test.tsx) fake the bridge and pin the toast, the
 * labels and the absolute-path call; here the bytes on disk are parsed after each gesture, the
 * duplicate window is a real ⌘⇧N, and quit → relaunch reads the file cold with the ♥ lens restored
 * from `WindowEntry.sidebarLens`.
 *
 * THE DRAG is `topicsDrag.spec.ts`'s: press on the row, carry the pointer to the target's TOP HALF
 * (the `before` edge, Tree.tsx `edgeOf`), rest there — re-issuing the move — until the target
 * wears `tree__row--drop-before`, release. A synthetic HTML5 drag over CDP delivers only a fraction
 * of its `dragover`s, so the rest is what makes the drop land where a real held pointer would.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a COPY of the generated fixture,
 * `favorites-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, beforeEdge, buildFixtureVault, centre, clickMenuItem, closeWindow, copyVault, dirRow, extraWindow, fileRow, launchApp, menuItem, quitApp, readState, SEED_FILE, seededState, shoot, topLabels, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (client/src/sidebar/Sidebar.tsx, Tree.tsx, ContextMenu.tsx) ----------

/** The ♥ tab: a glyph, so its name lives in `aria-label` (YAZ-1766 D1). */
const heartTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Favorites"]')
/** App's one passive toast (`.link-notice`, YAZ-1341) — its text. */
const toast = (w: Page) => w.locator('.link-notice__text')
const bodyMsg = (w: Page) => w.locator('.sidebar__body .sidebar__msg')

/** The stored list, parsed — vault-RELATIVE paths in the user's order; null while the file is absent. */
async function favoritesOnDisk(): Promise<string[] | null> {
  const raw = await readFile(path.join(vault, '.yaseendocs', 'favorites.json'), 'utf8').catch(() => null)
  if (raw === null) return null
  const parsed = JSON.parse(raw) as { version: number; favorites: string[] }
  expect(parsed.version).toBe(1)
  return parsed.favorites
}

/** Right-click `row` and take the menu's `label` — the only way in for every favorite gesture. */
async function pickFromRowMenu(row: Locator, label: string): Promise<void> {
  await row.click({ button: 'right' })
  await expect(menuItem(win, label)).toBeVisible()
  await menuItem(win, label).click()
}

/**
 * ROOT ROW ABOVE ROOT ROW (YAZ-1766 D4): press on `source`, carry the pointer into `target`'s top
 * half, REST there until the target says the drop lands before it, release. The wait is an
 * assertion: the highlight IS the `dragover` handler the drop needs (see the module doc).
 */
async function dragAbove(source: Locator, target: Locator): Promise<void> {
  const from = await centre(source)
  const to = await beforeEdge(target)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 10 })
  await expect
    .poll(async () => {
      await win.mouse.move(to.x, to.y)
      return target.getAttribute('class')
    })
    .toContain('tree__row--drop-before')
  await win.mouse.up()
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'favorites-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- add, and the ♥ lens

test('step 1 — "Add to favorites" on a file and on a folder writes `.yaseendocs/favorites.json` in that order; the ♥ lens lists both', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Ideas')).toBeVisible()
  expect(await favoritesOnDisk()).toBeNull() // nothing is created until the first favorite

  // A FILE first: the toast confirms, and the vault file is born holding one RELATIVE path.
  await pickFromRowMenu(fileRow(win, 'Ideas'), 'Add to favorites')
  await expect(toast(win)).toHaveText('Added to favorites')
  await expect.poll(favoritesOnDisk).toEqual(['Ideas.md'])

  // Then a FOLDER: appended AFTER the file — stored order is the order of adding (D4), never the tree's.
  await pickFromRowMenu(dirRow(win, 'Projects'), 'Add to favorites')
  await expect.poll(favoritesOnDisk).toEqual(['Ideas.md', 'Projects'])
  // Back on Files the pinned row now reads Remove; the vault's state bucket is untouched (D15).
  await dirRow(win, 'Projects').click({ button: 'right' })
  await expect(menuItem(win, 'Remove from favorites')).toBeVisible()
  await win.keyboard.press('Escape')
  expect((await readState(userData)).folders[vault]).not.toHaveProperty('favorites')

  // The ♥ lens: the two rows in STORED order, each a full tree row — the folder collapsed, since
  // it shares the Files expansion (D7) and nothing opened it.
  await heartTab(win).click()
  await expect(heartTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Ideas', 'Projects'])
  await expect(fileRow(win, 'Roadmap')).toHaveCount(0)
  await expect.poll(async () => (await readState(userData)).windows[0]?.sidebarLens).toBe('favorites')
  await shoot(win, 'favorites-01-two-pinned')
})

// ---------------------------------------------------------------- reorder

test('step 2 — dragging the folder row above the file row rewrites the stored order, on screen and on disk', async () => {
  await dragAbove(dirRow(win, 'Projects'), fileRow(win, 'Ideas'))
  await expect(topLabels(win)).toHaveText(['Projects', 'Ideas'])
  await expect.poll(favoritesOnDisk).toEqual(['Projects', 'Ideas.md'])
  await expect(win.locator('.tree__row--drop-before, .tree__row--drop-after')).toHaveCount(0) // the edge goes with the drag
  // Nothing moved on disk: the reorder rewrites the LIST and never touches the vault's files (D4).
  await expect(fileRow(win, 'Ideas')).toHaveAttribute('data-path', path.join(vault, 'Ideas.md'))
  await shoot(win, 'favorites-02-reordered')
})

// ---------------------------------------------------------------- a second window, and remove

test('step 3 — a second window on the vault shows the same list, and sees a removal made in the first', async () => {
  // ⌘⇧N (menu.file.new-window) duplicates the window — lens included, so the copy opens on ♥ too.
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  const dup = await extraWindow(app, ['w1'])
  const dupId = winParam(dup)!
  expect(await windowCount(app)).toBe(2)
  await expect(heartTab(dup)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(dup)).toHaveText(['Projects', 'Ideas'])

  // Remove in the FIRST window: the toast, the file, and the OTHER window's rows — which it can
  // only know through main's `favorites:changed` off the file it just wrote.
  await pickFromRowMenu(fileRow(win, 'Ideas'), 'Remove from favorites')
  await expect(toast(win)).toHaveText('Removed from favorites')
  await expect(topLabels(win)).toHaveText(['Projects'])
  await expect.poll(favoritesOnDisk).toEqual(['Projects'])
  await expect(topLabels(dup)).toHaveText(['Projects'])
  await shoot(dup, 'favorites-03-second-window')

  await closeWindow(app, dupId)
  await expect.poll(() => windowCount(app)).toBe(1)
})

// ---------------------------------------------------------------- relaunch, and the last one out

test('step 4 — quit → relaunch reads the vault file cold on the restored ♥ lens; removing the last favorite empties the file and shows the hint', async () => {
  await quitApp(app)
  expect(await favoritesOnDisk()).toEqual(['Projects'])
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(heartTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(topLabels(win)).toHaveText(['Projects'])
  await shoot(win, 'favorites-04-restored')

  await pickFromRowMenu(dirRow(win, 'Projects'), 'Remove from favorites')
  await expect(bodyMsg(win)).toHaveText('No favorites yet. Right-click a file or folder → Add to favorites.')
  await expect.poll(favoritesOnDisk).toEqual([]) // the file stays, empty — never deleted
  await shoot(win, 'favorites-05-empty')
  await quitApp(app)
})
