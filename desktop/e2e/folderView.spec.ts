/**
 * The folder view, end to end (YAZ-2290; the views themselves are YAZ-819's, 🔒 D1/D2/D3 of
 * YAZ-818): a real FOLDER, opened as a tab, shows today's fully interactive views over the
 * notecards that live directly in it, columns from the folder's own hidden `.folder.md`.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`):
 * five folders of notecards, four of them carrying a `.folder.md`, plus the two loose `inbox/`
 * notes. This file drives `Funnel Stages` — three notecards, two declared columns, and the three
 * views its settings list (Outline, Table, Board).
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 a double click on the folder's row opens it as a tab: title and properties, then the views,
 *     then its comments — and the views hold exactly the notecards IN the folder
 *   2 a cell edited in the table writes the NOTECARD's own file on disk, surgically
 *   3 the narrowed picker: a multi-link column whose target is a folder offers exactly the
 *     notecards in that folder — the 🔒 D2 case, resolved over the WHOLE vault while the rows
 *     are only this folder's
 *   4 "New" births a notecard IN the folder, with no column stamped empty into it, and it is a
 *     row of the folder's views with no user action at all
 *   5 the GROUPED table (YAZ-744, restored here in YAZ-846): a `groupBy` set through the Sort
 *     menu is ONE `folder_page_settings` write, and a collapsed section survives quit → relaunch
 *     in the main-owned `baseGroups` bucket — keyed by the folder's own path, never written into
 *     its settings file
 *
 * TOMBSTONE (YAZ-2290): the folder-page model this file used to drive is gone — a note flagged
 * `folder_page: true`, members joining it through their own `folder_pages`, the outline's link
 * lines tagging and un-tagging pages, adoption, the parking bin and the body migrating into the
 * outline on first open. The steps that proved those (the old 5, 6, 7 and 9) went with them; the
 * outline that survives is a plain document, and `folderOutline.spec.ts` owns it.
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `folder-` step
 * screenshots).
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { activeTab, appWindow, contents, copyVault, launchApp, layer, openFolder, outlineLines, quitApp, readState, seededState, shoot, viewTabs } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER = 'Funnel Stages'
/** The notecards in it, in the path order the index hands them over. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
/** The outline DOCUMENT its settings file ships: plain text, naming none of the notecards. */
const OUTLINE = [
  'Funnel Stages',
  'The stages a deal walks through, from first touch to closed-won. Every notecard in this',
  'folder is one of them — there is no list to maintain.',
]

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const folderPath = () => path.join(vault, FOLDER)
const settingsFile = () => path.join(folderPath(), '.folder.md')

const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
/** Row names, whichever body renders: the unknown-view placeholder list, or the real table — the page TITLE, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__link')
/** `data-cell="row:col"` indexes DATA columns only — the `#` gutter (YAZ-1513) carries none. */
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/** The grouped table's section headers (4C), in document order. */
const groupNames = (scope: Locator) => scope.locator('.view-table__group .view-group__value')

const propertiesOf = async (file: string): Promise<Record<string, unknown>> =>
  parseFrontmatter(splitFrontmatter(await readFile(file, 'utf8')).frontmatter).properties

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'folderview-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the folder opens as a tab: title and properties, the views, its comments — holding exactly its notecards', async () => {
  // No file is seeded open: the folder's own row is the door (YAZ-2290 D3).
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await openFolder(win, folderPath())
  await expect(activeTab(win)).toHaveText(FOLDER)

  // The note editor's own scroller, in a note's order (D9): the header row (the folder's name and
  // its OWN properties panel), the views where a note's body would be, then its comments. No Crepe
  // mount — a folder has no body — and no "Linked mentions" either: nothing links to this folder,
  // and a section with no entries renders nothing at all.
  await expect
    .poll(() =>
      layer(win)
        .locator('.editor-host')
        .evaluate((host) => Array.from(host.children).map((c) => c.className)),
    )
    .toEqual(['page-header', 'folder-view', 'comments'])
  await expect(layer(win).locator('.page-title__text')).toHaveText(FOLDER)

  // The views are EXACTLY what the settings file lists, in its order — and the outline is a plain
  // DOCUMENT (YAZ-2290 D5): the text the settings hold, and not one line for a notecard.
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table', 'Board'])
  await expect(outlineLines(contents(win))).toHaveText(OUTLINE)
  await shoot(win, 'folder-01-view-outline')

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(rowNames(contents(win))).toHaveText(MEMBERS)
  // Per-view filters returned in YAZ-1218 (🔒 Q3 amended): the button is offered — and since 🔒 D0
  // (YAZ-1471) the view tabs are EDITABLE, so the "+" that adds a view is offered beside them too.
  await expect(contents(win).locator('button[aria-label="Filter"]')).toHaveCount(1)
  await expect(contents(win).locator('[aria-label="Add view"]')).toHaveCount(1)
  await shoot(win, 'folder-02-view-table')
})

test('step 2 — a cell edited in the table writes the NOTECARD’s own file on disk', async () => {
  // Column 1 is `note.order`, typed `number` by the folder's own declaration (🔒 Q8). The CELL
  // owns mouse activation since YAZ-1030 (its display button is `pointer-events: none`), so the
  // door in is a deliberate double-click.
  await cell(contents(win), 0, 1).dblclick()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await input.fill('9')
  await win.keyboard.press('Enter')

  const leadGen = path.join(folderPath(), 'Lead Gen.md')
  await expect.poll(() => readFile(leadGen, 'utf8'), { timeout: 10_000 }).toContain('order: 9')
  // Surgical: the one key, and nothing stamped beside it — `related_stages` is a declared column
  // this notecard holds no value for, and it stays an empty cell rather than an empty key (E1).
  expect(await propertiesOf(leadGen)).toEqual({ order: 9 })
  expect(await readFile(leadGen, 'utf8')).toContain('# Lead Gen') // and the body is untouched
  await shoot(win, 'folder-03-cell-write')
})

test('step 3 — the narrowed picker: a multi-link column targeting a folder offers the notecards in it', async () => {
  // Column 2 is `related_stages`, declared `multi-link` with `target: "[[Funnel Stages]]"`. No
  // notecard has that name, so the link is the FOLDER's (YAZ-2290 D10) and the picker narrows to
  // the notecards in it — resolved over the WHOLE vault (🔒 D2), never over the rows alone.
  await cell(contents(win), 0, 2).dblclick()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await input.pressSequentially('[[', { delay: 15 })

  const suggestions = win.locator('[aria-label="Edit related_stages suggestions"] [role="option"]')
  await expect(suggestions).toHaveText(MEMBERS)
  await shoot(win, 'folder-04-narrowed-picker')

  await win.keyboard.press('Escape') // cancel: the picker is what this step proves, not a write
  await expect(input).toHaveCount(0)
})

test('step 4 — "New" births a notecard IN the folder, no column stamped empty, and it is a row at once', async () => {
  await contents(win).locator('[aria-label="New note"]').click()

  // Born in the folder being viewed (D4), from its template and the view's seed alone (E1/E3).
  // This folder has no `.template.md` and the view no filter, so the newborn holds nothing but
  // the permanent `id` every created note is given — neither declared column is in it.
  const created = path.join(folderPath(), 'Untitled.md')
  await expect.poll(async () => Object.keys(await propertiesOf(created).catch(() => ({}))), { timeout: 10_000 }).toEqual(['id'])
  const born = await readFile(created, 'utf8')
  expect(born).not.toContain('order')
  expect(born).not.toContain('related_stages')
  await expect(activeTab(win)).toHaveText('Untitled')
  await shoot(win, 'folder-05-new-notecard')

  // …and the folder holds it, with nobody typing a thing: its rows ARE the notecards in it.
  await openFolder(win, folderPath())
  await expect(activeTab(win)).toHaveText(FOLDER)
  // Which view is active is SESSION state, so the re-opened folder is back on its first view —
  // and the outline says exactly what it said: a new notecard writes no line into a document.
  await expect(outlineLines(contents(win))).toHaveText(OUTLINE)
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText([...MEMBERS, 'Untitled'])
  await shoot(win, 'folder-06-new-notecard-row')
})

test('step 5 — the grouped table: one groupBy write, and a collapsed section that survives a relaunch', async () => {
  // `order` is the folder's own number column: step 2 made `Lead Gen` a 9, the other two shipped
  // as 2 and 3, and step 4's newborn has none — so the run has three real groups and the trailing
  // "No value" one. Setting it is ONE `folder_page_settings` write through the one door. "Group
  // by" is the shared `ColumnPicker` (YAZ-1466): a button opening a searchable listbox, each
  // option keyed by `data-value`; choosing one closes the list, and Esc then closes the Sort menu.
  await contents(win).locator('[aria-label="Sort"]').click()
  await win.locator('.view-popover [aria-label="Group by"]').click()
  await win.locator('.view-popover [role="option"][data-value="note.order"]').click()
  await win.keyboard.press('Escape')

  await expect(groupNames(contents(win))).toHaveText(['2', '3', '9', 'No value'])
  await expect(dataRows(contents(win))).toHaveCount(4)
  await expect.poll(() => readFile(settingsFile(), 'utf8'), { timeout: 10_000 }).toContain('groupBy')
  await shoot(win, 'folder-07-grouped-table')

  // Collapsing keeps the header and drops the rows — and it lands in the MAIN-owned store, keyed
  // by the folder's own path, never in its settings file (4C).
  await contents(win).locator('[aria-label="Toggle group 9"]').click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(groupNames(contents(win))).toHaveText(['2', '3', '9', 'No value'])
  await shoot(win, 'folder-08-group-collapsed')

  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  const state = await readState(userData)
  expect(state.folders?.[vault]?.baseGroups).toEqual({ [`${folderPath()}::Table`]: ['v:9'] })
  expect(await readFile(settingsFile(), 'utf8')).not.toContain('baseGroups')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  // The folder's tab is restored like any other: its path is the tab's identity (D3).
  await expect(activeTab(win)).toHaveText(FOLDER)
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the restored folder is back on its first view.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(groupNames(contents(win))).toHaveText(['2', '3', '9', 'No value'])
  await expect(dataRows(contents(win))).toHaveCount(3) // still collapsed
  await shoot(win, 'folder-09-group-collapse-restored')

  await quitApp(app)
})
