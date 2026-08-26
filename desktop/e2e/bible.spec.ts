/**
 * Bible C (GRO-2203, re-pointed at the folder-page model in 7C-): the convergence proof — one
 * committed encyclopedia driven through the REAL app, with the index, the wiki-link graph and the
 * folder pages all answering the same questions about it.
 *
 * The fixture (`fixtures/bible-vault/`) is a MIGRATED vault: `tools/migrateFolderPages.mjs` ran
 * over the `page_type` encyclopedia this file used to open, turned its five type values into five
 * folder pages, gave them a `Home` to hang from and deleted the registry. Every page now says in
 * its OWN frontmatter which topics it belongs to — except the two `inbox/` notes, which are
 * deliberately Uncategorized. Nothing carries `page_type` any more, and step 1 proves it.
 *
 * WHAT THIS SPEC IS FOR, now that the wave has three siblings: `folderPages.spec.ts` drives the
 * contents block's own gestures (cells, pickers, New, tag/untag, nesting, grouping),
 * `topics.spec.ts` drives the sidebar tree and Home's birth, `lenses.spec.ts` the tabs above them.
 * What is left here — and lives nowhere else — is the CONTENT: that the index reads this vault
 * correctly, that its links and backlinks agree with its relations, and that a rename leaves both
 * the graph and the belongings standing.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1  the migrated vault is sound: zero `page_type` keys, zero broken links, and Home holds
 *      exactly the five folder pages in the `order` the migration wrote
 *   2  a cell the MIGRATION declared, edited inline on `KPIs` — a surgical write into a card the
 *      migration itself rewrote, leaving its membership and body byte-for-byte
 *   3  wiki-link navigation: click → current tab, ⌘-click → background tab (the LOCKED model)
 *   4  the backlinks panel finds every note that names a KPI, and the ones that BELONG TO
 *      `[[Problems]]` are exactly the two problems whose relations point at it
 *   5  rename an entity page — relations, body links, backlinks AND its belonging all survive,
 *      still zero broken links
 *   6  rename a FOLDER PAGE (YAZ-864) — the links that live INSIDE `folder_page_settings` follow
 *      too: Home's outline `order` entry and another folder page's column `target`, alongside the
 *      members' own `folder_pages`. Still zero broken links, and the map still browses.
 *
 * Same harness as links.spec.ts / backlinks.spec.ts (temp `--user-data-dir`, a COPY of the
 * fixture, `bible-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia, post-migration. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDERS = ['funnel-stages', 'inbox', 'industries', 'kpis', 'problems', 'roles']

const HOME = 'Home.md'
/** Home's members, in the `order` the migration wrote onto its outline view. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
/** Their direct-member counts, in the same order — the shape of the whole migrated map. */
const TOPIC_COUNTS = ['3', '2', '5', '4', '3']

/** The folder page step 2 edits through, and the member it writes to (row 1 in path order). */
const KPIS = 'KPIs'
const GROSS_MARGIN = path.join('kpis', 'Gross Margin.md')
/** Its `kpi_category` today, and what step 2 makes it — the page's own body argues for the change. */
const CATEGORY_WAS = 'lagging'
const CATEGORY_NOW = 'fundamental'

/** Every page that belongs to `[[Problems]]` — the fixture's own answer to "which mentions are problems?". */
const PROBLEMS = ['CRM Hygiene', 'Lead Quality Scoring', 'Nurture Sequencing', 'Stage Accuracy']
/** The KPIs, alphabetically — the [D5] fallback, since `KPIs.md` declares no outline `order`. */
const KPI_MEMBERS = ['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Win Rate']

const FUNNEL = path.join('funnel-stages', 'Sales-Conversion.md')
const RENAMED = 'Deal Win Rate'

/**
 * Step 6 (YAZ-864): the folder page whose name is spelled in three OTHER frontmatter places than a
 * `folder_pages` list — Home's outline `order`, `Problems.md`'s `sold_to` column `target`, and its
 * own `reports_to` target — all of them NESTED inside `folder_page_settings`, where the index never
 * looked for links. Renamed to a name that sorts FIRST alphabetically, so a stale order entry
 * (silently ignored, then alphabetical) could not pass for a rewritten one.
 */
const ROLES = 'Roles'
const ROLES_RENAMED = 'Buyer Roles'
/** Its members, alphabetically — `Roles.md` declares no outline `order`, so [D5] falls back. */
const ROLE_MEMBERS = ['CEO', 'Head of Sales', 'RevOps Lead']
const TOPICS_AFTER = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', ROLES_RENAMED]

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
const linkIn = (w: Page, text: string) => editorOf(w).locator('.wikilink', { hasText: text }).first()
const backlinksHeader = (w: Page) => layer(w).locator('.backlinks__header')
const backlinkNotes = (w: Page) => layer(w).locator('.backlinks__note')
/** The section is collapsed by default (locked) but survives a remount expanded — so check first. */
const expandBacklinks = async (w: Page): Promise<void> => {
  if ((await backlinksHeader(w).getAttribute('aria-expanded')) === 'false') await backlinksHeader(w).click()
  await expect(backlinksHeader(w)).toHaveAttribute('aria-expanded', 'true')
}

/** The folder page's contents block, and the rows/cells of whichever view it is showing. */
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
const outlineRows = (scope: Locator) => scope.locator('.view-outline__link')
const outlineCounts = (scope: Locator) => scope.locator('.view-outline__count')
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__link')
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/**
 * What the name column shows. The clickable title cell is keyed to `file.name` (TableView's
 * `nameCol`), and `file.name` is Obsidian's TFile name — extension included.
 */
const named = (...names: string[]) => names.map((n) => `${n}.md`)

const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

// ---------- whole-vault audits ----------

/** Fenced and inline code can't carry links — same discipline as the index's `stripCode`. */
const maskCode = (text: string) => text.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '')
const WIKILINK = /!?\[\[([^[\]]+)\]\]/g
/** `[[Target|alias]]` / `[[Target#heading]]` → `Target`. */
const targetOf = (inner: string) => inner.split('|')[0].split('#')[0].trim()

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

/**
 * Every wiki link in every note — frontmatter relation values and folder-page settings as much as
 * body prose and `![[…]]` embeds — whose target names no file in the vault, by basename or by
 * root-relative path, with or without extension. The durable result GRO-2203 asks for is that this
 * is `[]` both before and after the rename.
 */
async function brokenLinks(root: string): Promise<string[]> {
  const files = await walk(root)
  const known = new Set<string>()
  for (const f of files) {
    const rel = path.relative(root, f)
    known.add(path.basename(f))
    known.add(path.basename(f, path.extname(f)))
    known.add(rel)
    known.add(rel.slice(0, rel.length - path.extname(rel).length))
  }
  const broken: string[] = []
  for (const f of files.filter((x) => x.endsWith('.md'))) {
    for (const m of maskCode(await readFile(f, 'utf8')).matchAll(WIKILINK)) {
      const t = targetOf(m[1])
      if (!known.has(t)) broken.push(`${path.relative(root, f)} → [[${t}]]`)
    }
  }
  return broken
}

/** Any note still carrying the retired type key. The migration's own post-check, re-asked here. */
async function withPageType(root: string): Promise<string[]> {
  const out: string[] = []
  for (const f of (await walk(root)).filter((x) => x.endsWith('.md'))) {
    if (/^page_type:/m.test(await readFile(f, 'utf8'))) out.push(path.relative(root, f))
  }
  return out
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'bible-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------- the scenario ----------

test('step 1 — the migrated encyclopedia opens on Home, holding exactly its topics, with nothing left over', async () => {
  // The fixture itself is sound before anything runs: the migration took every `page_type` with it
  // and left not one dangling wiki link behind — settings targets and `folder_pages` entries included.
  expect(await withPageType(vault)).toEqual([])
  expect(await brokenLinks(vault)).toEqual([])

  app = await launchApp({
    userData,
    seedState: seededState(vault, path.join(vault, HOME), { expanded: FOLDERS.map((f) => path.join(vault, f)) }),
  })
  win = await appWindow(app, 'w1')

  // The map of an encyclopedia that maintains no list: the five folder pages say in their OWN
  // frontmatter that they belong to Home, and Home's `order` is the only thing deciding the sequence
  // (alphabetically, Funnel Stages would still lead — but KPIs would not sit third).
  await expect(contents(win)).toBeVisible()
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table'])
  await expect(outlineRows(contents(win))).toHaveText(TOPICS)
  // A count per row, because every one of Home's members is itself a folder page: the whole
  // migrated vault — 17 pages filed under five topics — in one assertion.
  await expect(outlineCounts(contents(win))).toHaveText(TOPIC_COUNTS)

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(TOPICS.length)
  await expect(rowNames(contents(win))).toHaveText(named(...TOPICS))
  await shoot(win, 'bible-01-home-topics')
})

test('step 2 — a MIGRATED column, edited inline: written to the member’s own file, surgically', async () => {
  await fileRow(win, KPIS).click()
  await expect(activeTab(win)).toHaveText(KPIS)
  await expect(outlineRows(contents(win))).toHaveText(KPI_MEMBERS)
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()

  // Column 1 is `kpi_category`, declared `text` by `KPIs.md` — a column the MIGRATION wrote, out
  // of the `types.json` the same run deleted. Row 1 is Gross Margin, whose own body argues it is
  // not a funnel lagging indicator at all.
  await cell(contents(win), 1, 1).locator('[data-edit]').click()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue(CATEGORY_WAS)
  await shoot(win, 'bible-02-migrated-cell-edit')
  await input.fill(CATEGORY_NOW)
  await win.keyboard.press('Enter')

  // The write lands in the MEMBER's frontmatter, surgically — every other key the migration left
  // there, its belonging and the whole body survive.
  const grossMargin = path.join(vault, GROSS_MARGIN)
  await expect.poll(() => readFile(grossMargin, 'utf8'), { timeout: 10_000 }).toContain(`kpi_category: ${CATEGORY_NOW}`)
  const after = await readFile(grossMargin, 'utf8')
  expect(after).toContain('unit: percent')
  expect(after).toContain('[[KPIs]]') // the belonging is untouched
  expect(after).toContain('# Gross Margin')
  expect(after).not.toContain('page_type')
  await shoot(win, 'bible-02b-migrated-cell-written')
})

test('step 3 — navigating the encyclopedia: click → current tab, ⌘-click → background tab', async () => {
  await fileRow(win, 'Sales-Conversion').click()
  await expect(activeTab(win)).toHaveText('Sales-Conversion')
  await expect(editorOf(win)).toContainText('Open pipeline through to closed-won')
  await expect(tabsOf(win)).toHaveCount(1)

  await linkIn(win, 'CRM Hygiene').click()
  await expect(activeTab(win)).toHaveText('CRM Hygiene')
  await expect(editorOf(win)).toContainText('The parent SKU')
  await expect(tabsOf(win)).toHaveCount(1) // the funnel page's slot, not a new tab

  await fileRow(win, 'Sales-Conversion').click()
  await expect(editorOf(win)).toContainText('Open pipeline through to closed-won')
  await linkIn(win, 'Win Rate').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Sales-Conversion', 'Win Rate'])
  await expect(activeTab(win)).toHaveText('Sales-Conversion') // background: activation never moves
  await shoot(win, 'bible-03-wikilink-navigation')
})

test('step 4 — the backlinks panel finds the whole mention set, problems included', async () => {
  // Who the problems ARE is the folder page's own answer, not this file's: the four pages that
  // say they belong to `[[Problems]]`, read straight off the block.
  await fileRow(win, 'Problems').click()
  await expect(outlineRows(contents(win))).toHaveText(PROBLEMS)

  await tabsOf(win).filter({ hasText: 'Win Rate' }).click()
  await expect(activeTab(win)).toHaveText('Win Rate')
  await expect(editorOf(win)).toContainText('Closed-won as a share of closed pipeline')

  // Four notes mention Win Rate: the two problems that name it ONLY in their `kpis_impacted`
  // relation property — frontmatter links are first-class to the index — plus the funnel page
  // and the owning role, via body prose. Path-sorted.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // Convergence: the mentions that BELONG TO `[[Problems]]` are exactly the two problems whose
  // relations point at this KPI — prose, relations and belonging answering the same question.
  const mentions = await backlinkNotes(win).allTextContents()
  expect(mentions.filter((n) => PROBLEMS.includes(n)).sort()).toEqual(['CRM Hygiene', 'Stage Accuracy'])
  await shoot(win, 'bible-04-backlinks-agree')
})

test('step 5 — renaming an entity page: relations, body links, backlinks and its belonging survive', async () => {
  await fileRow(win, 'Win Rate').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(win.locator('.create-inline__input')).toHaveValue('Win Rate')
  await win.locator('.create-inline__input').fill(RENAMED)
  await win.keyboard.press('Enter')

  // Four referencing notes: two through frontmatter relations, two through body prose.
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 4 notes')
  await expect(activeTab(win)).toHaveText(RENAMED)

  const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')
  const crmHygiene = path.join('problems', 'CRM Hygiene.md')
  // relation properties (whole-value links inside a list) …
  await expect.poll(() => read(crmHygiene)).toContain(`[[${RENAMED}]]`)
  expect(await read(crmHygiene)).toContain('[[Sales Cycle Time]]') // the sibling relation is untouched
  await expect.poll(() => read(path.join('problems', 'Stage Accuracy.md'))).toContain(`[[${RENAMED}]]`)
  // … and body links, including a note that was never opened in this run.
  await expect.poll(() => read(path.join('roles', 'Head of Sales.md'))).toContain(`[[${RENAMED}]]`)
  await expect.poll(() => read(FUNNEL)).toContain(`[[${RENAMED}]]`)

  // The backlinks panel still finds the same four notes on the renamed page.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // And it still belongs where it belonged: the entry lives on the MEMBER and names the topic, so
  // renaming the member is nothing the topic has to be told about.
  await fileRow(win, RENAMED).click()
  expect(await read(path.join('kpis', `${RENAMED}.md`))).toContain('[[KPIs]]')
  await fileRow(win, KPIS).click()
  await expect(outlineRows(contents(win))).toHaveText(['CAC', RENAMED, 'Gross Margin', 'MQL Volume', 'Sales Cycle Time'])

  // The durable result: not one dangling wiki link anywhere in the vault.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-05-rename-survived')
  await quitApp(app)
})

test('step 6 — renaming a FOLDER PAGE: the links INSIDE folder_page_settings follow too (YAZ-864)', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, HOME)) })
  win = await appWindow(app, 'w1')
  await expect(outlineRows(contents(win))).toHaveText(TOPICS)

  await fileRow(win, ROLES).click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(win.locator('.create-inline__input')).toHaveValue(ROLES)
  await win.locator('.create-inline__input').fill(ROLES_RENAMED)
  await win.keyboard.press('Enter')

  // SIX notes: the three members through their own top-level `folder_pages` — the half that already
  // worked — plus the three folder pages that name Roles ONLY from inside `folder_page_settings`,
  // which the index never extracted as links and the rewrite therefore used to walk straight past.
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 6 notes')

  const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')
  // Home's outline `order` entry — the [D5] sequence, rewritten in place …
  await expect.poll(() => read(HOME)).toContain(`- "[[${ROLES_RENAMED}]]"`)
  expect(await read(HOME)).toContain('- "[[KPIs]]"') // its siblings, untouched
  // … a column `target` on ANOTHER folder page, its column's other keys intact …
  await expect.poll(() => read('Problems.md')).toContain(`target: "[[${ROLES_RENAMED}]]"`)
  const problems = await read('Problems.md')
  expect(problems).toContain('target: "[[KPIs]]"')
  expect(problems).toContain('required: true')
  expect(problems).toContain('folder: problems')
  // … the renamed page's OWN self-target, written at its new path, `folder` and belonging intact …
  const renamedPage = await read(`${ROLES_RENAMED}.md`)
  expect(renamedPage).toContain(`target: "[[${ROLES_RENAMED}]]"`)
  expect(renamedPage).toContain('folder: roles')
  expect(renamedPage).toContain('- "[[Home]]"')
  // … and the members' plain `folder_pages`, which is the behaviour that already worked.
  for (const member of ROLE_MEMBERS) {
    await expect.poll(() => read(path.join('roles', `${member}.md`))).toContain(`- "[[${ROLES_RENAMED}]]"`)
  }

  // Everything still browses: Home's order still places it LAST — a stale entry would be ignored
  // and 'Buyer Roles' would have drifted to the top alphabetically — and it still holds its three.
  await expect(outlineRows(contents(win))).toHaveText(TOPICS_AFTER)
  await expect(outlineCounts(contents(win))).toHaveText(TOPIC_COUNTS)
  await fileRow(win, ROLES_RENAMED).click()
  await expect(activeTab(win)).toHaveText(ROLES_RENAMED)
  await expect(outlineRows(contents(win))).toHaveText(ROLE_MEMBERS)

  // The durable result again, with the settings targets now inside the audit's reach.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-06-folder-page-rename')
  await quitApp(app)
})
