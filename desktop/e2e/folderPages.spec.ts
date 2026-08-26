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
 *   4 "New" births a member from the declaration, parks it per the settings, and it comes back —
 *     in the outline's APPENDED section, since the document standing there does not name it
 *   5 the OUTLINE tags a page (YAZ-820, re-aimed in YAZ-904): the `[[` picker writes a LINK LINE,
 *     and that line puts `folder_pages` onto the PICKED page's own file, on disk
 *   6 a member that is itself a folder page: PLAIN TEXT inside the document (no glyph, no count,
 *     no chevron — the locked scoping decision), and glyph + count on its APPENDED row once the
 *     document stops naming it — which a cancelled removal is exactly how to arrange
 *   7 deleting the link line + confirm sheet un-tags it again — dropping ONLY this folder page's
 *     entry and leaving the other two exactly where they were
 *   8 the GROUPED table (YAZ-744, restored here in YAZ-846): a `groupBy` set through the Sort
 *     menu is ONE `folder_page_settings` write, and a collapsed section survives quit → relaunch
 *     in the main-owned `baseGroups` bucket — keyed by the folder page's own `.md` path, never
 *     written into the page's frontmatter
 *
 * TOMBSTONE (YAZ-904, for steps 5–7): the outline's picker-only ADD ROW, the depth-0 DRAG and the
 * nested AUTO-EXPANSION (chevrons, per-row counts inside the outline) died with YAZ-903 — the
 * outline is a document now. Every one of those steps still proves what it set out to prove, on
 * the surface that replaced it; where the premise itself died (nesting expanding IN PLACE) the
 * step says so and asserts the behaviour that took its place.
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `folder-` step
 * screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  bulletAfterLine,
  caretAtEndOfLine,
  clearOutlineLine,
  copyVault,
  launchApp,
  outlineEditor,
  outlineLineIndex,
  outlineLines,
  pickOutlineLink,
  quitApp,
  readState,
  seededState,
  shoot,
} from './helpers'

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
/**
 * The OUTLINE's APPENDED rows (YAZ-903): the members this folder page's document does not NAME,
 * still members, still wearing the glyph / count / hover × the whole outline used to. What the
 * document itself says is `outlineLines` — the editor's own bullets.
 */
const outlineRows = (scope: Locator) => scope.locator('.view-outline__link')
/** One appended row, addressed by the name it shows. */
const outlineRow = (w: Page, name: string) =>
  contents(w).locator('.view-outline__row').filter({ has: w.locator('.view-outline__link', { hasText: new RegExp(`^${name}$`) }) })
/** Every member's name as a LINK LINE, which is how the seed spells the [D5] arrangement. */
const asLinks = (...names: string[]) => names.map((n) => `[[${n}]]`)
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

  // Q7: the folder page's two skins, outline FIRST (YAZ-820). The outline is a DOCUMENT now
  // (YAZ-903) and this page has none stored, so what stands there is the [D5] arrangement frozen
  // into one — a link line per member, alphabetical because no `order` is stored. Every member is
  // named, so nothing is appended below it.
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table'])
  await expect(outlineLines(contents(win))).toHaveText(asLinks(...MEMBERS))
  await expect(outlineRows(contents(win))).toHaveCount(0)
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
  // Which view is active is SESSION state, so the re-opened note is back on Q7's first skin — and
  // the newborn arrives the YAZ-903 way: the DOCUMENT standing in the editor is the one the seed
  // wrote and it does not name Untitled, so Untitled is a member the document does not mention,
  // which is exactly what the appended section below the editor is for.
  await expect(outlineLines(contents(win))).toHaveText(asLinks(...MEMBERS))
  await expect(outlineRows(contents(win))).toHaveText(['Untitled'])
  await shoot(win, 'folder-06-new-member-row')
})

/** The kpi page the outline gestures move around; the migration left it belonging to `[[KPIs]]`. */
const CAC = 'kpis/CAC.md'

test('step 5 — the outline’s `[[` picker tags an existing page, on that page’s own file', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect(outlineLines(contents(win))).toHaveText(asLinks(...MEMBERS))

  // The add row is gone (YAZ-903): the gesture is now typing `[[` in the document itself, which
  // is still picker-only in the sense that mattered — the picker narrows over REAL pages and
  // inserts the link text, and a line that is exactly one resolving link IS the membership.
  await bulletAfterLine(win, contents(win), MEMBERS.length - 1)
  await pickOutlineLink(win, 'CAC', 'folder-07-outline-picker')

  // The write lands on the PICKED page's card — never on the folder page's — and it ADDS: the
  // `[[KPIs]]` entry the migration wrote is still the first thing in the list.
  const cac = path.join(vault, CAC)
  await expect.poll(() => readFile(cac, 'utf8'), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  expect(await readFile(cac, 'utf8')).toContain('[[KPIs]]') // a page belongs to as many topics as it says
  expect(await readFile(cac, 'utf8')).toContain('funnel_stages: ["[[Lead Gen]]"]') // every other key survives
  await expect(outlineLines(contents(win))).toHaveText(asLinks(...MEMBERS, 'CAC'))
  await expect(outlineRows(contents(win))).toHaveText(['Untitled']) // still the only unnamed member
  await shoot(win, 'folder-08-outline-tagged')
})

test('step 6 — a member that is itself a folder page: plain text in the document, glyph and count on its appended row', async () => {
  // TOMBSTONE (YAZ-904): a nested folder page used to EXPAND IN PLACE here, behind a chevron, with
  // its direct-member count on the row. That premise died with rows-are-pages — inside the
  // document a folder page's link is a plain wikilink and nothing more (the locked scoping
  // decision), and the glyph and count live on the APPENDED row instead. Both halves below.

  // The sidebar's own gesture (YAZ-840) makes Lead Gen a folder page; forward never confirms.
  await fileRow(win, 'Lead Gen').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Turn into folder page' }).click()

  // Tag CAC into Lead Gen from LEAD GEN's own outline — CAC now belongs to both. A brand-new
  // folder page holds nobody, so its document is the single empty bullet the seed guarantees.
  await fileRow(win, 'Lead Gen').click()
  await expect(contents(win)).toBeVisible()
  await expect(outlineLines(contents(win))).toHaveText([''])
  await caretAtEndOfLine(win, contents(win), 0)
  await pickOutlineLink(win, 'CAC')
  // The `folder_pages` ENTRY, not just the name: CAC's body and its `funnel_stages` relation both
  // spell `[[Lead Gen]]` already, so a bare `toContain` would pass without a membership at all.
  await expect.poll(() => readFile(path.join(vault, CAC), 'utf8'), { timeout: 10_000 }).toContain('- "[[Lead Gen]]"')

  // Back on Funnel Stages: `[[Lead Gen]]` is a LINE of the document, wearing no glyph, no count
  // and no chevron — the outline holds text, and nothing about a folder page shows through it.
  await fileRow(win, 'Funnel Stages').click()
  await expect(outlineLines(contents(win))).toHaveText(asLinks(...MEMBERS, 'CAC'))
  await expect(outlineEditor(contents(win)).locator('.view-outline__glyph, .view-outline__count')).toHaveCount(0)
  await expect(contents(win).locator('[aria-label="Expand Lead Gen"]')).toHaveCount(0)

  // Stop NAMING it and it becomes an appended row — which is where the glyph and the honest
  // direct-member count (CAC, 1) do live. A cancelled removal is the way to arrange that: the
  // membership is kept (🔒 the YAZ-903 ruling), only the text is gone.
  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), '[[Lead Gen]]'))
  await expect(sheet(win)).toBeVisible()
  await sheetBtn(win, 'Cancel').click()
  await expect(outlineRows(contents(win))).toHaveText(['Lead Gen', 'Untitled'])
  await expect(outlineRow(win, 'Lead Gen').locator('.view-outline__glyph')).toBeVisible()
  await expect(outlineRow(win, 'Lead Gen').locator('.view-outline__count')).toHaveText('1')
  expect(await readFile(path.join(vault, 'funnel-stages', 'Lead Gen.md'), 'utf8')).toContain('[[Funnel Stages]]')
  await shoot(win, 'folder-09-outline-folder-page-member')
})

test('step 7 — deleting the link line + sheet un-tags it, dropping ONLY this folder page’s entry', async () => {
  // The × still exists — step 6 just proved it on Lead Gen's appended row — but a page the
  // document NAMES is dropped by deleting its line, and that opens the very same sheet.
  await expect(outlineRow(win, 'Lead Gen').locator('.view-outline__x')).toHaveCount(1)
  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), '[[CAC]]'))
  // The sheet names the OTHERS in entry order — the migrated `[[KPIs]]` first, then step 6's pick.
  await expect(sheet(win)).toContainText('The page is not deleted — its file stays put. It remains in: KPIs, Lead Gen.')
  await shoot(win, 'folder-10-remove-sheet')
  await sheetBtn(win, 'Remove').click()

  const cac = path.join(vault, CAC)
  await expect.poll(() => readFile(cac, 'utf8'), { timeout: 10_000 }).not.toContain('[[Funnel Stages]]')
  expect(await readFile(cac, 'utf8')).toContain('[[KPIs]]') // the other two belongings are untouched
  expect(await readFile(cac, 'utf8')).toContain('[[Lead Gen]]')
  // Gone from this folder page entirely: not a line, and not an appended row either.
  await expect(outlineRows(contents(win))).toHaveText(['Lead Gen', 'Untitled'])
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
