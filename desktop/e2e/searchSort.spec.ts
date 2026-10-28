/**
 * SEARCH SORT AND DATES, END TO END (YAZ-3511): the sort button of the tab row on the Search tab,
 * its menu with "Show last updated", the search tree under Name and Last updated, each row's date
 * from the real file times, a note written on disk taking "now" at once (D2), and — the claim only
 * the real app can make — `settings.searchSort` and `settings.searchDates` kept across a quit and a
 * relaunch while the Files sort stays its own (D1).
 *
 * The unit tests (client/src/sidebar/treeSort.test.ts, Sidebar.test.tsx "YAZ-3511") pin the rule,
 * the menu and the ↑/↓ order; here the times are real file times and the state comes back cold.
 *
 * Same harness as sidebarSort.spec.ts: temp `--user-data-dir`, a vault of this spec's own, hidden
 * windows (`YASEEN_DOCS_E2E_HIDDEN`), `search-sort-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, lensTab, menuItem, quitApp, readState, searchBar, seededState, shoot, showSearchTab, topLabels } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const sortButton = (w: Page) => w.locator('.sidebar__lenses .sidebar__sort')
/** The menu's labels with their ✓, as the menu draws them (`data-hint`, ContextMenu.tsx). */
const menuLabels = (w: Page) => w.locator('.ctx-overlay .ctx-menu [role="menuitem"]').evaluateAll((items) => items.map((i) => `${i.textContent}${(i as HTMLElement).dataset.hint ?? ''}`))
/** Every row of the search tree, top to bottom. */
const labels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
/** Each row as "label date", or "label -" with no date. */
const dated = (w: Page) =>
  w.locator('.sidebar__body .tree__row').evaluateAll((rows) => rows.map((r) => `${r.querySelector('.tree__label')?.textContent} ${r.querySelector('.tree__date')?.textContent ?? '-'}`))

async function pick(label: string): Promise<void> {
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

async function searchPlan(): Promise<void> {
  await showSearchTab(win)
  await searchBar(win).fill('plan')
  await expect(labels(win).first()).toHaveText('Plans')
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'search-sort-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'search-sort-vault-'))
  await note('Plans/plan b.md', 60 * 3)
  await note('Plans/plan 10.md', 60 * 24 * 2)
  await note('plan old.md', 60 * 24 * 150)
  await note('plan new.md', 5)
  await note('Other/notes.md', 60)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — Search starts by Name, A to Z, with a date at the end of each row; the menu offers no Manual and ends with "Show last updated"', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await searchPlan()
  await expect.poll(() => dated(win)).toEqual(['Plans 3h', 'plan 10 2d', 'plan b 3h', 'plan new 5m', 'plan old 5mo'])
  await sortButton(win).click()
  expect(await menuLabels(win)).toEqual(['Name✓', 'Last updated', 'A to Z✓', 'Z to A', 'Show last updated✓'])
  await shoot(win, 'search-sort-01-menu')
  await win.keyboard.press('Escape')
})

test('step 2 — Last updated puts the newest first at each level, folders above files', async () => {
  await pick('Last updated')
  await expect(labels(win)).toHaveText(['Plans', 'plan b', 'plan 10', 'plan new', 'plan old'])
  await shoot(win, 'search-sort-02-last-updated')
})

test('step 3 — a note written on disk reads "now" and moves up at once (D2)', async () => {
  await writeFile(path.join(vault, 'plan old.md'), '# plan old\n\nEdited.\n')
  await expect(labels(win)).toHaveText(['Plans', 'plan b', 'plan 10', 'plan old', 'plan new'])
  await expect.poll(() => dated(win)).toContain('plan old now')
})

test('step 4 — "Show last updated" turns the dates off', async () => {
  await pick('Show last updated')
  await expect(win.locator('.sidebar__body .tree__date')).toHaveCount(0)
  await shoot(win, 'search-sort-04-no-dates')
})

test('step 5 — both choices are in the state file and come back after a quit and a relaunch; Files keeps its own sort (D1)', async () => {
  await quitApp(app)
  const { settings } = await readState(userData)
  expect(settings.searchSort).toEqual({ by: 'updated', reverse: false })
  expect(settings.searchDates).toBe(false)
  expect(settings.sidebarSort.files).toEqual({ by: 'name', reverse: false })
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await searchPlan()
  await expect(labels(win)).toHaveText(['Plans', 'plan b', 'plan 10', 'plan old', 'plan new'])
  await expect(win.locator('.sidebar__body .tree__date')).toHaveCount(0)
  await sortButton(win).click()
  expect(await menuLabels(win)).toEqual(['Name', 'Last updated✓', 'Newest first✓', 'Oldest first', 'Show last updated'])
  await win.keyboard.press('Escape')
  await lensTab(win, 'Files').click()
  await expect(topLabels(win)).toHaveText(['Other', 'Plans', 'plan new', 'plan old'])
  await shoot(win, 'search-sort-05-relaunch')
})
