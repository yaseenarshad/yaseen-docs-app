/**
 * The SEAMS (8C-, YAZ-859): the folder-page wave's promises proved WORKING TOGETHER.
 *
 * Every sibling spec owns one surface — `folderPages.spec.ts` the contents block's gestures,
 * `topics.spec.ts` the sidebar tree and Home's birth, `lenses.spec.ts` the tabs above it,
 * `bible.spec.ts` the encyclopedia's content. What none of them owns is the JOIN: that ONE
 * gesture on one surface lands on disk AND on every other surface reading the same frontmatter,
 * that the two tree-walkers agree inside a loop, that an order dragged in the main pane is the
 * order the sidebar shows after a restart, and that a page_type vault run through the migration
 * opens as a folder-page vault in the real app. Nothing below re-proves a single-surface claim;
 * every step is an every-surface-agrees proof.
 *
 * The arc, in order (serial by design — each step continues the previous state, and the sidebar
 * sits on the TOPICS lens throughout so the tree and the contents block are on screen together):
 *   1 THE FULL CIRCLE — tag a page through the outline's add row, then read the SAME fact off four
 *     places at once: the member's own file on disk, the Topics tree's nesting, the Table tab's
 *     rows, the outline's bullets (and Uncategorized shrinking by one, the fifth)
 *   2 THE LAST REMOVAL — the × on a member whose ONLY parent this is: the sheet says Uncategorized,
 *     and Uncategorized is exactly where the sidebar then puts it, while the table drops the row
 *   3 ORDER SURVIVES RESTART — a drag in the outline is ONE `folder_page_settings` write (not one
 *     member card is touched), and after quit → relaunch the outline AND the Topics tree read the
 *     same 2A order out of the same one place
 *   4 LOOPS ARE SAFE EVERYWHERE — an `A ↔ B` loop hand-written on disk: both walkers descend into
 *     it and terminate, and a page reachable down two branches repeats under both
 *   5 TURN-INTO END TO END — the file tree's context menu makes a folder page, the block appears
 *     under its body, it nests in the tree, it takes a member; turning it BACK drops the member
 *     into Uncategorized and takes the block away, with not one member card rewritten
 *   6 MIGRATION SMOKE — a tiny page_type-era vault, git-committed, run through the REAL
 *     `tools/migrateFolderPages.mjs --apply`, then OPENED IN THE APP: Topics roots on Home, a
 *     folder page browses, a merged `channels:` link shows up as a second parent, zero `page_type`
 *
 * Same harness as the siblings (temp `--user-data-dir`, COPIES of the fixture — the committed
 * encyclopedia is never opened — `cross-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, md5, quitApp, REPO_ROOT, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia, post-migration. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
/** The disk folders the FILE tree is seeded open on — step 5 right-clicks a row inside `kpis/`. */
const FOLDERS = ['funnel-stages', 'inbox', 'industries', 'kpis', 'problems', 'roles']

const HOME = 'Home.md'
const FOLDER_PAGE = 'Funnel Stages.md'
/** Home's members, in the `order` the migration wrote onto its outline view. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']

/** The page step 1 tags in: an `inbox/` orphan, so the gesture also empties a slot in Uncategorized. */
const ORPHAN_IN = 'inbox/Pipeline Review Notes.md'
/** The member step 2 un-tags: `[[Funnel Stages]]` is its ONLY folder page, so it lands in Uncategorized. */
const ONLY_CHILD = 'funnel-stages/Lead Nurture.md'
/** The other orphan — step 5's member, and Uncategorized's constant. */
const ORPHAN_OUT = 'inbox/Positioning Draft.md'
/** The plain page step 5 turns into a folder page and back; the migration left it in `[[KPIs]]`. */
const CAC = 'kpis/CAC.md'

/** THE migration, run as a child process exactly as a human types it (`tools/` own suite's idiom). */
const MIGRATE = path.join(REPO_ROOT, 'tools', 'migrateFolderPages.mjs')

let userData: string
let vault: string
/** Every temp vault this file made, torn down together. */
const vaults: string[] = []
let app: ElectronApplication
let win: Page

// ---------- locators: the sidebar's Topics tree ----------

const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
/** Every row the topic tree renders, in document order. */
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
const topicRow = (w: Page, label: string) =>
  w.locator('.sidebar__body .tree__row').filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const treeChevron = (w: Page, action: 'Expand' | 'Collapse', label: string) =>
  w.locator(`.sidebar__body [aria-label="${action} ${label}"]`)
const uncategorizedRow = (w: Page) => w.locator('.sidebar__body .tree__row--muted')
/** The FILE tree's rows — the other lens, where the folder-page context menu lives. */
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

// ---------- locators: the folder page's contents block ----------

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__link')
const outlineRows = (scope: Locator) => scope.locator('.view-outline__link')
const outlineCounts = (scope: Locator) => scope.locator('.view-outline__count')
/** One outline row by the name it shows — never by `data-outline-row`, whose path is the app's own spelling. */
const outlineRow = (w: Page, name: string) =>
  contents(w).locator('.view-outline__row').filter({ has: w.locator('.view-outline__link', { hasText: new RegExp(`^${name}$`) }) })
const addRow = (scope: Locator) => scope.locator('[aria-label="Link a page"]')
const picks = (scope: Locator) => scope.locator('.view-outline__pick')
const sheet = (w: Page) => w.locator('[role="dialog"]')
const sheetBtn = (w: Page, label: string) => sheet(w).locator('.confirm__btn', { hasText: label })
/** `file.name` is Obsidian's TFile name — extension included. */
const named = (...names: string[]) => names.map((n) => `${n}.md`)
/** The blocks inside the open note's scroller, in order — 🔒 D1's placement, read straight off the DOM. */
const scrollerBlocks = (w: Page) =>
  layer(w)
    .locator('.editor-host')
    .evaluate((host) => Array.from(host.children).map((c) => c.className))

// ---------- helpers ----------

const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')

/**
 * `seededState` pre-selects the FILES lens for the rest of the suite; this spec needs BOTH
 * surfaces at once, so it seeds Topics — with the tree already descended, since which chevrons
 * were clicked is `topics.spec.ts`'s claim and not this file's.
 */
function crossState(vaultPath: string, file: string | null, topicsExpanded: string[]) {
  const state = seededState(vaultPath, file, { expanded: FOLDERS.map((f) => path.join(vaultPath, f)) })
  state.sidebarLens = 'topics'
  state.folders[vaultPath].topicsExpanded = topicsExpanded
  return state
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out.sort()
}

/** Any note still carrying the retired type key — the migration's own post-check, re-asked from outside. */
async function withPageType(root: string): Promise<string[]> {
  const out: string[] = []
  for (const f of (await walk(root)).filter((x) => x.endsWith('.md'))) {
    if (/^page_type:/m.test(await readFile(f, 'utf8'))) out.push(path.relative(root, f))
  }
  return out
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'crosscutting-userdata-'))
  vault = await copyVault(FIXTURE)
  vaults.push(vault)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, ...vaults].map((dir) => rm(dir, { recursive: true, force: true })))
})

// ================================================================ 1. the full circle

test('step 1 — one gesture, four surfaces: the add row writes the member’s card, and the tree, the table and the outline all say so', async () => {
  app = await launchApp({
    userData,
    seedState: crossState(vault, path.join(vault, FOLDER_PAGE), [path.join(vault, HOME), path.join(vault, FOLDER_PAGE)]),
  })
  win = await appWindow(app, 'w1')

  // The starting shape, on BOTH surfaces at once: the sidebar's tree descended two rungs, and the
  // same three members standing in the block below the note's own body.
  await expect(lensTab(win, 'Topics')).toHaveAttribute('aria-selected', 'true')
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Lead Gen',
    'Lead Nurture',
    'Sales-Conversion',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('2') // the two `inbox/` notes
  await expect(contents(win)).toBeVisible()
  await expect(outlineRows(contents(win))).toHaveText(['Lead Gen', 'Lead Nurture', 'Sales-Conversion'])
  await shoot(win, 'cross-01-both-surfaces')

  // THE GESTURE — one pick in the outline's add row, on an `inbox/` orphan. The full name is
  // typed on purpose: a name that answers in the vault is a PICK and never the create row.
  await addRow(contents(win)).fill('Pipeline Review Notes')
  await expect(picks(contents(win))).toHaveText(['Pipeline Review Notes'])
  await picks(contents(win)).first().click()

  // (a) DISK — the write lands on the PICKED page's own card, surgically: the entry is new and the
  //     key it already carried is untouched. Belonging is text a page writes about ITSELF.
  await expect.poll(() => read(ORPHAN_IN), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  expect(await read(ORPHAN_IN)).toContain('captured: 2026-08-14')
  expect(await read(ORPHAN_IN)).toContain('# Pipeline Review Notes')
  // …and the FOLDER PAGE was not touched at all: it maintains no list.
  expect(await read(FOLDER_PAGE)).not.toContain('Pipeline Review Notes')

  // (b) THE OUTLINE — a fourth bullet, in the [D5] fallback order (Funnel Stages declares none).
  await expect(outlineRows(contents(win))).toHaveText(['Lead Gen', 'Lead Nurture', 'Pipeline Review Notes', 'Sales-Conversion'])

  // (c) THE TOPICS TREE — nested under the same folder page, one rung in, with the count moved and
  //     Uncategorized one shorter. The sidebar read the same frontmatter through the same lookup.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Lead Gen',
    'Lead Nurture',
    'Pipeline Review Notes',
    'Sales-Conversion',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await expect(topicRow(win, 'Funnel Stages').locator('.tree__count')).toHaveText('4')
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('1')
  await expect(topicRow(win, 'Pipeline Review Notes')).toHaveCSS('padding-left', '36px') // 8 + depth * 14
  await shoot(win, 'cross-02-tagged-everywhere')

  // (d) THE TABLE — the same four pages, in `pagesIn`'s PATH order rather than the outline's [D5]
  //     order: two skins of one set, ordered by two different rules, and neither is wrong.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(4)
  await expect(rowNames(contents(win))).toHaveText(named('Lead Gen', 'Lead Nurture', 'Sales-Conversion', 'Pipeline Review Notes'))
  await shoot(win, 'cross-03-table-agrees')
})

// ================================================================ 2. the last removal

test('step 2 — the × on a page’s ONLY parent: the sheet promises Uncategorized and the sidebar delivers it', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()

  // `Lead Nurture` belongs to `[[Funnel Stages]]` and nowhere else, so this is the copy's OTHER
  // form — the one that names Uncategorized instead of listing the folder pages left.
  await outlineRow(win, 'Lead Nurture').locator('[aria-label="Remove Lead Nurture from Funnel Stages"]').click()
  await expect(sheet(win)).toContainText(
    "Remove 'Lead Nurture' from 'Funnel Stages'? The page is not deleted — its file stays put. It has no other folder pages, so it moves to Uncategorized.",
  )
  await shoot(win, 'cross-04-last-removal-sheet')
  await sheetBtn(win, 'Remove').click()

  // DISK: the entry goes, the file does not — body and every other key still there.
  await expect.poll(() => read(ONLY_CHILD), { timeout: 10_000 }).not.toContain('[[Funnel Stages]]')
  expect(await read(ONLY_CHILD)).toContain('# Lead Nurture')
  expect(await read(ONLY_CHILD)).toContain('order: 2')

  // THE BLOCK: gone from both skins.
  await expect(outlineRows(contents(win))).toHaveText(['Lead Gen', 'Pipeline Review Notes', 'Sales-Conversion'])
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(rowNames(contents(win))).toHaveText(named('Lead Gen', 'Sales-Conversion', 'Pipeline Review Notes'))
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()

  // THE SIDEBAR: the sheet said Uncategorized, and this is Uncategorized — two orphans again, this
  // time a `funnel-stages/` page beside an `inbox/` one, path-sorted. Nothing was lost anywhere.
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('2')
  await uncategorizedRow(win).click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Lead Gen',
    'Pipeline Review Notes',
    'Sales-Conversion',
    ...TOPICS.slice(1),
    'Uncategorized',
    'Lead Nurture',
    'Positioning Draft',
  ])
  await shoot(win, 'cross-05-uncategorized-caught-it')
  await uncategorizedRow(win).click() // back in place — the label lists below stay readable
})

// ================================================================ 3. order survives restart

test('step 3 — a drag in the outline is ONE settings write, and the Topics tree reads it back after a relaunch', async () => {
  test.setTimeout(60_000)

  // Not one member card may be touched by a reorder: the order is PRESENTATION, and it lives on
  // the folder page. Fingerprint a member before and after.
  const leadGen = path.join(vault, 'funnel-stages', 'Lead Gen.md')
  const before = await md5(leadGen)

  // The last row to the TOP, dropped above `Lead Gen`'s midpoint (TabBar's insertion rule).
  await outlineRow(win, 'Sales-Conversion').dragTo(outlineRow(win, 'Lead Gen'), { targetPosition: { x: 24, y: 2 } })
  await expect(outlineRows(contents(win))).toHaveText(['Sales-Conversion', 'Lead Gen', 'Pipeline Review Notes'])

  // DISK: the new sequence is on the FOLDER PAGE's own card, inside `folder_page_settings` — the
  // one place 2A keeps it — and the member is byte-for-byte what it was.
  await expect.poll(() => read(FOLDER_PAGE), { timeout: 10_000 }).toContain('[[Sales-Conversion]]')
  const card = await read(FOLDER_PAGE)
  expect(card.indexOf('[[Sales-Conversion]]')).toBeLessThan(card.indexOf('[[Lead Gen]]'))
  expect(card.indexOf('[[Lead Gen]]')).toBeLessThan(card.indexOf('[[Pipeline Review Notes]]'))
  expect(await md5(leadGen)).toBe(before)

  // THE SIDEBAR, live: the tree orders each level by ITS OWN folder page's settings, so it is
  // reading the very key the drag just wrote.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Sales-Conversion',
    'Lead Gen',
    'Pipeline Review Notes',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await shoot(win, 'cross-06-dragged-order')

  // AND ACROSS A RESTART: the order is frontmatter (the page's), the expansion is app state
  // (main's) — two different stores, one restored screen.
  await quitApp(app)
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')

  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Sales-Conversion',
    'Lead Gen',
    'Pipeline Review Notes',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the reopened page is back on the first skin.
  await expect(outlineRows(contents(win))).toHaveText(['Sales-Conversion', 'Lead Gen', 'Pipeline Review Notes'])
  await shoot(win, 'cross-07-order-restored')
})

// ================================================================ 4. loops are safe everywhere

test('step 4 — a hand-written A ↔ B loop: both walkers descend into it, terminate, and repeat a two-parent page under both', async () => {
  test.setTimeout(60_000)

  // Written straight onto disk — the honest path for "somebody typed this in another editor". The
  // watcher adopts them with no user action: A belongs to Home AND to B, B belongs to A, and the
  // leaf belongs to both, so it is reachable down two branches.
  await writeFile(path.join(vault, 'Loop B.md'), '---\nfolder_page: true\nfolder_pages:\n  - "[[Loop A]]"\n---\n\n# Loop B\n')
  await writeFile(path.join(vault, 'Loop A.md'), '---\nfolder_page: true\nfolder_pages:\n  - "[[Home]]"\n  - "[[Loop B]]"\n---\n\n# Loop A\n')
  await writeFile(path.join(vault, 'Loop Leaf.md'), '---\nfolder_pages:\n  - "[[Loop A]]"\n  - "[[Loop B]]"\n---\n\n# Loop Leaf\n')

  // THE TOPICS TREE. `Loop A` joins Home's members (unlisted in Home's `order`, so it follows the
  // five curated ones); neither loop page is a ROOT, because each has a parent.
  await expect(topicRow(win, 'Home').locator('.tree__count')).toHaveText('6')
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Sales-Conversion',
    'Lead Gen',
    'Pipeline Review Notes',
    ...TOPICS.slice(1),
    'Loop A',
    'Uncategorized',
  ])

  await treeChevron(win, 'Expand', 'Loop A').click()
  await treeChevron(win, 'Expand', 'Loop B').click()
  // The descent walks Home → A → B and STOPS: A is on B's ancestor path, so that branch ends
  // quietly instead of hanging. `Loop Leaf` renders under BOTH parents — the multi-parent repeat.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Sales-Conversion',
    'Lead Gen',
    'Pipeline Review Notes',
    ...TOPICS.slice(1),
    'Loop A',
    'Loop B',
    'Loop Leaf',
    'Loop Leaf',
    'Uncategorized',
  ])
  // 🔒 D3's honesty split, and the loop is what makes it visible: the COUNT is the page's DIRECT
  // members (`pagesIn` — Loop A and Loop Leaf), while the CHEVRON asked the GUARDED question and
  // opened onto the one member that is not already standing above it.
  await expect(topicRow(win, 'Loop B').locator('.tree__count')).toHaveText('2')
  await expect(topicRow(win, 'Loop A').first().locator('.tree__count')).toHaveText('2')
  await shoot(win, 'cross-08-loop-in-the-tree')

  // THE OUTLINE, from inside the loop. Same guard, same termination, same repeat — the other
  // expansion-driven surface, recursing over the same one primitive.
  await topicRow(win, 'Loop A').click()
  await expect(activeTab(win)).toHaveText('Loop A')
  await expect(outlineRows(contents(win))).toHaveText(['Loop B', 'Loop Leaf'])
  // THE SEAM RULING (YAZ-859, found by this very step): both surfaces count the same way — the
  // honesty split the Topics tree locked. The COUNT is the page's DIRECT members (the honest fact:
  // `Loop B` really holds 2), the CHEVRON asks the guarded question (opening it here shows only 1,
  // the ancestor being skipped). Inside a loop the two deliberately disagree — on BOTH surfaces,
  // identically. Before the ruling the outline counted guarded children and the same page showed
  // different numbers in the sidebar and the outline; no spec outside a loop could tell them apart.
  await expect(outlineCounts(contents(win))).toHaveText(['2'])
  await contents(win).locator('[aria-label="Expand Loop B"]').click()
  await expect(outlineRows(contents(win))).toHaveText(['Loop B', 'Loop Leaf', 'Loop Leaf'])
  await shoot(win, 'cross-09-loop-in-the-outline')

  // And from the OTHER end of the loop, so neither direction is the special case.
  await topicRow(win, 'Loop B').click()
  await expect(activeTab(win)).toHaveText('Loop B')
  await expect(outlineRows(contents(win))).toHaveText(['Loop A', 'Loop Leaf'])
  await expect(outlineCounts(contents(win))).toHaveText(['2'])

  // Tidy the tree back up before step 5 reads it again.
  await treeChevron(win, 'Collapse', 'Loop A').click()
})

// ================================================================ 5. turn-into, end to end

test('step 5 — turn a plain note into a folder page, feed it, and turn it back: the member lands in Uncategorized', async () => {
  test.setTimeout(60_000)

  // The gesture lives in the FILE tree's context menu (the Topics lens has no menu of its own —
  // 🔒 YAZ-847), so the lens row is part of the path. `CAC` is an ordinary page today.
  await lensTab(win, 'Files').click()
  await fileRow(win, 'CAC').click()
  await expect(activeTab(win)).toHaveText('CAC')
  expect(await scrollerBlocks(win)).not.toContain('folder-page-contents')
  await expect(contents(win)).toHaveCount(0)

  await fileRow(win, 'CAC').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Turn into folder page' }).click()

  // ONE frontmatter key, and the block appears BELOW the note's own body — 🔒 D1's third slot,
  // between the Crepe mount and "Linked mentions", with no reload and no reopen.
  await expect.poll(() => read(CAC), { timeout: 10_000 }).toContain('folder_page: true')
  expect(await read(CAC)).toContain('[[KPIs]]') // it still belongs where it belonged
  await expect(contents(win)).toBeVisible()
  expect(await scrollerBlocks(win)).toEqual(['editor-mount', 'folder-page-contents', 'backlinks'])
  await shoot(win, 'cross-10-turned-into')

  // THE SIDEBAR: a folder page NESTED under the topic it belongs to — glyph, count, no chevron
  // yet, because it holds nobody.
  await lensTab(win, 'Topics').click()
  await treeChevron(win, 'Expand', 'KPIs').click()
  await expect(topicRow(win, 'CAC').locator('.tree__glyph')).toBeVisible()
  await expect(topicRow(win, 'CAC').locator('.tree__count')).toHaveText('0')
  await expect(treeChevron(win, 'Expand', 'CAC')).toHaveCount(0)

  // FEED IT — from its own outline, the remaining orphan. The target has NO frontmatter at all,
  // so this write builds the block from nothing.
  await addRow(contents(win)).fill('Positioning Draft')
  await expect(picks(contents(win))).toHaveText(['Positioning Draft'])
  await picks(contents(win)).first().click()
  await expect.poll(() => read(ORPHAN_OUT), { timeout: 10_000 }).toContain('[[CAC]]')
  await expect(outlineRows(contents(win))).toHaveText(['Positioning Draft'])
  await expect(topicRow(win, 'CAC').locator('.tree__count')).toHaveText('1')
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('1') // only Lead Nurture left
  await treeChevron(win, 'Expand', 'CAC').click()
  await expect(topicRow(win, 'Positioning Draft')).toHaveCount(1)
  await shoot(win, 'cross-11-fed-it')

  // TURN IT BACK — the only direction that asks, through its own sheet.
  const memberBefore = await md5(path.join(vault, ORPHAN_OUT))
  await lensTab(win, 'Files').click()
  await fileRow(win, 'CAC').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Turn back into normal page' }).click()
  await expect(sheet(win)).toContainText(
    "Turn 'CAC.md' back into a normal page? Pages that belong to it keep their entries — any that belong nowhere else will appear in Uncategorized until this is a folder page again. Nothing is deleted.",
  )
  await shoot(win, 'cross-12-turn-back-sheet')
  await sheetBtn(win, 'Turn back').click()

  // LOSSLESS BY CONSTRUCTION: one key deleted on ONE page, and the member's card is byte-identical
  // — its `[[CAC]]` entry is still there, simply not counting for anybody while the flag is gone.
  await expect.poll(() => read(CAC), { timeout: 10_000 }).not.toContain('folder_page:')
  expect(await read(ORPHAN_OUT)).toContain('[[CAC]]')
  expect(await md5(path.join(vault, ORPHAN_OUT))).toBe(memberBefore)

  // The block goes with the flag…
  await expect(contents(win)).toHaveCount(0)
  expect(await scrollerBlocks(win)).not.toContain('folder-page-contents')
  // …and the sheet's promise comes true on the other surface: the page it held belongs nowhere
  // else, so Uncategorized has it back — exactly what the copy said would happen.
  await lensTab(win, 'Topics').click()
  await expect(topicRow(win, 'CAC').locator('.tree__glyph')).toHaveCount(0)
  await expect(topicRow(win, 'CAC').locator('.tree__count')).toHaveCount(0)
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('2')
  await uncategorizedRow(win).click()
  await expect(topicRow(win, 'Positioning Draft')).toHaveCount(1)
  await shoot(win, 'cross-13-turned-back')
  await quitApp(app)
})

// ================================================================ 6. migration smoke

/** The page_type era in miniature: two channel pages, two problems that name them, one kpi. */
const PAGE_TYPE_VAULT: Record<string, string> = {
  'Website.md': '---\npage_type: channel\n---\n\n# Website\n\nThe marketing site and everything on it.\n',
  'Newsletter.md': '---\npage_type: channel\n---\n\n# Newsletter\n\nThe weekly send.\n',
  'problems/Signup Flow.md':
    '---\npage_type: problem\nchannels: ["[[Website]]"]\n---\n\n# Signup Flow\n\nToo many steps before anybody sees value.\n',
  'problems/Onboarding Drip.md':
    '---\npage_type: problem\nchannels: ["[[Newsletter]]"]\n---\n\n# Onboarding Drip\n\nNobody owns the sequence after day three.\n',
  'kpis/North Star.md': '---\npage_type: kpi\nunit: percent\n---\n\n# North Star\n\nWeekly active teams.\n',
}

test('step 6 — a page_type vault, migrated by the real script, OPENS as a folder-page vault', async () => {
  test.setTimeout(90_000)

  // Build it and commit it: the migration refuses to run unless it has something to `git checkout`
  // back into (🔒 D1), so the git repo is part of the gesture and not scaffolding around it.
  const legacy = await mkdtemp(path.join(tmpdir(), 'cross-pagetype-'))
  vaults.push(legacy)
  for (const [rel, content] of Object.entries(PAGE_TYPE_VAULT)) {
    const abs = path.join(legacy, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', legacy, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'cross@test.local')
  git('config', 'user.name', 'Cross Cutting Test')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'the page_type era')

  // THE REAL COMMAND, as a human types it. `execFileSync` throws on a non-zero exit, so a failed
  // post-check fails this test — the script's own four checks are the first assertion here.
  const report = execFileSync(process.execPath, [MIGRATE, '--vault', legacy, '--apply'], { encoding: 'utf8', stdio: 'pipe' })
  expect(report).toContain('Folder pages created')
  expect(await withPageType(legacy)).toEqual([])

  // NOW OPEN IT. Nothing was hand-fixed between the script and the app: this is the vault the
  // migration left behind, on the Topics lens.
  app = await launchApp({ userData, seedState: crossState(legacy, null, [path.join(legacy, HOME)]) })
  win = await appWindow(app, 'w1')

  // The roots rule finds the Home the migration made, holding the three folder pages it made out
  // of the three `page_type` values, in the `order` it wrote. `migration-report.md` is a page of
  // the vault now like any other, and belongs nowhere — so Uncategorized is where it waits.
  await expect(topicLabels(win)).toHaveText(['Home', 'Channels', 'KPIs', 'Problems', 'Uncategorized'])
  await expect(topicRow(win, 'Home').locator('.tree__count')).toHaveText('3')
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('1')
  await shoot(win, 'cross-14-migrated-roots')

  // `channel` pages became folder pages of their own, so the tree descends INTO a channel — and
  // `Signup Flow` stands under BOTH `Problems` (from its `page_type`) and `Website` (from the
  // `channels:` list the migration merged into `folder_pages`). One page, two parents, one write.
  await treeChevron(win, 'Expand', 'Channels').click()
  await treeChevron(win, 'Expand', 'Website').click()
  await treeChevron(win, 'Expand', 'Problems').click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Channels',
    'Newsletter',
    'Website',
    'Signup Flow',
    'KPIs',
    'Problems',
    'Onboarding Drip',
    'Signup Flow',
    'Uncategorized',
  ])
  await expect(topicRow(win, 'Channels').locator('.tree__count')).toHaveText('2')
  await expect(topicRow(win, 'Website').locator('.tree__count')).toHaveText('1')
  await shoot(win, 'cross-15-migrated-tree')

  // AND A FOLDER PAGE BROWSES: open one from the tree and its members are below its body, in both
  // skins, with the two channel pages wearing the glyph and their own counts.
  await topicRow(win, 'Channels').click()
  await expect(activeTab(win)).toHaveText('Channels')
  await expect(contents(win)).toBeVisible()
  await expect(outlineRows(contents(win))).toHaveText(['Newsletter', 'Website'])
  await expect(outlineCounts(contents(win))).toHaveText(['1', '1'])
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(named('Newsletter', 'Website'))
  await shoot(win, 'cross-16-migrated-folder-page')

  await quitApp(app)
})
