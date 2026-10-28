/**
 * SEARCH SORT, DATES AND FILTERS, END TO END (YAZ-3511): the sort button of the tab row on the Search tab, its menu
 * with Best match (the default), "Show last updated" and the Type and Time filters, the search tree under each sort,
 * each row's date from the real file times, a note written on disk taking "now" at once (D2), a filter that resets
 * when the bar is empty (D15), and — the claim only the real app can make — `settings.searchSort` and
 * `settings.rowDates` kept across a quit and a relaunch while the Files sort and its date switch stay their own (D1, D10).
 *
 * The unit tests (client/src/sidebar/treeSort.test.ts, client/src/search/searchFilter.test.ts, Sidebar.test.tsx
 * "YAZ-3511") pin the rules, the menu and the ↑/↓ order; here the times are real file times and the state comes back cold.
 *
 * Same harness as sidebarSort.spec.ts: temp `--user-data-dir`, a vault of this spec's own, hidden
 * windows (`YASEEN_DOCS_E2E_HIDDEN`), `search-sort-` step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, lensTab, menuItem, menuListItem, quitApp, readState, searchBar, seededState, shoot, showSearchTab, topLabels } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const sortButton = (w: Page) => w.locator('.sidebar__lenses .sidebar__sort')
/** The menu's labels with their ✓ or their pick, as the menu draws them (`data-hint`, ContextMenu.tsx). */
const menuLabels = (w: Page) =>
  w.locator('.ctx-overlay .ctx-menu:not(.ctx-menu__sub) [role="menuitem"]').evaluateAll((items) => items.map((i) => `${i.textContent}${(i as HTMLElement).dataset.hint ?? ''}`))
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

/** A filter's choice: the parent row ("Type", "Time") opens its list, and the choice closes the menu. */
async function filter(parent: string, label: string): Promise<void> {
  await sortButton(win).click()
  await menuItem(win, parent).click()
  await menuListItem(win, label).click()
  await expect(menuItem(win, parent)).toHaveCount(0)
}

/** A file with its modified time `minutes` ago. */
async function note(rel: string, minutes: number): Promise<void> {
  const file = path.join(vault, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, rel.endsWith('.md') ? `# ${path.basename(rel, '.md')}\n` : 'x')
  const at = new Date(Date.now() - minutes * 60_000)
  await utimes(file, at, at)
}

async function searchPlan(first: string): Promise<void> {
  await showSearchTab(win)
  await searchBar(win).fill('plan')
  await expect(labels(win).first()).toHaveText(first)
}

const ALL = ['plan', 'plan new', 'plan scan.pdf', 'Plans', 'plan b', 'plan 10', 'plan old', 'Project plan']

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'search-sort-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'search-sort-vault-'))
  await note('plan.md', 60 * 24 * 30)
  await note('Plans/plan b.md', 60 * 3)
  await note('Plans/plan 10.md', 60 * 24 * 2)
  await note('plan old.md', 60 * 24 * 400)
  await note('plan new.md', 5)
  await note('plan scan.pdf', 60 * 2)
  await note('Project plan.md', 1)
  await note('Other/notes.md', 60)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — Search starts by Best match: the same name first, then the newer of the names that start with the text, a name that only holds it last; the menu ends with "Show last updated", Type and Time', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await searchPlan('plan')
  await expect(labels(win)).toHaveText(ALL)
  await expect.poll(() => dated(win)).toContain('plan old 1y')
  await sortButton(win).click()
  expect(await menuLabels(win)).toEqual(['Best match✓', 'Name', 'Last updated', 'Show last updated✓', 'TypeAll types', 'TimeAny time'])
  await shoot(win, 'search-sort-01-best-match')
  await win.keyboard.press('Escape')
})

test('step 2 — Name sorts folders first, numbers in number order; Last updated puts the newest first at each level', async () => {
  await pick('Name')
  await expect(labels(win)).toHaveText(['Plans', 'plan 10', 'plan b', 'plan', 'plan new', 'plan old', 'plan scan.pdf', 'Project plan'])
  await pick('Last updated')
  await expect(labels(win)).toHaveText(['Plans', 'plan b', 'plan 10', 'Project plan', 'plan new', 'plan scan.pdf', 'plan', 'plan old'])
  await shoot(win, 'search-sort-02-last-updated')
})

test('step 3 — a note written on disk reads "now" and moves up at once (D2)', async () => {
  await writeFile(path.join(vault, 'plan old.md'), '# plan old\n\nEdited.\n')
  await expect(labels(win)).toHaveText(['Plans', 'plan b', 'plan 10', 'plan old', 'Project plan', 'plan new', 'plan scan.pdf', 'plan'])
  await expect.poll(() => dated(win)).toContain('plan old now')
})

test('step 4 — Type ▸ PDFs keeps the PDF; Notes keeps the notes and their folder; the sort button says a filter is on (D13, D17)', async () => {
  await filter('Type', 'PDFs')
  await expect(labels(win)).toHaveText(['plan scan.pdf'])
  await expect(sortButton(win)).toHaveClass(/sidebar__sort--filtered/)
  await filter('Type', 'Notes')
  await expect(labels(win)).toHaveText(['Plans', 'plan b', 'plan 10', 'plan old', 'Project plan', 'plan new', 'plan'])
  await shoot(win, 'search-sort-04-notes')
})

test('step 5 — Time ▸ Today keeps what changed today; an empty bar resets both filters (D14, D15)', async () => {
  await filter('Time', 'Today')
  await expect(labels(win)).toContainText(['plan old'])
  await expect(labels(win).filter({ hasText: /^plan$/ })).toHaveCount(0)
  await expect(labels(win).filter({ hasText: /^plan 10$/ })).toHaveCount(0)
  await shoot(win, 'search-sort-05-today')
  await searchBar(win).fill('')
  await searchBar(win).fill('plan')
  await expect(labels(win)).toHaveCount(ALL.length)
  await expect(sortButton(win)).not.toHaveClass(/sidebar__sort--filtered/)
})

test('step 6 — "Show last updated" turns the dates off', async () => {
  await pick('Show last updated')
  await expect(win.locator('.sidebar__body .tree__date')).toHaveCount(0)
})

test('step 7 — the sort and the date switches are in the state file and come back after a relaunch; Files keeps its own sort and its own switch, off until picked (D1, D10)', async () => {
  await quitApp(app)
  const { settings } = await readState(userData)
  expect(settings.searchSort).toEqual({ by: 'updated', reverse: false })
  expect(settings.rowDates).toEqual({ files: false, focus: false, favorites: false, search: false })
  expect(settings.sidebarSort.files).toEqual({ by: 'name', reverse: false })
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await searchPlan('Plans')
  await expect(win.locator('.sidebar__body .tree__date')).toHaveCount(0)
  await sortButton(win).click()
  expect(await menuLabels(win)).toEqual(['Best match', 'Name', 'Last updated✓', 'Newest first✓', 'Oldest first', 'Show last updated', 'TypeAll types', 'TimeAny time'])
  await win.keyboard.press('Escape')
  await lensTab(win, 'Files').click()
  await expect(topLabels(win)).toHaveText(['Other', 'Plans', 'plan', 'plan new', 'plan old', 'plan scan.pdf', 'Project plan'])
  await expect(win.locator('.sidebar__body .tree__date')).toHaveCount(0)
  await pick('Show last updated')
  await expect(win.locator('.sidebar__body .tree__row[data-path$="plan new.md"] .tree__date')).toHaveText('5m')
  await shoot(win, 'search-sort-07-files-dates')
})
