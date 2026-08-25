/**
 * Bible C (GRO-2203): the convergence proof — entity pages + relations + bases + wiki links
 * driven together, through the REAL app, over one committed encyclopedia fixture
 * (`fixtures/bible-vault/`: 17 entity pages wired by relation properties in their own
 * frontmatter, two `.base` files). Every other spec generates its vault; this one commits it,
 * because the content IS the thing under test — the same five `page_type` values, the same two
 * canonical queries.
 *
 * `page_type` is an ORDINARY frontmatter property here, and always was: the query engine never
 * treated it specially, so every filter below still means exactly what it meant. What died with
 * the type system (YAZ-836) is the CLIENT half — the registry that declared those names, typed
 * "New ▸ <type>" creation, the registry-narrowed relation picker and the type scaffold — and with
 * it the steps that only ever proved the registry (YAZ-837). Nothing that reads or writes the
 * fixture's own frontmatter changed, so the arc is the same arc, one rung shorter.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1  the "All KPIs" base opens grouped by funnel, the fixture has zero broken links
 *   2  canonical query A, standalone form: `funnel_stages.contains(link("Sales-Conversion"))`
 *   3  a relation cell edited inline through the chips editor — surgical disk write, regroup
 *   3b the multi-funnel KPI under FAN-OUT (YAZ-671): a drag between funnel groups SWAPS one element
 *      on disk, a group "+" seeds only that funnel, and the table ends exactly where it began
 *   4  the SAME query embedded and `this`-scoped on the funnel page (Bases 6): prose and database in one note
 *   5  wiki-link navigation: click → current tab, ⌘-click → background tab (the LOCKED model)
 *   6  canonical query B, the reverse: `page_type == "problem" && file.hasLink(this)` on the KPI page
 *   7  the backlinks panel agrees with query B on the same page
 *   8  rename an entity page — relations, body links and backlinks all survive, still zero broken links
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

const ALL_KPIS = 'All KPIs.base'
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

/** Rows/groups/cells of whichever base table `scope` holds (standalone host, embed or fence). */
const dataRows = (scope: Locator) => scope.locator('.base-table tbody tr:not(.base-table__group):not(.base-table__spacer)')
const rowNames = (scope: Locator) => scope.locator('.base-table__link')
const groupToggles = (scope: Locator) => scope.locator('tr.base-table__group .base-group__toggle')
const groupCounts = (scope: Locator) => scope.locator('tr.base-table__group .base-group__count')
const viewTabs = (scope: Locator) => scope.locator('.base-tab__btn[role="tab"]')
/**
 * What the name column shows. The clickable title cell is keyed to `file.name` (TableView's
 * `nameCol`), and `file.name` is Obsidian's TFile name — extension included.
 */
const named = (...names: string[]) => names.map((n) => `${n}.md`)
/** Group identities as the engine names them (`render()` of the group value) — `[[…]]` and all. */
const groupLabels = (scope: Locator): Promise<(string | null)[]> =>
  groupToggles(scope).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const openBase = (w: Page) => layer(w).locator('.base-host .base-view')
const embeddedBase = (w: Page) => layer(w).locator('.base-embed .base-view')
const fencedBase = (w: Page) => layer(w).locator('.base-code-block .base-view')

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

test('step 1 — the encyclopedia opens on "All KPIs", grouped by funnel, with no broken links', async () => {
  expect(await brokenLinks(vault)).toEqual([]) // the fixture itself is sound before anything runs

  app = await launchApp({
    userData,
    seedState: seededState(vault, path.join(vault, ALL_KPIS), { expanded: FOLDERS.map((f) => path.join(vault, f)) }),
  })
  win = await appWindow(app, 'w1')

  await expect(openBase(win)).toBeVisible()
  await expect(viewTabs(openBase(win))).toHaveText(['All KPIs', 'Sales-Conversion'])
  // 5 kpi pages out of 17 — the base's `page_type == "kpi"` filter over a plain frontmatter
  // property is the only thing separating them. (Row COUNT is asserted below, where fan-out
  // makes it 6.)

  // Fan-out (YAZ-671 D1): the KPI that spans two funnels appears under BOTH — there is no
  // combination group — and the KPI with no funnel lands in the native trailing "No value" group.
  // 5 KPIs make 6 memberships, so the group counts sum ABOVE the 5-row total (D2, deliberate).
  await expect(groupCounts(openBase(win))).toHaveText(['2', '1', '2', '1'])
  expect(await groupLabels(openBase(win))).toEqual([
    'Toggle group [[Lead Gen]]',
    'Toggle group [[Lead Nurture]]',
    'Toggle group [[Sales-Conversion]]',
    'Toggle group No value',
  ])
  await expect(dataRows(openBase(win))).toHaveCount(6)
  await expect(openBase(win).locator('.base-toolbar__count')).toHaveText('5 items')
  await expect(rowNames(openBase(win))).toHaveText(
    named('CAC', 'MQL Volume', 'Sales Cycle Time', 'Sales Cycle Time', 'Win Rate', 'Gross Margin'),
  )
  await shoot(win, 'bible-01-all-kpis-grouped')
})

test('step 2 — canonical query A, standalone form: funnel_stages.contains(link("Sales-Conversion"))', async () => {
  await viewTabs(openBase(win)).filter({ hasText: 'Sales-Conversion' }).click()
  // Both members of the funnel, including the KPI that lives in TWO funnels — `contains` is
  // link-aware, so the stored `"[[Sales-Conversion]]"` strings match the `link()` value.
  await expect(rowNames(openBase(win))).toHaveText(named('Sales Cycle Time', 'Win Rate'))
  await expect(groupToggles(openBase(win))).toHaveCount(0)
  await shoot(win, 'bible-02-query-a-standalone')
})

test('step 3 — a relation cell edited inline: written to disk, regrouped', async () => {
  await viewTabs(openBase(win)).filter({ hasText: 'All KPIs' }).click()
  await expect(rowNames(openBase(win))).toHaveCount(6)

  // Gross Margin is the fixture's business-fundamentals metric: no funnel, so it sits in the
  // native "No value" group. Its `funnel_stages` cell is column 1 (file.name is column 0).
  const cell = dataRows(openBase(win)).filter({ hasText: 'Gross Margin' }).locator('td').nth(1)
  await cell.locator('[data-edit]').click()
  const input = win.locator('.base-cell-edit__input')
  await expect(input).toBeVisible()
  // The editor is inferred from the VALUES the view holds (`editorType.ts`): every other KPI's
  // `funnel_stages` is a list, so the empty cell opens the chips editor. Its `[[…]]` completion
  // is declaration-gated (a `multi-link` property in `.yaseendocs/properties.json`) and this
  // fixture declares nothing — the type registry that used to narrow the candidates to
  // funnel-stage pages died with the type system (YAZ-836). So the link is typed whole, exactly
  // as a user types into an undeclared list column.
  await input.pressSequentially('[[Lead Gen]]', { delay: 15 })
  await shoot(win, 'bible-03a-relation-cell-edit')

  await win.keyboard.press('Enter') // turns the text into a chip
  await win.keyboard.press('Enter') // empty input → commits the whole list

  // The write lands in the note's frontmatter, surgically — the body is untouched.
  const grossMargin = path.join(vault, 'kpis', 'Gross Margin.md')
  await expect.poll(() => readFile(grossMargin, 'utf8'), { timeout: 10_000 }).toContain('[[Lead Gen]]')
  expect(await readFile(grossMargin, 'utf8')).toContain('# Gross Margin')

  // …and the base regroups off the watcher: Lead Gen gains a row, "No value" is gone.
  await expect(groupToggles(openBase(win))).toHaveCount(3)
  await expect(groupCounts(openBase(win))).toHaveText(['3', '1', '2'])
  await expect(rowNames(openBase(win))).toHaveText(
    named('CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Sales Cycle Time', 'Win Rate'),
  )
  await shoot(win, 'bible-03b-relation-regrouped')
})

test('step 3b — fan-out writes: a drag between funnel groups SWAPS one element on disk; a group "+" seeds only that funnel', async () => {
  const sct = path.join(vault, 'kpis', 'Sales Cycle Time.md')
  // A group header's identity lives in its toggle's aria-label (`Toggle group [[X]]`), which
  // `hasText` does not read — the visible text is the bare chip. Anchor on the button, then
  // climb to the <tr>. A data row belongs to the nearest group header ABOVE it in the flat tbody.
  const groupRow = (label: string) =>
    openBase(win).locator(`.base-group__toggle[aria-label="Toggle group ${label}"]`).locator('xpath=ancestor::tr[1]')
  const rowIn = (label: string, name: string) =>
    groupRow(label)
      .locator('xpath=following-sibling::tr[not(contains(@class,"base-table__group"))][preceding-sibling::tr[contains(@class,"base-table__group")][1][.//*[@aria-label="Toggle group ' + label + '"]]]')
      .filter({ hasText: name })
      .first()

  // ---- drag: Sales Cycle Time sits in Lead Nurture AND Sales-Conversion. Drag its Lead Nurture
  // row onto the Lead Gen section. The WRITE is the proof, not the DOM: [[Lead Nurture]] must go,
  // [[Lead Gen]] must arrive, and [[Sales-Conversion]] must survive untouched (D3: swap, never
  // overwrite with the neighbour's whole list).
  expect(await readFile(sct, 'utf8')).toContain('funnel_stages: ["[[Lead Nurture]]", "[[Sales-Conversion]]"]')
  await rowIn('[[Lead Nurture]]', 'Sales Cycle Time').dragTo(groupRow('[[Lead Gen]]'))
  await expect.poll(() => readFile(sct, 'utf8'), { timeout: 10_000 }).toContain('[[Lead Gen]]')
  const afterDrag = await readFile(sct, 'utf8')
  expect(afterDrag).not.toContain('[[Lead Nurture]]')
  expect(afterDrag).toContain('[[Sales-Conversion]]')
  expect(afterDrag).toContain('# Sales Cycle Time') // the body is untouched
  // the watcher regroups: Lead Nurture is empty and gone, Lead Gen is 4, Sales-Conversion still 2
  await expect(groupToggles(openBase(win))).toHaveCount(2)
  await expect(groupCounts(openBase(win))).toHaveText(['4', '2'])
  await shoot(win, 'bible-03c-fanout-drag-swap')

  // ---- "+": create inside the Sales-Conversion group. The seed must be THAT funnel alone (D4),
  // not the first row's whole list — and the page must land in the group it was created from.
  await groupRow('[[Sales-Conversion]]').locator('.base-group__new').click()
  // The VIEW's own rules place the page (`targetFolder`): no `file.inFolder` filter, so it lands
  // beside the `.base` file. The registry folder a type-pinned view used to redirect it to went
  // with the type system (YAZ-836) — the seed, not the placement, is what this step proves.
  const created = path.join(vault, 'Untitled.md')
  await expect.poll(() => readFile(created, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('[[Sales-Conversion]]')
  const seeded = await readFile(created, 'utf8')
  expect(seeded).not.toContain('[[Lead Gen]]')
  expect(seeded).not.toContain('[[Lead Nurture]]')
  // the create OPENS the new page in its own tab, so come back to the base before reading it
  await expect(activeTab(win)).toHaveText('Untitled')
  await shoot(win, 'bible-03d-fanout-plus-seed')
  // ⌘W is a native menu accelerator the synthetic keyboard never reaches — use the tab's own
  // close. The base was opened by seeded state, not as a tab, so closing the only tab leaves
  // the window EMPTY: reopen the base from the sidebar to read it.
  await win.locator('.tabbar [aria-label="Close Untitled"]').click()
  await fileRow(win, 'All KPIs').click()
  await expect(openBase(win)).toBeVisible()
  await expect(groupCounts(openBase(win))).toHaveText(['4', '3'])

  // ---- restore, so steps 4-8 see the fixture they were written against: remove the scratch
  // page, and put Sales Cycle Time back into Lead Nurture.
  await rm(created)
  await expect.poll(() => readFile(created, 'utf8').catch(() => null)).toBeNull()
  await expect(groupCounts(openBase(win))).toHaveText(['4', '2'])
  // dragging onto "No value" would REMOVE only the Lead Gen element — no Lead Nurture group exists
  // to drop onto. So go through the picker, the same way step 3 did, to write the list back.
  const cell = rowIn('[[Lead Gen]]', 'Sales Cycle Time').locator('td').nth(1)
  await cell.locator('[data-edit]').click()
  const input = win.locator('.base-cell-edit__input')
  await expect(input).toBeVisible()
  // chips editor: Backspace on the empty input removes the LAST chip, so remove both, then type
  // the two links back in the fixture's original order (one Enter chips each, a last one commits).
  await win.keyboard.press('Backspace')
  await win.keyboard.press('Backspace')
  await input.pressSequentially('[[Lead Nurture]]', { delay: 15 })
  await win.keyboard.press('Enter')
  await input.pressSequentially('[[Sales-Conversion]]', { delay: 15 })
  await win.keyboard.press('Enter')
  await win.keyboard.press('Enter')
  await expect.poll(() => readFile(sct, 'utf8'), { timeout: 10_000 }).toContain('[[Lead Nurture]]')
  await expect(groupCounts(openBase(win))).toHaveText(['3', '1', '2'])
})

test('step 4 — the same query embedded and `this`-scoped on the funnel page: prose AND database', async () => {
  await fileRow(win, 'Sales-Conversion').click()
  await expect(activeTab(win)).toHaveText('Sales-Conversion')
  await expect(editorOf(win)).toContainText('Open pipeline through to closed-won')

  // `KPIs in this funnel.base` filters `funnel_stages.contains(this.asLink())`; `this` is the
  // EMBEDDING note, so one file answers the question for every funnel-stage page — and it
  // returns exactly what step 2's hardcoded `link("Sales-Conversion")` returned.
  await expect(rowNames(embeddedBase(win))).toHaveText(named('Sales Cycle Time', 'Win Rate'))
  await expect(embeddedBase(win).locator('.base-toolbar__new')).toHaveCount(0) // embeds are read-only chrome
  await shoot(win, 'bible-04-embedded-this-scoped')
})

test('step 5 — navigating the encyclopedia: click → current tab, ⌘-click → background tab', async () => {
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
  await shoot(win, 'bible-05-wikilink-navigation')
})

test('step 6 — canonical query B, the reverse: page_type == "problem" && file.hasLink(this)', async () => {
  await tabsOf(win).filter({ hasText: 'Win Rate' }).click()
  await expect(activeTab(win)).toHaveText('Win Rate')
  await expect(editorOf(win)).toContainText('Closed-won as a share of closed pipeline')

  // A ```base fence in the KPI page's own prose. The two problems that name it do so ONLY in
  // their `kpis_impacted` relation property — frontmatter links are first-class to the index.
  await expect(rowNames(fencedBase(win))).toHaveText(named('CRM Hygiene', 'Stage Accuracy'))
  await shoot(win, 'bible-06-query-b-reverse')
})

test('step 7 — the backlinks panel agrees with query B on the same page', async () => {
  // Four notes mention Win Rate: the two problems (via relations) plus the funnel page and the
  // owning role (via body prose). Path-sorted.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // Convergence: the `page_type: problem` mentions are EXACTLY the rows the reverse query returned.
  const mentions = await backlinkNotes(win).allTextContents()
  expect(mentions.filter((n) => PROBLEMS.includes(n)).sort()).toEqual(['CRM Hygiene', 'Stage Accuracy'])
  await shoot(win, 'bible-07-backlinks-agree')
})

test('step 8 — renaming an entity page: relations, body links and backlinks all survive', async () => {
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

  // The reverse query still answers on the renamed page (`this` follows the path, not the name),
  // and the backlinks panel still finds the same four notes.
  await expect(rowNames(fencedBase(win))).toHaveText(named('CRM Hygiene', 'Stage Accuracy'))
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // The durable result: not one dangling wiki link anywhere in the vault.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-08-rename-survived')
  await quitApp(app)
})
