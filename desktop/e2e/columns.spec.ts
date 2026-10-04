/**
 * The column overhaul, end to end (YAZ-1513 — 2A-2D, 3A-3E; header drag YAZ-1548; polish
 * YAZ-1549; this spec is 5-, YAZ-1550). What a folder's Table says about its columns, and what
 * every column gesture writes — proven on the REAL app over the small committed
 * `fixtures/columns-vault`: the folder `Tasks`, whose `.folder.md` declares the `status` Select,
 * holding six notes across three statuses plus one with none.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the Table's `#` gutter counts from 1 and RESTARTS at every group header, and the name cell
 *     is the page TITLE — `Q3-2026 plan`, never `Q3-2026 plan.md`
 *   2 the `#` header's right-click hides the gutter (`rowNumbers: false` lands on the view) and
 *     Properties → Table → Row numbers brings it back, leaving NO key behind (absent = shown)
 *   3 "Rename column…" on the header: `Status` → `Stage` on the header AND in the Properties
 *     list, written as a `properties` LABEL — the key `status` never moves
 *   4 dragging the last header before `Stage` rewrites the view's `order` in one write
 *   5 "Delete column…" asks first, naming the count; confirming drops the declaration, every view
 *     reference and the label, and each note loses ONLY its `status:` line — the rest of
 *     every file is byte-identical
 *
 * Same harness as folderView.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `columns-`
 * step screenshots).
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, contents, copyVault, launchApp, openFolder, quitApp, seededState, sheet, shoot, viewTabs } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed fixture. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'columns-vault')
const TASKS = 'Tasks'
/** Where the folder's columns, views and labels live (YAZ-2290 D1). */
const SETTINGS = path.join(TASKS, '.folder.md')
/** The six notes in `Tasks`, as the fixture spells them — every one carries a `status:` line. */
const MEMBERS = ['Write launch post', 'Ship installer', 'Q3-2026 plan', 'Fix sync bug', 'Release 0.9', 'Loose end'].map((n) =>
  path.join(TASKS, `${n}.md`),
)

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (the folderView / freezeColumns idiom) ----------

const table = () => contents(win).locator('.view-table')
const headers = () => table().locator('thead th')
/** A property header by its LABEL — the `#` gutter excluded; the resize grip carries no text. */
const colHeader = (label: string) => table().locator('thead th:not(.view-table__gutter)').filter({ hasText: new RegExp(`^${label}$`) })
const gutterHeader = () => table().locator('thead th.view-table__gutter')
const dataRows = () => table().locator('tbody tr:not(.view-table__group):not(.view-table__spacer)')
const groupNames = () => table().locator('.view-table__group .view-group__value')
const menuItem = (w: Page, label: string) => w.locator('.ctx-menu [role="menuitem"]', { hasText: label })
const propsMenu = () => contents(win).locator('.view-popover')

/** Every data row as `[name, #]` — the name cell's text and the gutter's, in display order. */
async function rowsWithNumbers(): Promise<[string, string][]> {
  return dataRows().evaluateAll((rows) =>
    rows.map((tr) => [tr.querySelector('.view-table__link')?.textContent ?? '', tr.querySelector('td.view-table__gutter')?.textContent ?? '']),
  )
}

// ---------- frontmatter (typed just far enough to assert) ----------

interface OnDiskView {
  type?: string
  name?: string
  order?: string[]
  groupBy?: unknown
  rowNumbers?: boolean
  frozenColumns?: number
}
interface OnDiskSettings {
  columns?: Record<string, unknown>
  properties?: Record<string, { displayName?: string }>
  views?: OnDiskView[]
}

async function propertiesOf(file: string): Promise<Record<string, unknown>> {
  return parseFrontmatter(splitFrontmatter(await readFile(file, 'utf8')).frontmatter).properties
}
async function settingsOf(file: string): Promise<OnDiskSettings> {
  return ((await propertiesOf(file)).folder_page_settings ?? {}) as OnDiskSettings
}
const viewOf = (settings: OnDiskSettings, type: string): OnDiskView => settings.views?.find((v) => v.type === type) ?? {}
/** The stored label for `status`, whichever spelling the writer chose (bare, or `note.`-prefixed). */
const statusLabel = (settings: OnDiskSettings): string | undefined =>
  settings.properties?.status?.displayName ?? settings.properties?.['note.status']?.displayName

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'columns-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the `#` gutter restarts at every group, and the name cell is the page title, no `.md`', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await openFolder(win, path.join(vault, TASKS))
  // `defaultView: Table` opens the folder on the table (YAZ-1104); the click is a no-op that pins it.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(table()).toBeVisible()

  // The gutter is the FIRST header; every other header wears `defaultLabel` — `file.name` is "Name",
  // the note keys sentence case (YAZ-1513). Nothing here is the raw key.
  await expect(headers()).toHaveText(['#', 'Name', 'Status', 'Owner', 'Due'])

  // Grouped by `status`: the select's options in their own order, "No value" last — and the `#`
  // is a DISPLAY position, 1-based, restarting under each group header.
  await expect(groupNames()).toHaveText(['1-Backlog', '2-Todo', '4-Done', 'No value'])
  await expect.poll(rowsWithNumbers).toEqual([
    ['Ship installer', '1'],
    ['Write launch post', '2'],
    ['Fix sync bug', '1'],
    ['Q3-2026 plan', '2'],
    ['Release 0.9', '1'],
    ['Loose end', '1'],
  ])
  // The TITLE, in the cell — `file.name`'s VALUE keeps its extension for sort and filter; the eye never sees it.
  for (const [name] of await rowsWithNumbers()) expect(name).not.toMatch(/\.md$/)
  await shoot(win, 'columns-01-grouped-gutter')
})

test('step 2 — the `#` header hides the gutter; Properties → Row numbers brings it back, leaving no key', async () => {
  // The `#` header's menu offers exactly one thing.
  await gutterHeader().click({ button: 'right' })
  await expect(win.locator('.ctx-menu [role="menuitem"]')).toHaveText(['Hide row numbers'])
  await menuItem(win, 'Hide row numbers').click()

  await expect(gutterHeader()).toHaveCount(0)
  await expect(table().locator('td.view-table__gutter')).toHaveCount(0)
  await expect(headers()).toHaveText(['Name', 'Status', 'Owner', 'Due'])
  // `rowNumbers: false` lands on the VIEW, through the one settings door.
  const tasks = path.join(vault, SETTINGS)
  await expect.poll(async () => viewOf(await settingsOf(tasks), 'table').rowNumbers, { timeout: 10_000 }).toBe(false)
  await shoot(win, 'columns-02-row-numbers-hidden')

  // Properties → Table → Row numbers: the same fact, the other door.
  await contents(win).locator('[aria-label="Properties"]').click()
  await expect(propsMenu()).toBeVisible()
  const rowNumbers = propsMenu().locator('[aria-label="Row numbers"]')
  await expect(rowNumbers).not.toBeChecked()
  await rowNumbers.check()
  await expect(gutterHeader()).toHaveCount(1)
  await win.keyboard.press('Escape')
  await expect(propsMenu()).toHaveCount(0)

  // Shown is the DEFAULT: a shown gutter leaves no `rowNumbers` key behind — the round trip is
  // absent → false → absent, never absent → false → true.
  await expect.poll(async () => viewOf(await settingsOf(tasks), 'table').rowNumbers, { timeout: 10_000 }).toBeUndefined()
  expect(await readFile(tasks, 'utf8')).not.toContain('rowNumbers')
  await expect.poll(rowsWithNumbers).toEqual([
    ['Ship installer', '1'],
    ['Write launch post', '2'],
    ['Fix sync bug', '1'],
    ['Q3-2026 plan', '2'],
    ['Release 0.9', '1'],
    ['Loose end', '1'],
  ])
  await shoot(win, 'columns-03-row-numbers-back')
})

test('step 3 — "Rename column…" on the header: `Status` → `Stage` is a LABEL; the key never moves', async () => {
  await colHeader('Status').click({ button: 'right' })
  await expect(win.locator('.ctx-menu [role="menuitem"]')).toHaveText(['Rename column…', 'Hide column', 'Add column to the right…', 'Delete column…'])
  await shoot(win, 'columns-04-header-menu')
  await menuItem(win, 'Rename column…').click()

  // The inline field holds the STORED display name (none yet) with the default label as its
  // placeholder; Enter commits through `setDisplayName` and closes the menu.
  const field = win.locator('[aria-label="Rename Status"]')
  await expect(field).toBeVisible()
  await field.fill('Stage')
  await win.keyboard.press('Enter')
  await expect(win.locator('.ctx-menu')).toHaveCount(0)

  await expect(headers()).toHaveText(['#', 'Name', 'Stage', 'Owner', 'Due'])
  // The Properties LIST wears the same label — one `propertyLabel`, every surface.
  await contents(win).locator('[aria-label="Properties"]').click()
  await expect(propsMenu().locator('[aria-label="Open Stage"]')).toBeVisible()
  await expect(propsMenu().locator('[aria-label="Open Status"]')).toHaveCount(0)
  await win.keyboard.press('Escape')
  await expect(propsMenu()).toHaveCount(0)

  // On disk: a `properties` entry for `status` (the writer's own spelling — bare, or `note.`-
  // prefixed — is asserted as whichever it chose), and the DECLARATION still keyed `status`.
  const tasks = path.join(vault, SETTINGS)
  await expect.poll(async () => statusLabel(await settingsOf(tasks)), { timeout: 10_000 }).toBe('Stage')
  const settings = await settingsOf(tasks)
  expect(Object.keys(settings.columns ?? {})).toEqual(['status', 'owner', 'due'])
  expect(viewOf(settings, 'table').order).toEqual(['file.name', 'note.status', 'note.owner', 'note.due'])
  // The notes' frontmatter is untouched: a label is what the header SAYS, never what a note stores.
  for (const member of MEMBERS) expect(await readFile(path.join(vault, member), 'utf8')).toContain('status:')
  await shoot(win, 'columns-05-renamed-stage')
})

test('step 4 — dragging the last header before `Stage` rewrites the view’s order in one write', async () => {
  const src = await colHeader('Due').boundingBox()
  const dst = await colHeader('Stage').boundingBox()
  if (src === null || dst === null) throw new Error('the Due / Stage headers have no bounding box')

  // A REAL drag (YAZ-1548): mouse down on the header's middle (the resize grip lives at the right
  // edge), a couple of moves so Chromium starts the HTML5 drag, then a drop on the LEFT half of
  // `Stage` — the slot BEFORE it, the Properties list's own rule.
  await win.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await win.mouse.down()
  await win.mouse.move(src.x + src.width / 2 - 10, src.y + src.height / 2, { steps: 5 })
  await win.mouse.move(dst.x + 6, dst.y + dst.height / 2, { steps: 15 })
  await win.mouse.up()

  await expect(headers()).toHaveText(['#', 'Name', 'Due', 'Stage', 'Owner'])
  const tasks = path.join(vault, SETTINGS)
  await expect.poll(async () => viewOf(await settingsOf(tasks), 'table').order, { timeout: 10_000 }).toEqual([
    'file.name',
    'note.due',
    'note.status',
    'note.owner',
  ])
  // The label rode along untouched, and no frozen prefix was invented by the order writer.
  const settings = await settingsOf(tasks)
  expect(statusLabel(settings)).toBe('Stage')
  expect(viewOf(settings, 'table').frozenColumns).toBeUndefined()
  await shoot(win, 'columns-06-dragged-due')
})

test('step 5 — "Delete column…" asks first, then strips declaration, references, label and each note’s `status:` line — nothing else', async () => {
  const tasks = path.join(vault, SETTINGS)
  const before = new Map(await Promise.all(MEMBERS.map(async (m) => [m, await readFile(path.join(vault, m), 'utf8')] as const)))
  for (const text of before.values()) expect(text).toMatch(/^status:/m)

  await colHeader('Stage').click({ button: 'right' })
  await menuItem(win, 'Delete column…').click()

  // The sheet names the LABEL, the bare KEY and the count of notes in the folder carrying it — all six,
  // the empty `status:` on `Loose end` included, because presence is the exact YAML key.
  await expect(sheet(win)).toContainText('Delete "Stage"? This removes the column from this folder and the "status" value from 6 notes.')
  await shoot(win, 'columns-07-delete-sheet')
  await sheet(win).locator('.confirm__btn--danger', { hasText: 'Delete' }).click()
  await expect(sheet(win)).toHaveCount(0)

  // Settings FIRST (awaited before any note is touched): the declaration, the table's order
  // entry and its groupBy, the board's groupBy, and the label — all gone in one write.
  await expect.poll(async () => Object.keys((await settingsOf(tasks)).columns ?? {}), { timeout: 10_000 }).toEqual(['owner', 'due'])
  const settings = await settingsOf(tasks)
  expect(viewOf(settings, 'table').order).toEqual(['file.name', 'note.due', 'note.owner'])
  expect(viewOf(settings, 'table').groupBy).toBeUndefined()
  expect(viewOf(settings, 'board').groupBy).toBeUndefined()
  expect(viewOf(settings, 'board').order).toEqual(['file.name', 'note.owner'])
  expect(settings.properties).toBeUndefined()
  // No view still names the key anywhere — order, sort, groupBy, summaries, columnSize, cardStyle,
  // filters, image. The outline's PROSE may say "statuses"; prose is not a reference, so it is left out.
  for (const view of (settings.views ?? []) as Record<string, unknown>[]) {
    const { outline: _prose, ...config } = view
    expect(JSON.stringify(config)).not.toMatch(/status/)
  }

  // Then every note: ONLY its `status:` line is gone — the rest of the file byte for byte.
  for (const member of MEMBERS) {
    const file = path.join(vault, member)
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 10_000 }).not.toMatch(/^status:/m)
    expect(await readFile(file, 'utf8')).toBe(before.get(member)!.replace(/^status:[^\n]*\n/m, ''))
  }

  // The table is ungrouped now, and the gutter simply counts the six.
  await expect(headers()).toHaveText(['#', 'Name', 'Due', 'Owner'])
  await expect(groupNames()).toHaveCount(0)
  await expect.poll(async () => (await rowsWithNumbers()).map(([, n]) => n)).toEqual(['1', '2', '3', '4', '5', '6'])
  // No strip failed, so the aggregated banner never showed.
  await expect(contents(win).locator('.views-pane__error')).toHaveCount(0)
  await shoot(win, 'columns-08-deleted')
  await quitApp(app)
})
