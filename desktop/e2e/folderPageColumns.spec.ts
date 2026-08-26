/**
 * Declared columns, end to end (YAZ-898; the seams landed in YAZ-895/896/897): a folder page's
 * `folder_page_settings.columns` is the typing ladder's TOP rung (🔒 Q8), and the Properties menu
 * is the only door to it — "+ Add column" declares one and the per-key Type select retypes one,
 * each in a single `folder_page_settings` write.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`),
 * on `KPIs` — the folder page that already SHIPS three declarations (`funnel_stages` multi-link
 * with a target, `kpi_category`, `unit`), five members parked in `kpis/`, and a Table view whose
 * `order` names four columns. So every step below adds to a real declaration block rather than
 * creating one, which is what makes the merge-don't-replace half of each write visible.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 "+ Add column" declares `unit_notes` and SHOWS it, in one `folder_page_settings` write
 *     (🔒 D3): the header appears, the declaration lands on disk, and the Table view's `order`
 *     gains `note.unit_notes` — the three existing declarations untouched
 *   2 the Type select retypes it `text` → `number`: the DECLARATION moves and nothing else does —
 *     🔒 C1, proven by byte-equality over every member file, across BOTH writes
 *   3 the retyped column edits as a NUMBER, and the value lands on the member's own card on disk
 *   4 "New" births a member from the declaration, `unit_notes` scaffolded empty among the rest
 *   5 quit → relaunch: the column and its declaration are on the page, not in the session
 *   6 a name that is not a property name is refused inline, and NOTHING is written
 *
 * Same harness as folderPages.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `columns-`
 * step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'KPIs.md'
const KPIS = 'kpis'
/** Its members, in the order the table lists them (no `sort`, so the index order stands). */
const MEMBERS = ['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Win Rate']
/** The column this spec declares, and the member whose cell it fills. */
const COLUMN = 'unit_notes'
const SUBJECT = 'CAC'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page
/** Every member file's bytes before the first declaration write — step 2's C1 evidence. */
let memberBytes: Record<string, string>

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
const rowNames = (scope: Locator) => scope.locator('.view-table__link')
const headers = (scope: Locator) => scope.locator('.view-table thead th')
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/** The Properties popover — the ONE door to the declarations (YAZ-895). */
const propsMenu = (scope: Locator) => scope.locator('.view-popover')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
/** `file.name` is Obsidian's TFile name — extension included. */
const named = (...names: string[]) => names.map((n) => `${n}.md`)

const memberPath = (name: string) => path.join(vault, KPIS, `${name}.md`)
const folderPagePath = () => path.join(vault, FOLDER_PAGE)

/** One declared column, as the frontmatter holds it. */
interface OnDiskColumn {
  kind?: string
  target?: string
}
interface OnDiskSettings {
  columns?: Record<string, OnDiskColumn>
  folder?: string
  views?: { type?: string; name?: string; order?: string[] }[]
}

/**
 * The folder page's `folder_page_settings` AS WRITTEN, read off disk. Parsed rather than
 * string-matched: the assertions below are about the SHAPE the one door wrote (which keys moved,
 * which survived), and a `toContain` would pass on a block that had lost half of it.
 */
async function settingsOnDisk(): Promise<OnDiskSettings> {
  const { frontmatter } = splitFrontmatter(await readFile(folderPagePath(), 'utf8'))
  return (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as OnDiskSettings
}

/** Every member file's full bytes, keyed by name — the before/after pair C1 is proven with. */
async function readMembers(): Promise<Record<string, string>> {
  const entries = await Promise.all(MEMBERS.map(async (name) => [name, await readFile(memberPath(name), 'utf8')] as const))
  return Object.fromEntries(entries)
}

/** Opens the Properties menu on the folder page's Table view; the outline is never offered one. */
async function openProperties(): Promise<Locator> {
  await contents(win).locator('[aria-label="Properties"]').click()
  const menu = propsMenu(contents(win))
  await expect(menu).toBeVisible()
  return menu
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'columns-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — "+ Add column" declares a column and shows it, in one settings write', async () => {
  app = await launchApp({
    userData,
    seedState: seededState(vault, folderPagePath(), { expanded: [path.join(vault, KPIS)] }),
  })
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  // The shipped shape this step adds to: four columns from the view's `order`, five members.
  await expect(headers(contents(win))).toHaveText(['file.name', 'kpi_category', 'unit', 'funnel_stages'])
  await expect(rowNames(contents(win))).toHaveText(named(...MEMBERS))
  memberBytes = await readMembers() // C1's "before", taken before the FIRST declaration write

  const menu = await openProperties()
  await menu.locator('.view-menu__action', { hasText: '+ Add column' }).click()
  await menu.locator('[aria-label="Column name"]').fill(COLUMN)
  await menu.locator('[aria-label="Column kind"]').selectOption('text')
  await shoot(win, 'columns-01-add-column-form')
  await menu.locator('[aria-label="Save column"]').click()

  // The header is there as soon as the write comes back through the index — no reopen, no reload.
  await expect(headers(contents(win))).toHaveText(['file.name', 'kpi_category', 'unit', 'funnel_stages', COLUMN])
  await shoot(win, 'columns-02-column-header')

  // ONE write, asserted as its FINAL state (🔒 D3): the declaration AND the view's `order`, with
  // the three shipped declarations — `funnel_stages`' target included — exactly where they were.
  await expect.poll(async () => (await settingsOnDisk()).columns?.[COLUMN], { timeout: 10_000 }).toEqual({ kind: 'text' })
  const settings = await settingsOnDisk()
  expect(settings.columns).toEqual({
    funnel_stages: { kind: 'multi-link', target: '[[Funnel Stages]]' },
    kpi_category: { kind: 'text' },
    unit: { kind: 'text' },
    [COLUMN]: { kind: 'text' },
  })
  expect(settings.views?.find((v) => v.name === 'Table')?.order).toEqual([
    'file.name',
    'note.kpi_category',
    'note.unit',
    'note.funnel_stages',
    `note.${COLUMN}`,
  ])
  expect(settings.folder).toBe(KPIS) // the parking bin is not a column and never moves
})

test('step 2 — retyping moves the DECLARATION and nothing else: every member file is byte-identical', async () => {
  // The per-key Type select (YAZ-897), on the row the declaration made offerable.
  const kind = propsMenu(contents(win)).locator(`[aria-label="Type of ${COLUMN}"]`)
  await kind.selectOption('number')
  await expect.poll(async () => (await settingsOnDisk()).columns?.[COLUMN], { timeout: 10_000 }).toEqual({ kind: 'number' })
  // The select is CONTROLLED off the folder page's own card, so it only reads `number` once the
  // write has come back through the index — the honest signal that the new rung is live (step 3
  // types into it as a number, which is the same rung answering).
  await expect(kind).toHaveValue('number')
  await shoot(win, 'columns-03-retyped-number')

  // 🔒 C1 (locked): a retype never touches member files — no migration, no rewrite, not one byte.
  // The comparison spans BOTH declaration writes, so the add is held to the same rule as the retype.
  expect(await readMembers()).toEqual(memberBytes)

  // `views` was not passed to this write, so the order it does not own is untouched.
  const settings = await settingsOnDisk()
  expect(settings.views?.find((v) => v.name === 'Table')?.order).toContain(`note.${COLUMN}`)
  expect(settings.columns?.kpi_category).toEqual({ kind: 'text' })
})

test('step 3 — the retyped column edits as a number, onto the MEMBER’s own file', async () => {
  await win.keyboard.press('Escape') // close the Properties popover; the table is what edits now
  await expect(propsMenu(contents(win))).toHaveCount(0)

  // Column 4 is the new one, row 0 is CAC (the row order asserted in step 1).
  await cell(contents(win), 0, 4).locator('[data-edit]').click()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await input.fill('42')
  await win.keyboard.press('Enter')

  const subject = memberPath(SUBJECT)
  await expect.poll(() => readFile(subject, 'utf8'), { timeout: 10_000 }).toContain(`${COLUMN}: 42`)
  const after = await readFile(subject, 'utf8')
  expect(after).toContain('folder_pages:') // the belonging is untouched
  expect(after).toContain('kpi_category: lagging') // and so is every other key
  expect(after).toContain(`# ${SUBJECT}`) // and the body
  // A number kind writes a NUMBER, not the string the input carried.
  const props = parseFrontmatter(splitFrontmatter(after).frontmatter).properties
  expect(props[COLUMN]).toBe(42)
  await shoot(win, 'columns-04-number-cell-write')

  // Only the edited member moved; the other four are still byte-identical to step 1's snapshot.
  const now = await readMembers()
  for (const name of MEMBERS.filter((n) => n !== SUBJECT)) expect(now[name]).toBe(memberBytes[name])
})

test('step 4 — "New" births a member with the declared column scaffolded empty', async () => {
  await contents(win).locator('[aria-label="New note"]').click()

  // Parked in the settings' `folder`, every DECLARED column empty (scalars print Obsidian-style
  // `key:`, lists `[]`) and the belonging LAST (🔒 Q5).
  const created = path.join(vault, KPIS, 'Untitled.md')
  await expect.poll(() => readFile(created, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('[[KPIs]]')
  const born = await readFile(created, 'utf8')
  expect(born).toContain(`${COLUMN}:\n`) // the column declared in step 1, scaffolded from the declaration
  expect(born).toContain('funnel_stages: []')
  expect(born).not.toContain('folder_page:')
  const props = parseFrontmatter(splitFrontmatter(born).frontmatter).properties
  expect(props[COLUMN]).toBeNull()
  await expect(activeTab(win)).toHaveText('Untitled')
  await shoot(win, 'columns-05-born-member')
})

test('step 5 — the column lives on the page, not in the session: it survives quit → relaunch', async () => {
  await quitApp(app) // the REAL quit path: pending autosaves and the state write are flushed

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await fileRow(win, 'KPIs').click()
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the reopened page is back on Q7's first skin.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()

  await expect(headers(contents(win))).toHaveText(['file.name', 'kpi_category', 'unit', 'funnel_stages', COLUMN])
  await expect(dataRows(contents(win))).toHaveCount(MEMBERS.length + 1) // step 4's newborn is a member now
  expect((await settingsOnDisk()).columns?.[COLUMN]).toEqual({ kind: 'number' })
  // …and step 3's value is still in the cell it was typed into.
  await expect(cell(contents(win), 0, 4)).toContainText('42')
  await shoot(win, 'columns-06-survives-relaunch')
})

test('step 6 — a name that is not a property name is refused inline, and nothing is written', async () => {
  const before = await readFile(folderPagePath(), 'utf8')

  const menu = await openProperties()
  await menu.locator('.view-menu__action', { hasText: '+ Add column' }).click()
  await menu.locator('[aria-label="Column name"]').fill('Bad Name!')
  await menu.locator('[aria-label="Save column"]').click()

  const alert = menu.locator('[role="alert"]')
  await expect(alert).toBeVisible()
  await expect(alert).toHaveText('Use lower case letters, digits and _, starting with a letter')
  // The form stays open on the rejected name — the refusal is a correction, not a dismissal.
  await expect(menu.locator('[aria-label="Column name"]')).toHaveValue('Bad Name!')
  await shoot(win, 'columns-07-bad-name-refused')

  // Nothing was written: the folder page's bytes are the ones step 5 left behind.
  expect(await readFile(folderPagePath(), 'utf8')).toBe(before)
  await expect(headers(contents(win))).toHaveText(['file.name', 'kpi_category', 'unit', 'funnel_stages', COLUMN])

  await quitApp(app)
})
