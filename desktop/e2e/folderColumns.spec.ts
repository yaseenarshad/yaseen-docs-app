/**
 * Declared columns, end to end (YAZ-898; the seams landed in YAZ-895/896/897): a folder's
 * `folder_settings.columns`, in its hidden `.folder.md`, is the typing ladder's TOP rung
 * (🔒 Q8), and the Properties menu is the only door to it — "+ Add column" declares one and the
 * per-key Type select retypes one, each in a single `folder_settings` write.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`),
 * on `KPIs` — the folder whose settings file already SHIPS three declarations (`funnel_stages`
 * multi-link with a target, `kpi_category`, `unit`), five notes, and a Table view whose
 * `order` names four columns. So every step below adds to a real declaration block rather than
 * creating one, which is what makes the merge-don't-replace half of each write visible.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 "+ Add column" declares `unit_notes` and SHOWS it, in one `folder_settings` write
 *     (🔒 D3): the header appears, the declaration lands on disk, the Table view's `order`
 *     gains `note.unit_notes` — and NOT ONE note is written: a column is never stamped empty
 *     into the notes it is declared over (YAZ-2290 E1), so every file is byte-identical
 *   2 the Type select retypes it `text` → `number`: the DECLARATION moves and nothing else does —
 *     🔒 C1, proven by byte-equality over every note again
 *   3 the retyped column edits as a NUMBER, and the value lands on the note's own file on disk
 *   4 "New" births a note in the folder with NO declared column in it — a missing value is an
 *     empty cell, never an empty key
 *   5 quit → relaunch: the column and its declaration are in the settings file, not in the session
 *   6 a name that is not a property name is refused inline, and NOTHING is written
 *
 * The harness: a temp `--user-data-dir`, a COPY of the fixture, `columns-` step screenshots.
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '../../shared/frontmatter'
import { activeTab, appWindow, contents, copyVault, launchApp, openFolder, quitApp, seededState, shoot, viewTabs } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER = 'KPIs'
/** Its notes, in the order the table lists them (no `sort`, so the index order stands). */
const MEMBERS = ['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Win Rate']
/** The column this spec declares, and the note whose cell it fills. */
const COLUMN = 'unit_notes'
/** …and the LABEL its header and its Properties row wear (YAZ-1513: sentence case, `_` → space). */
const COLUMN_LABEL = 'Unit notes'
/** The shipped Table's headers: the `#` gutter first, then every column by its label (YAZ-1513). */
const HEADERS = ['#', 'Name', 'Kpi category', 'Unit', 'Funnel stages']
const SUBJECT = 'CAC'
const RETAINED = 'Gross Margin'
const RETAINED_KEY = 'funnel_stages'
const RETAINED_VALUE = ['[[Legacy Stage]]']

let userData: string
let vault: string
let app: ElectronApplication
let win: Page
/** Every note before launch; includes RETAINED's seeded legacy declared value. */
let memberBytes: Record<string, string>

const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
/** The name cell shows the page TITLE — the basename, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-table__link')
const headers = (scope: Locator) => scope.locator('.view-table thead th')
/** `data-cell="row:col"` indexes DATA columns only — the `#` gutter carries none. */
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/** The Properties popover — the ONE door to the declarations (YAZ-895). */
const propsMenu = (scope: Locator) => scope.locator('.view-popover')

const folderPath = () => path.join(vault, FOLDER)
const memberPath = (name: string) => path.join(folderPath(), `${name}.md`)
const settingsFile = () => path.join(folderPath(), '.folder.md')

/** One declared column, as the frontmatter holds it. */
interface OnDiskColumn {
  kind?: string
  target?: string
}
interface OnDiskSettings {
  columns?: Record<string, OnDiskColumn>
  views?: { type?: string; name?: string; order?: string[] }[]
}

/**
 * The folder's `folder_settings` AS WRITTEN, read off its `.folder.md`. Parsed rather than
 * string-matched: the assertions below are about the SHAPE the one door wrote (which keys moved,
 * which survived), and a `toContain` would pass on a block that had lost half of it.
 */
async function settingsOnDisk(): Promise<OnDiskSettings> {
  const { frontmatter } = splitFrontmatter(await readFile(settingsFile(), 'utf8'))
  return (parseFrontmatter(frontmatter).properties.folder_settings ?? {}) as OnDiskSettings
}

/** Every note's full bytes, keyed by name — the before/after pair E1 and C1 are proven with. */
async function readMembers(): Promise<Record<string, string>> {
  const entries = await Promise.all(MEMBERS.map(async (name) => [name, await readFile(memberPath(name), 'utf8')] as const))
  return Object.fromEntries(entries)
}

/** Opens the Properties menu on the folder's Table view; the outline is never offered one. */
async function openProperties(): Promise<Locator> {
  await contents(win).locator('[aria-label="Properties"]').click()
  const menu = propsMenu(contents(win))
  await expect(menu).toBeVisible()
  return menu
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'columns-userdata-'))
  vault = await copyVault(FIXTURE)
  const retained = memberPath(RETAINED)
  await writeFile(retained, setFrontmatterProperty(await readFile(retained, 'utf8'), RETAINED_KEY, RETAINED_VALUE), 'utf8')
  memberBytes = await readMembers()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — "+ Add column" declares a column and shows it, in one settings write, and stamps it into no note', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await openFolder(win, folderPath())

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  // The shipped shape this step adds to: four columns from the view's `order` (each header its
  // LABEL, behind the `#` gutter — YAZ-1513), five notes named by their titles.
  await expect(headers(contents(win))).toHaveText(HEADERS)
  await expect(rowNames(contents(win))).toHaveText(MEMBERS)
  // Opening a folder writes nothing (YAZ-2290): a declaration with an already-present legacy value
  // never normalises or rewrites it.
  await expect.poll(readMembers).toEqual(memberBytes)

  const menu = await openProperties()
  await menu.locator('.view-menu__action', { hasText: '+ Add column' }).click()
  await menu.locator('[aria-label="Column name"]').fill(COLUMN)
  // The kind is the definition editor's own type row (`PropertyDefinitionEditor`): a picker of the
  // registry's kinds, chosen here explicitly rather than left on its default.
  await menu.locator('[aria-label^="Property type:"]').click()
  await menu.locator('.property-def__type-list').getByRole('button', { name: 'Text', exact: true }).click()
  await expect(menu.locator('[aria-label="Property type: Text"]')).toBeVisible()
  await shoot(win, 'columns-01-add-column-form')
  await menu.locator('[aria-label="Save column"]').click()

  // The header is there as soon as the write is made — no reopen, no reload.
  await expect(headers(contents(win))).toHaveText([...HEADERS, COLUMN_LABEL])
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

  // YAZ-2290 E1: a column is NEVER stamped empty into the notes — not on open, not when it is
  // added. The settings write above has landed and been indexed (the header shows it), and every
  // note is still byte for byte what it was before launch, the legacy value among them.
  expect(await readMembers()).toEqual(memberBytes)
  expect(parseFrontmatter(splitFrontmatter(memberBytes[RETAINED]!).frontmatter).properties[RETAINED_KEY]).toEqual(RETAINED_VALUE)
})

test('step 2 — retyping moves the DECLARATION and nothing else: every note is byte-identical', async () => {
  // The per-key Type select (YAZ-897) lives one level down since YAZ-1513: the list row the
  // declaration made offerable opens the column's DETAIL panel, and the select sits there.
  const menu = propsMenu(contents(win))
  await menu.locator(`[aria-label="Open ${COLUMN_LABEL}"]`).click()
  const kind = menu.locator(`[aria-label="Edit property ${COLUMN_LABEL}"]`)
  await expect(kind).toHaveValue('text')
  await kind.selectOption('number')
  await expect.poll(async () => (await settingsOnDisk()).columns?.[COLUMN], { timeout: 10_000 }).toEqual({ kind: 'number' })
  // The select is CONTROLLED off the folder's own declarations, so it reads `number` once the
  // write is in hand — the honest signal that the new rung is live (step 3 types into it as a
  // number, which is the same rung answering).
  await expect(kind).toHaveValue('number')
  await shoot(win, 'columns-03-retyped-number')

  // 🔒 C1 (locked): a retype never touches notes — no migration, no rewrite, not one byte.
  expect(await readMembers()).toEqual(memberBytes)

  // `views` was not passed to this write, so the order it does not own is untouched.
  const settings = await settingsOnDisk()
  expect(settings.views?.find((v) => v.name === 'Table')?.order).toContain(`note.${COLUMN}`)
  expect(settings.columns?.kpi_category).toEqual({ kind: 'text' })
})

test('step 3 — the retyped column edits as a number, onto the NOTE’s own file', async () => {
  // Back out of the detail panel, then close the Properties popover; the table is what edits now.
  await propsMenu(contents(win)).locator('[aria-label="Back to columns"]').click()
  await expect(propsMenu(contents(win)).locator(`[aria-label="Open ${COLUMN_LABEL}"]`)).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(propsMenu(contents(win))).toHaveCount(0)

  // Column 4 is the new one, row 0 is CAC (the row order asserted in step 1).
  // One click selects without editing; a deliberate double-click opens the editor.
  const target = cell(contents(win), 0, 4)
  await target.click()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toHaveCount(0)
  await target.dblclick()
  await expect(input).toBeVisible()
  await input.fill('42')
  await win.keyboard.press('Enter')

  const subject = memberPath(SUBJECT)
  await expect.poll(() => readFile(subject, 'utf8'), { timeout: 10_000 }).toContain(`${COLUMN}: 42`)
  const after = await readFile(subject, 'utf8')
  expect(after).toContain('kpi_category: lagging') // every other key is untouched
  expect(after).toContain(`# ${SUBJECT}`) // and so is the body
  await shoot(win, 'columns-04-number-cell-write')

  // Only the edited note moved; the other four are still byte-identical to what launched.
  const now = await readMembers()
  for (const name of MEMBERS.filter((n) => n !== SUBJECT)) expect(now[name]).toBe(memberBytes[name])
})

test('step 4 — "New" births a note in the folder with no declared column stamped into it', async () => {
  await contents(win).locator('[aria-label="New note"]').click()

  // Born IN the folder being viewed (YAZ-2290 D4), from its template and the view's seed alone.
  // `KPIs` has no `.template.md` and the Table no filter, so the newborn carries nothing but the
  // permanent `id` every created note is given: none of the four declared columns is a key of it.
  const created = memberPath('Untitled')
  const bornProps = async (): Promise<Record<string, unknown>> =>
    parseFrontmatter(splitFrontmatter(await readFile(created, 'utf8').catch(() => '')).frontmatter).properties
  await expect.poll(async () => Object.keys(await bornProps()), { timeout: 10_000 }).toEqual(['id'])
  const born = await readFile(created, 'utf8')
  expect(born).not.toContain(COLUMN)
  expect(born).not.toContain('funnel_stages')
  await expect(activeTab(win)).toHaveText('Untitled')
  await shoot(win, 'columns-05-born-note')
})

test('step 5 — the column lives in the settings file, not in the session: it survives quit → relaunch', async () => {
  await quitApp(app) // the REAL quit path: pending autosaves and the state write are flushed

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  // Step 4's newborn took the tab, so the folder is opened again by its row.
  await openFolder(win, folderPath())
  // Which view is active is SESSION state, so the reopened folder is back on its first view.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()

  await expect(headers(contents(win))).toHaveText([...HEADERS, COLUMN_LABEL])
  await expect(dataRows(contents(win))).toHaveCount(MEMBERS.length + 1) // step 4's newborn lives here now
  expect((await settingsOnDisk()).columns?.[COLUMN]).toEqual({ kind: 'number' })
  // …and step 3's value is still in the cell it was typed into.
  await expect(cell(contents(win), 0, 4)).toContainText('42')
  await shoot(win, 'columns-06-survives-relaunch')
})

test('step 6 — a name that is not a property name is refused inline, and nothing is written', async () => {
  // Parsed, not read as bytes: creating step 4's note made this folder a vault the app may
  // give ids in, and an `id` landing on the settings file is not what this step is about.
  const before = await settingsOnDisk()

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

  // Nothing was written: the folder's settings are the ones step 5 read back.
  expect(await settingsOnDisk()).toEqual(before)
  await expect(headers(contents(win))).toHaveText([...HEADERS, COLUMN_LABEL])

  await quitApp(app)
})
