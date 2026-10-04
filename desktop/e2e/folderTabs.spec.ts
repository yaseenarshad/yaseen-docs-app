/**
 * A FOLDER IS A TAB, end to end (YAZ-2290): real folders are the pages. What only the real app can
 * show is the whole arc from a row in the Files tree to a file on disk — and, just as much, the
 * files that are NOT written along the way.
 *
 * The folder is `Projects` in the generated fixture vault: one note of its own (`Roadmap`), one
 * subfolder (`archive`, with a note that is NOT a row here), and no `.folder.md` — so it starts
 * on the defaults, and every byte this spec finds in it afterwards was put there by a gesture below.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 a single click on the folder's row FOLDS it and opens nothing; a double click opens the
 *     folder as a tab named after it — and the row shows the count of the notes in it
 *   2 a folder with no `.folder.md` shows the default views (Table, then Board) and the default
 *     Status column over the notes directly in it — and opening it left no `.folder.md` on
 *     disk and no byte of its note changed
 *   3 the FIRST view change creates `.folder.md`, stating the defaults it had been showing
 *   4 "New" births the note IN the folder with no empty Status key in its frontmatter, and
 *     the row's count follows
 *   5 renaming through the title renames the folder on disk, and the tab follows it
 *
 * Same harness as tabs.spec.ts (temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `foldertab-` step screenshots).
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import {
  activeTab,
  appWindow,
  buildFixtureVault,
  confirmSheet,
  contents,
  copyVault,
  dirCount,
  dirRow,
  editorOf,
  fileRow,
  launchApp,
  layer,
  md5,
  openFolder,
  quitApp,
  SEED_BODY,
  SEED_FILE,
  seededState,
  shoot,
  tabsOf,
  viewTabs,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const FOLDER = 'Projects'
const RENAMED = 'Work'
/** The one note that lives directly in the folder (helpers.buildFixtureVault). */
const NOTE = 'Roadmap'
/** The default column's options, in the order a folder with no settings shows them (`DEFAULT_COLUMNS`, client/src/views/folderSettings.ts). */
const STATUS_OPTIONS = ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done']

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const folderPath = () => path.join(vault, FOLDER)
const settingsFile = (dir = folderPath()) => path.join(dir, '.folder.md')
const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

/** The folder row's tree item: `aria-expanded` is the LI's, not the button's (client/src/sidebar/Tree.tsx). */
const folderItem = (w: Page) => w.locator(`li[role="treeitem"]:has(> .tree__row--dir[data-path="${folderPath()}"])`)
/** Block ZERO of the folder's tab: its name, and the input a click swaps in (PageTitle.tsx). */
const title = (w: Page) => layer(w).locator('.page-title__text')
const titleInput = (w: Page) => layer(w).locator('.page-title__input')
const headers = (scope: Locator) => scope.locator('.view-table thead th')
/** The name cell shows the page TITLE — the basename, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-table__link')
const groupNames = (scope: Locator) => scope.locator('.view-table__group .view-group__value')

interface OnDiskSettings {
  columns?: Record<string, { kind?: string; options?: string[] }>
  views?: { type?: string; name?: string; groupBy?: unknown }[]
}

/** The folder's `folder_page_settings` AS WRITTEN — parsed, never string-matched; null while there is no file. */
async function settingsOnDisk(dir = folderPath()): Promise<OnDiskSettings | null> {
  const text = await readFile(settingsFile(dir), 'utf8').catch(() => null)
  if (text === null) return null
  return (parseFrontmatter(splitFrontmatter(text).frontmatter).properties.folder_page_settings ?? {}) as OnDiskSettings
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'foldertab-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a single click folds the folder and opens nothing; a double click opens it as a tab named after it', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(SEED_BODY)
  await expect(tabsOf(win)).toHaveText(['Welcome note'])
  // The row counts the notes DIRECTLY in the folder (🔒 E6): `Roadmap`, and not the one in `archive`.
  await expect(dirCount(win, FOLDER)).toHaveText('1')

  // ONE click unfolds the row — and that is all it does: the tab strip and the open note stay put.
  await dirRow(win, FOLDER).click()
  await expect(folderItem(win)).toHaveAttribute('aria-expanded', 'true')
  await expect(fileRow(win, NOTE)).toBeVisible()
  await expect(tabsOf(win)).toHaveText(['Welcome note'])
  await expect(editorOf(win)).toContainText(SEED_BODY)
  await expect(contents(win)).toHaveCount(0)
  // …and one more folds it again, still opening nothing.
  await dirRow(win, FOLDER).click()
  await expect(folderItem(win)).toHaveAttribute('aria-expanded', 'false')
  await expect(tabsOf(win)).toHaveText(['Welcome note'])
  await shoot(win, 'foldertab-01-single-click-folds')

  // A DOUBLE click opens the folder itself, in the current tab, under its own name (D3).
  await dirRow(win, FOLDER).dblclick()
  await expect(tabsOf(win)).toHaveText([FOLDER])
  await expect(activeTab(win)).toHaveText(FOLDER)
  await expect(contents(win)).toBeVisible()
  await expect(title(win)).toHaveText(FOLDER)
  // The folder is the active page, so its row is the active row.
  await expect(dirRow(win, FOLDER)).toHaveClass(/tree__row--active/)
  await shoot(win, 'foldertab-02-double-click-opens')
})

test('step 2 — a folder with no `.folder.md` shows Table and Board over its own notes, and opening it wrote nothing', async () => {
  // The defaults (D5a, E2): Table then Board, and ONE column of the folder's own — Status.
  await expect(viewTabs(contents(win))).toHaveText(['Table', 'Board'])
  await expect(headers(contents(win))).toHaveText(['#', 'Name', 'Status'])
  // Its rows are the notes that live DIRECTLY in it (D4): `archive/Old plan` is not one.
  await expect(rowNames(contents(win))).toHaveText([NOTE])
  await shoot(win, 'foldertab-03-default-views')

  // Opening a folder writes NOTHING: no settings file was made for the defaults it is showing,
  // and its note is byte for byte the one the fixture generated — no Status key stamped in.
  expect(await exists(settingsFile())).toBe(false)
  expect(await md5(path.join(folderPath(), `${NOTE}.md`))).toBe(await md5(path.join(vaultSrc, FOLDER, `${NOTE}.md`)))
})

test('step 3 — the first view change creates `.folder.md`, stating the defaults it had been showing', async () => {
  // Grouping the Table is a view change like any other: ONE `folder_page_settings` write — and
  // for this folder the first, so it is the one that creates the file (D1). "Group by" is the
  // shared `ColumnPicker`: a button opening a listbox, each option keyed by `data-value`.
  await contents(win).locator('[aria-label="Sort"]').click()
  await win.locator('.view-popover [aria-label="Group by"]').click()
  await win.locator('.view-popover [role="option"][data-value="note.status"]').click()
  await win.keyboard.press('Escape')
  // The one note has no status, so the grouped table is the single trailing "No value" group.
  await expect(groupNames(contents(win))).toHaveText(['No value'])

  await expect.poll(async () => (await settingsOnDisk())?.views?.[0]?.groupBy !== undefined, { timeout: 10_000 }).toBe(true)
  const settings = await settingsOnDisk()
  // The views it had been showing, in their order, with the change on the one it was made to…
  expect(settings?.views?.map((v) => `${v.type}:${v.name}`)).toEqual(['table:Table', 'board:Board'])
  expect(settings?.views?.[1]?.groupBy).toBeUndefined()
  // …and the default column, now STATED: once a folder has saved settings, they say which columns it has (E2).
  expect(settings?.columns).toEqual({ status: { kind: 'select', options: STATUS_OPTIONS } })
  await shoot(win, 'foldertab-04-first-change-writes-settings')
})

test('step 4 — "New" births the note in the folder with no empty Status key, and the row counts it', async () => {
  await contents(win).locator('[aria-label="New note"]').click()

  // Born IN the folder being viewed (D4) — and although Status is a column of this folder, it is
  // NOT stamped into the newborn (E1): the file holds its permanent `id` and nothing else.
  const created = path.join(folderPath(), 'Untitled.md')
  const keys = async (): Promise<string[]> =>
    Object.keys(parseFrontmatter(splitFrontmatter(await readFile(created, 'utf8').catch(() => '')).frontmatter).properties)
  await expect.poll(keys, { timeout: 10_000 }).toEqual(['id'])
  expect(await readFile(created, 'utf8')).not.toContain('status')
  // The create opens the new note in the current tab, as a row link would.
  await expect(activeTab(win)).toHaveText('Untitled')
  // The folder's row follows the index: two notes live in it now.
  await expect(dirCount(win, FOLDER)).toHaveText('2')
  await shoot(win, 'foldertab-05-new-note')
})

test('step 5 — renaming through the title renames the folder on disk, and the tab follows', async () => {
  // Step 4's newborn took the tab, so the folder is opened again by its row.
  await openFolder(win, folderPath())
  await expect(title(win)).toHaveText(FOLDER)

  // The title IS the folder's name, and committing a new one is a rename through App's one door —
  // which asks first, with the honest count: no note links to this folder.
  await title(win).click()
  await expect(titleInput(win)).toHaveValue(FOLDER)
  await titleInput(win).fill(RENAMED)
  await win.keyboard.press('Enter')
  await expect(confirmSheet(win).locator('.confirm__text')).toHaveText(`Rename '${FOLDER}' to '${RENAMED}'? No other notes link to it.`)
  await shoot(win, 'foldertab-06-rename-sheet')
  await confirmSheet(win).locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect(confirmSheet(win)).toHaveCount(0)

  // Disk: the directory moved whole — its notes, its subfolder and its settings file with it —
  // and nothing remains at the old path.
  const renamed = path.join(vault, RENAMED)
  await expect.poll(() => exists(path.join(renamed, `${NOTE}.md`))).toBe(true)
  expect(await exists(path.join(renamed, 'Untitled.md'))).toBe(true)
  expect(await exists(path.join(renamed, 'archive', 'Old plan.md'))).toBe(true)
  expect((await settingsOnDisk(renamed))?.views?.map((v) => v.name)).toEqual(['Table', 'Board'])
  expect(await exists(folderPath())).toBe(false)

  // The tab follows in place: the same tab, under the new name, still showing the folder's views
  // over the same two notes — and so do the title and the row, count and all.
  await expect(tabsOf(win)).toHaveText([RENAMED])
  await expect(activeTab(win)).toHaveText(RENAMED)
  await expect(title(win)).toHaveText(RENAMED)
  await expect(contents(win)).toBeVisible()
  await expect(rowNames(contents(win))).toHaveText([NOTE, 'Untitled'])
  await expect(dirRow(win, RENAMED)).toBeVisible()
  await expect(dirRow(win, FOLDER)).toHaveCount(0)
  await expect(dirCount(win, RENAMED)).toHaveText('2')
  await shoot(win, 'foldertab-07-renamed')
  await quitApp(app)
})
