/**
 * SIDEBAR SORT, END TO END (YAZ-3227): the sort button in the tab row, its menu, the order of the
 * Files tab under Name and Last updated, both ways, a note written on disk moving to its new place
 * with no new walk (D2), and — the claim only the real app can make — the choice kept in
 * `settings.sidebarSort` across a quit and a relaunch (D1).
 *
 * The unit tests (client/src/sidebar/treeSort.test.ts, Sidebar.test.tsx) pin the rule and the menu;
 * here the times are real file times, the write is a real `change` from the watcher, and the order
 * comes back from the state file cold.
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a vault of this spec's own, hidden
 * windows (`YASEEN_DOCS_E2E_HIDDEN`), `sort-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, menuItem, quitApp, readState, seededState, shoot, topLabels } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const sortButton = (w: Page) => w.locator('.sidebar__lenses .sidebar__sort')
/** The menu's labels with their ✓, as the menu draws them (`data-hint`, ContextMenu.tsx). */
const menuLabels = (w: Page) => w.locator('.ctx-overlay .ctx-menu [role="menuitem"]').evaluateAll((items) => items.map((i) => `${i.textContent}${(i as HTMLElement).dataset.hint ?? ''}`))

async function pickSort(label: string): Promise<void> {
  await sortButton(win).click()
  await menuItem(win, label).click()
  await expect(menuItem(win, label)).toHaveCount(0)
}

/** A note with its modified time `minutes` ago. */
async function note(rel: string, minutes: number): Promise<void> {
  const file = path.join(vault, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `# ${path.basename(rel, '.md')}\n`)
  const at = new Date(Date.now() - minutes * 60_000)
  await utimes(file, at, at)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sort-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'sort-vault-'))
  await note('Archive/old.md', 60 * 24 * 30)
  await note('Projects/plan.md', 60)
  await note('Phase 2.md', 60 * 24)
  await note('Phase 10.md', 5)
  await note('zebra.md', 60 * 3)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — Files starts by Name, A to Z: folders first, numbers in number order; the menu offers no Manual', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await expect(topLabels(win)).toHaveText(['Archive', 'Projects', 'Phase 2', 'Phase 10', 'zebra'])
  await sortButton(win).click()
  expect(await menuLabels(win)).toEqual(['Name✓', 'Last updated', 'A to Z✓', 'Z to A'])
  await shoot(win, 'sort-01-menu')
  await win.keyboard.press('Escape')
})

test('step 2 — Last updated reads newest first, a folder as its newest note; Oldest first flips it', async () => {
  await pickSort('Last updated')
  await expect(topLabels(win)).toHaveText(['Projects', 'Archive', 'Phase 10', 'zebra', 'Phase 2'])
  await pickSort('Oldest first')
  await expect(topLabels(win)).toHaveText(['Archive', 'Projects', 'Phase 2', 'zebra', 'Phase 10'])
  await shoot(win, 'sort-02-oldest-first')
})

test('step 3 — a note written on disk takes its new time at once (D2)', async () => {
  await writeFile(path.join(vault, 'Phase 2.md'), '# Phase 2\n\nEdited.\n')
  await expect(topLabels(win)).toHaveText(['Archive', 'Projects', 'zebra', 'Phase 10', 'Phase 2'])
})

test('step 4 — the choice is in the state file and comes back after a quit and a relaunch (D1)', async () => {
  await quitApp(app)
  expect((await readState(userData)).settings.sidebarSort.files).toEqual({ by: 'updated', reverse: true })
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(topLabels(win)).toHaveText(['Archive', 'Projects', 'zebra', 'Phase 10', 'Phase 2'])
  await sortButton(win).click()
  expect(await menuLabels(win)).toEqual(['Name', 'Last updated✓', 'Newest first', 'Oldest first✓'])
  await shoot(win, 'sort-04-relaunch')
})
