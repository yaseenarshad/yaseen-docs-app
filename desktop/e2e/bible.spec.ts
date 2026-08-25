/**
 * Bible C (GRO-2203): the convergence proof — entity pages + relations + folder pages + wiki
 * links driven together, through the REAL app, over one committed encyclopedia fixture
 * (`fixtures/bible-vault/`: 18 entity pages wired by relation properties in their own
 * frontmatter). Every other spec generates its vault; this one commits it, because the content
 * IS the thing under test — the same five `page_type` values, the same relation graph.
 *
 * `page_type` is an ORDINARY frontmatter property here, and always was: the query engine never
 * treated it specially. What died with the type system (YAZ-836) is the CLIENT half — the
 * registry that declared those names, typed "New ▸ <type>" creation, the registry-narrowed
 * relation picker and the type scaffold — and with it the steps that only ever proved the
 * registry (YAZ-837).
 *
 * YAZ-844 retired `.base` itself. The three steps that drove a standalone `.base` host, an
 * `![[X.base]]` embed and a ```base fence went with it: each proved the SURFACE, and the
 * surface is gone. What the engine still reaches through the surviving one — the folder page's
 * contents block — was re-pointed onto `Funnel Stages.md` rather than deleted. Filters and
 * grouping have no folder-page gesture at all (🔒 Q3: a folder page's set IS the lookup), so
 * the steps that only existed to drive them are not re-pointed anywhere.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1  the "Funnel Stages" folder page opens holding exactly its members; zero broken links
 *   2  a relation cell edited inline through the chips editor — a surgical write to the
 *      MEMBER's own file, and the block picks it up off the watcher
 *   3  wiki-link navigation: click → current tab, ⌘-click → background tab (the LOCKED model)
 *   4  the backlinks panel finds every note that names a KPI, and the `page_type: problem`
 *      ones are exactly the two problems whose relations point at it
 *   5  rename an entity page — relations, body links and backlinks all survive, still zero
 *      broken links
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

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDERS = ['funnel-stages', 'industries', 'kpis', 'problems', 'roles']
/** Every `page_type: problem` page — the fixture's own answer to "which mentions are problems?". */
const PROBLEMS = ['CRM Hygiene', 'Lead Quality Scoring', 'Nurture Sequencing', 'Stage Accuracy']

const FOLDER_PAGE = 'Funnel Stages.md'
/** Its members, in the path order `pagesIn` hands them over. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
const FUNNEL = path.join('funnel-stages', 'Sales-Conversion.md')
const RENAMED = 'Deal Win Rate'

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
const viewTabs = (scope: Locator) => scope.locator('.base-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.base-table tbody tr:not(.base-table__group):not(.base-table__spacer)')
const outlineRows = (scope: Locator) => scope.locator('.base-outline__link')
const rowNames = (scope: Locator) => scope.locator('.base-row__link, .base-table__link')
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/**
 * What the name column shows. The clickable title cell is keyed to `file.name` (TableView's
 * `nameCol`), and `file.name` is Obsidian's TFile name — extension included.
 */
const named = (...names: string[]) => names.map((n) => `${n}.md`)

const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

// ---------- zero-broken-links audit ----------

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
 * Every wiki link in every note — frontmatter relation values as much as body prose and
 * `![[…]]` embeds — whose target names no file in the vault, by basename or by root-relative
 * path, with or without extension. The durable result GRO-2203 asks for is that this is `[]`
 * both before and after the rename.
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

test('step 1 — the encyclopedia opens on "Funnel Stages", holding exactly its members, with no broken links', async () => {
  expect(await brokenLinks(vault)).toEqual([]) // the fixture itself is sound before anything runs

  app = await launchApp({
    userData,
    seedState: seededState(vault, path.join(vault, FOLDER_PAGE), { expanded: FOLDERS.map((f) => path.join(vault, f)) }),
  })
  win = await appWindow(app, 'w1')

  // The index page of an encyclopedia that maintains no list: the three funnel-stage pages say
  // in their OWN frontmatter that they belong here, and that is the whole membership rule.
  await expect(contents(win)).toBeVisible()
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table'])
  await expect(outlineRows(contents(win))).toHaveText(MEMBERS)

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(rowNames(contents(win))).toHaveText(named(...MEMBERS))
  await shoot(win, 'bible-01-folder-page-members')
})

test('step 2 — a relation cell edited inline: written to the MEMBER’s own file, surgically', async () => {
  // Column 2 is `related_stages`, declared `multi-link` by the folder page's own card (🔒 Q8).
  // Row 2 is Sales-Conversion, whose relation list starts empty.
  await cell(contents(win), 2, 2).locator('[data-edit]').click()
  const input = win.locator('.base-cell-edit__input')
  await expect(input).toBeVisible()
  // A declared `multi-link` column opens the chips editor with `[[…]]` completion narrowed to
  // the target folder page's members (🔒 D2) — so the link is PICKED, not typed whole.
  await input.pressSequentially('[[', { delay: 15 })
  const suggestions = win.locator('[aria-label="Edit related_stages suggestions"] [role="option"]')
  await expect(suggestions).toHaveText(MEMBERS)
  await shoot(win, 'bible-02-relation-cell-edit')
  await suggestions.filter({ hasText: 'Lead Nurture' }).click() // the pick closes the `[[…]]`
  await win.keyboard.press('Enter') // turns the text into a chip
  await win.keyboard.press('Enter') // empty input → commits the whole list

  // The write lands in the MEMBER's frontmatter, surgically — every other key and the body survive.
  const salesConversion = path.join(vault, FUNNEL)
  await expect.poll(() => readFile(salesConversion, 'utf8'), { timeout: 10_000 }).toContain('[[Lead Nurture]]')
  const after = await readFile(salesConversion, 'utf8')
  expect(after).toContain('folder_pages: ["[[Funnel Stages]]"]') // the belonging is untouched
  expect(after).toContain('order: 3')
  expect(after).toContain('# Sales-Conversion')
  await shoot(win, 'bible-02b-relation-written')
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
  await tabsOf(win).filter({ hasText: 'Win Rate' }).click()
  await expect(activeTab(win)).toHaveText('Win Rate')
  await expect(editorOf(win)).toContainText('Closed-won as a share of closed pipeline')

  // Four notes mention Win Rate: the two problems that name it ONLY in their `kpis_impacted`
  // relation property — frontmatter links are first-class to the index — plus the funnel page
  // and the owning role, via body prose. Path-sorted.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // Convergence: the `page_type: problem` mentions are EXACTLY the two problems whose
  // relations point at this KPI — prose and relations answering the same question.
  const mentions = await backlinkNotes(win).allTextContents()
  expect(mentions.filter((n) => PROBLEMS.includes(n)).sort()).toEqual(['CRM Hygiene', 'Stage Accuracy'])
  await shoot(win, 'bible-04-backlinks-agree')
})

test('step 5 — renaming an entity page: relations, body links and backlinks all survive', async () => {
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

  // The durable result: not one dangling wiki link anywhere in the vault.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-05-rename-survived')
  await quitApp(app)
})
