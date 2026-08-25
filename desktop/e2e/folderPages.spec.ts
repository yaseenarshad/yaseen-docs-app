/**
 * Folder pages, end to end (YAZ-819; 🔒 D1/D2/D3 of YAZ-818): a page flagged `folder_page: true`
 * carries its CONTENTS below its own body — today's fully interactive views table, fed the pages
 * that belong to it, columns from the folder page's own settings.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`),
 * which since 7C- is a MIGRATED vault: every page belongs somewhere, `Funnel Stages` is one of six
 * folder pages hanging off `Home`, and the only pages that belong nowhere are the two `inbox/`
 * notes that were never told about. Nothing below depends on that shape except where it says so —
 * the steps that move `CAC` around now move a page that ALREADY belongs to `[[KPIs]]`, which is
 * what makes the add/remove gestures prove merge-and-drop rather than write-and-wipe.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the block renders INSIDE the note's scroller, between the body and the backlinks, holding
 *     exactly the pages that say they belong here — and the view tabs switch outline ⇄ table
 *   2 a cell edited in the table writes the MEMBER's own file on disk, surgically
 *   3 the narrowed picker: a multi-link column whose target is a folder page offers exactly that
 *     folder page's members — the 🔒 D2 case, resolved over the WHOLE vault while the rows are
 *     only the members
 *   4 "New" births a member from the declaration, parks it per the settings, and it comes back
 *     as a row
 *   5 the OUTLINE tags a page (YAZ-820): the add row's picker writes `folder_pages` onto the
 *     PICKED page's own file, on disk
 *   6 nesting: a member turned into a folder page of its own expands INSIDE this outline
 *   7 the hover × + confirm sheet un-tags it again — dropping ONLY this folder page's entry and
 *     leaving the other two exactly where they were
 *   8 the GROUPED table (YAZ-744, restored here in YAZ-846): a `groupBy` set through the Sort
 *     menu is ONE `folder_page_settings` write, and a collapsed section survives quit → relaunch
 *     in the main-owned `baseGroups` bucket — keyed by the folder page's own `.md` path, never
 *     written into the page's frontmatter
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `folder-` step
 * screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'Funnel Stages.md'
const STAGES = 'funnel-stages'
/** Its members, in the path order `pagesIn` hands them over. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
/** Row names, whichever body renders: the unknown-view placeholder list, or the real table. */
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__link')
/** The OUTLINE's rows (YAZ-820), in render order — nested rows are siblings, so this is the whole tree. */
const outlineRows = (scope: Locator) => scope.locator('.view-outline__link')
const addRow = (scope: Locator) => scope.locator('[aria-label="Link a page"]')
const picks = (scope: Locator) => scope.locator('.view-outline__pick')
const sheet = (w: Page) => w.locator('[role="dialog"]')
const sheetBtn = (w: Page, label: string) => sheet(w).locator('.confirm__btn', { hasText: label })
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/** The grouped table's section headers (4C), in document order. */
const groupNames = (scope: Locator) => scope.locator('.view-table__group .view-group__value')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
/** `file.name` is Obsidian's TFile name — extension included. */
const named = (...names: string[]) => names.map((n) => `${n}.md`)

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'folderpages-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the contents block sits between the note and its backlinks, holding exactly the members', async () => {
  app = await launchApp({
    userData,
    seedState: seededState(vault, path.join(vault, FOLDER_PAGE), { expanded: [path.join(vault, STAGES)] }),
  })
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  // 🔒 D1: the THIRD block in the note's own scroller — it scrolls WITH the note, exactly like
  // the backlinks below it. No chip and no title row: the note itself is the title.
  const children = await layer(win)
    .locator('.editor-host')
    .evaluate((host) => Array.from(host.children).map((c) => c.className))
  expect(children).toEqual(['editor-mount', 'folder-page-contents', 'backlinks'])

  // Q7: the folder page's two skins, outline FIRST (YAZ-820) — rows are PAGES, in the [D5]
  // order, which with no `order` stored is alphabetical by name.
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table'])
  await expect(outlineRows(contents(win))).toHaveText(MEMBERS)
  await shoot(win, 'folder-01-contents-outline')

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(rowNames(contents(win))).toHaveText(named(...MEMBERS))
  // The set IS the lookup, so there is no filter to offer (🔒 Q3) and the views are switch-only.
  await expect(contents(win).locator('[aria-label="Filter"]')).toHaveCount(0)
  await expect(contents(win).locator('[aria-label="Add view"]')).toHaveCount(0)
  await shoot(win, 'folder-02-contents-table')
})

test('step 2 — a cell edited in the block writes the MEMBER’s own file on disk', async () => {
  // Column 1 is `note.order`, typed `number` by the folder page's own declaration (🔒 Q8).
  await cell(contents(win), 0, 1).locator('[data-edit]').click()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await input.fill('9')
  await win.keyboard.press('Enter')

  const leadGen = path.join(vault, STAGES, 'Lead Gen.md')
  await expect.poll(() => readFile(leadGen, 'utf8'), { timeout: 10_000 }).toContain('order: 9')
  const after = await readFile(leadGen, 'utf8')
  expect(after).toContain('folder_pages: ["[[Funnel Stages]]"]') // the belonging is untouched
  expect(after).toContain('# Lead Gen') // and so is the body
  await shoot(win, 'folder-03-cell-write')
})

test('step 3 — the narrowed picker: a multi-link column targeting a folder page offers its members', async () => {
  // Column 2 is `related_stages`, declared `multi-link` with `target: "[[Funnel Stages]]"`. The
  // members are the ROWS here, but the picker resolves that target over the WHOLE vault (🔒 D2)
  // — fed the rows alone it would have found no folder page at all and widened to every page.
  await cell(contents(win), 0, 2).locator('[data-edit]').click()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await input.pressSequentially('[[', { delay: 15 })

  const suggestions = win.locator('[aria-label="Edit related_stages suggestions"] [role="option"]')
  await expect(suggestions).toHaveText(MEMBERS)
  await shoot(win, 'folder-04-narrowed-picker')

  await win.keyboard.press('Escape') // cancel: the picker is what this step proves, not a write
  await expect(input).toHaveCount(0)
})

test('step 4 — "New" births a member from the declaration, parked per the settings, and it comes back as a row', async () => {
  await contents(win).locator('[aria-label="New note"]').click()

  // Parked in the settings' `folder`, born with every declared column empty and the belonging
  // LAST — and an ORDINARY page: the flag is never born here (🔒 Q5).
  const created = path.join(vault, STAGES, 'Untitled.md')
  await expect.poll(() => readFile(created, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  const born = await readFile(created, 'utf8')
  expect(born).toContain('related_stages: []')
  expect(born).not.toContain('folder_page:')
  await expect(activeTab(win)).toHaveText('Untitled')
  await shoot(win, 'folder-05-new-member')

  // …and the folder page adopts it off the watcher, with no user action.
  await fileRow(win, 'Funnel Stages').click()
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the re-opened note is back on Q7's first skin.
  await expect(outlineRows(contents(win))).toHaveText([...MEMBERS, 'Untitled'])
  await shoot(win, 'folder-06-new-member-row')
})

/** The kpi page the outline gestures move around; the migration left it belonging to `[[KPIs]]`. */
const CAC = 'kpis/CAC.md'

test('step 5 — the outline’s add row tags an existing page, on that page’s own file', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect(outlineRows(contents(win))).toHaveText([...MEMBERS, 'Untitled'])

  // PICKER-ONLY (🔒 D4): typing narrows real pages and only a pick commits.
  await addRow(contents(win)).fill('CAC')
  await expect(picks(contents(win))).toHaveText(['CAC'])
  await shoot(win, 'folder-07-outline-picker')
  await picks(contents(win)).first().click()

  // The write lands on the PICKED page's card — never on the folder page's — and it ADDS: the
  // `[[KPIs]]` entry the migration wrote is still the first thing in the list.
  const cac = path.join(vault, CAC)
  await expect.poll(() => readFile(cac, 'utf8'), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  expect(await readFile(cac, 'utf8')).toContain('[[KPIs]]') // a page belongs to as many topics as it says
  expect(await readFile(cac, 'utf8')).toContain('funnel_stages: ["[[Lead Gen]]"]') // every other key survives
  await expect(outlineRows(contents(win))).toHaveText(['CAC', ...MEMBERS, 'Untitled'])
  await shoot(win, 'folder-08-outline-tagged')
})

test('step 6 — a member that is itself a folder page expands inside the outline', async () => {
  // The sidebar's own gesture (YAZ-840) makes Lead Gen a folder page; forward never confirms.
  await fileRow(win, 'Lead Gen').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Turn into folder page' }).click()

  // Tag CAC into Lead Gen from LEAD GEN's own outline — CAC now belongs to both.
  await fileRow(win, 'Lead Gen').click()
  await expect(contents(win)).toBeVisible()
  await addRow(contents(win)).fill('CAC')
  await picks(contents(win)).first().click()
  await expect.poll(() => readFile(path.join(vault, CAC), 'utf8'), { timeout: 10_000 }).toContain('[[Lead Gen]]')

  // Back on Funnel Stages the row wears the glyph and its direct-member count, and its chevron
  // opens the level below IN PLACE — CAC renders under both parents (🔒 D6).
  await fileRow(win, 'Funnel Stages').click()
  await expect(contents(win).locator('.view-outline__count')).toHaveText(['1'])
  await contents(win).locator('[aria-label="Expand Lead Gen"]').click()
  await expect(outlineRows(contents(win))).toHaveText(['CAC', 'Lead Gen', 'CAC', 'Lead Nurture', 'Sales-Conversion', 'Untitled'])
  await shoot(win, 'folder-09-outline-nested')
})

test('step 7 — the × + sheet un-tags it, dropping ONLY this folder page’s entry', async () => {
  // Depth 0 only: the nested CAC under Lead Gen carries no ×, so this locator is unambiguous.
  await contents(win).locator('[aria-label="Remove CAC from Funnel Stages"]').click()
  // The sheet names the OTHERS in entry order — the migrated `[[KPIs]]` first, then step 6's pick.
  await expect(sheet(win)).toContainText('The page is not deleted — its file stays put. It remains in: KPIs, Lead Gen.')
  await shoot(win, 'folder-10-remove-sheet')
  await sheetBtn(win, 'Remove').click()

  const cac = path.join(vault, CAC)
  await expect.poll(() => readFile(cac, 'utf8'), { timeout: 10_000 }).not.toContain('[[Funnel Stages]]')
  expect(await readFile(cac, 'utf8')).toContain('[[KPIs]]') // the other two belongings are untouched
  expect(await readFile(cac, 'utf8')).toContain('[[Lead Gen]]')
  // Gone from depth 0, still standing under Lead Gen, which is where it still belongs.
  await expect(outlineRows(contents(win))).toHaveText(['Lead Gen', 'CAC', 'Lead Nurture', 'Sales-Conversion', 'Untitled'])
  await shoot(win, 'folder-11-outline-untagged')
})

test('step 8 — the grouped table: one groupBy write, and a collapsed section that survives a relaunch', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()

  // `folder_page` is ORDINARY frontmatter to the query engine — the flag MEANS something to
  // `isFolderPage`, and nothing at all to a groupBy. Step 6 turned exactly one of these four
  // members into a folder page, so the run has a real group and the trailing "No value" one.
  // Setting it is ONE `folder_page_settings` write through the one door.
  await contents(win).locator('[aria-label="Sort"]').click()
  await win.locator('.view-popover [aria-label="Group by"]').selectOption('note.folder_page')
  await win.keyboard.press('Escape')

  await expect(groupNames(contents(win))).toHaveText(['true', 'No value'])
  await expect(dataRows(contents(win))).toHaveCount(4)
  const folderPage = path.join(vault, FOLDER_PAGE)
  await expect.poll(() => readFile(folderPage, 'utf8'), { timeout: 10_000 }).toContain('groupBy')
  await shoot(win, 'folder-12-grouped-table')

  // Collapsing keeps the header and drops the rows — and it lands in the MAIN-owned store, keyed
  // by the folder page's own path, never in its frontmatter (4C).
  await contents(win).locator('[aria-label="Toggle group true"]').click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(groupNames(contents(win))).toHaveText(['true', 'No value'])
  await shoot(win, 'folder-13-group-collapsed')

  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  const state = await readState(userData)
  expect(state.folders?.[vault]?.baseGroups).toEqual({ [`${folderPage}::Table`]: ['v:true'] })
  expect(await readFile(folderPage, 'utf8')).not.toContain('baseGroups')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await fileRow(win, 'Funnel Stages').click()
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the reopened page is back on Q7's first skin.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(groupNames(contents(win))).toHaveText(['true', 'No value'])
  await expect(dataRows(contents(win))).toHaveCount(3) // still collapsed
  await shoot(win, 'folder-14-group-collapse-restored')

  await quitApp(app)
})
