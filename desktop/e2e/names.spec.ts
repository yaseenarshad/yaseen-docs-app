/**
 * Titles, ids and file names (YAZ-2420) end-to-end against the REAL app, on a vault that starts
 * empty: a note's title is `title:` in the note, its id is `id:`, and its file name is built by the
 * app as `<kebab-title>-<id>.md`.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 a note made in the app is born with its id, its title and its built name; every screen shows the title
 *   2 a title edit from the page heading writes the title and renames the file; the id stays
 *   3 the sidebar's rename edits the title; a hand-typed `[[Old title]]` follows it
 *   4 a title that builds the same name changes the title line only
 *   5 a file made outside the app keeps its name until its title is edited in the app
 *   6 a `title:` edited by hand shows at once and renames nothing
 *   7 a folder is its title in kebab-case, with its title in `.folder.md`
 *   8 a copy is its own note: a fresh id, `<title> copy`, its own name
 *   9 the search box finds a note by its id, and by an old path that holds it
 *  10 a row's menu has one copy item
 *  11 a table's Name cell is text: a click selects, a double-click edits the title
 *
 * Same harness as rename.spec.ts (temp `--user-data-dir`, a temp vault, `names-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NOTE_ID as ID, activeTab, appWindow, confirmSheet, contents, dirRow, fileRow, idOf, launchApp, layer, menuItem, only, openFolder, quitApp, seededState, shoot, tabsOf, titleOf } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const title = (w: Page) => layer(w).locator('.page-title__text')
const titleInput = (w: Page) => layer(w).locator('.page-title__input')
const inline = (w: Page) => w.locator('.create-inline__input')
const searchBar = (w: Page) => w.locator('[aria-label="Search notes"]')
const results = (w: Page) => w.locator('[aria-label="Search results"] [role="option"]')

const read = (p: string) => readFile(p, 'utf8').catch(() => '')

/** A name change asks first (YAZ-888); confirm it when it does. */
async function confirmIfAsked(w: Page): Promise<void> {
  const ask = confirmSheet(w)
  // The sheet opens a moment after Enter (the door counts links first), or not at all.
  await ask.waitFor({ state: 'visible', timeout: 1500 }).then(() => ask.locator('.confirm__btn', { hasText: 'Rename' }).click(), () => undefined)
  await expect(ask).toHaveCount(0)
}

/** "New note" / "New folder" from the sidebar's blank-space menu, typed and committed. */
async function create(w: Page, item: 'New note' | 'New folder', typed: string): Promise<void> {
  await w.locator('.sidebar__body').click({ button: 'right', position: { x: 40, y: 500 } })
  await menuItem(w, item).click()
  await inline(w).fill(typed)
  await w.keyboard.press('Enter')
}

async function renameRow(w: Page, row: ReturnType<typeof fileRow>, prefill: string, typed: string): Promise<void> {
  await row.click({ button: 'right' })
  await menuItem(w, 'Rename').click()
  await expect(inline(w)).toHaveValue(prefill)
  await inline(w).fill(typed)
  await w.keyboard.press('Enter')
  await confirmIfAsked(w)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'names-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'names-vault-'))
  // Made outside the app: a note that links by NAME, and a note with no frontmatter at all.
  await writeFile(path.join(vault, 'Index.md'), 'See [[Guide]] here.\n')
  await writeFile(path.join(vault, 'Plan.md'), 'plan-body\n')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

let guide = ''
let guideId = ''

test('step 1 — a note made in the app is born with its id, its title and its built name', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Index')).toBeVisible()

  await create(win, 'New note', 'Guide')
  await expect.poll(() => only(vault, new RegExp(`^guide-${ID}\\.md$`))).not.toBe('')
  guide = await only(vault, new RegExp(`^guide-${ID}\\.md$`))
  const content = await read(path.join(vault, guide))
  guideId = idOf(content)
  expect(guide).toBe(`guide-${guideId}.md`)
  expect(titleOf(content)).toBe('Guide')

  // Every screen shows the title, never the file name.
  await expect(fileRow(win, 'Guide')).toBeVisible()
  await expect(activeTab(win)).toHaveText('Guide')
  await expect(title(win)).toHaveText('Guide')
  await shoot(win, 'names-01-born')
})

test('step 2 — a title edit from the page heading writes the title and renames the file; the id stays', async () => {
  await title(win).click()
  await expect(titleInput(win)).toHaveValue('Guide')
  await titleInput(win).fill('What/Why: the "Handbook"?')
  await win.keyboard.press('Enter')
  await confirmIfAsked(win)

  const built = `what-why-the-handbook-${guideId}.md`
  await expect.poll(() => read(path.join(vault, built)).then(titleOf)).toContain('Handbook')
  expect(await only(vault, new RegExp(`${guideId}\\.md$`))).toBe(built)
  expect(idOf(await read(path.join(vault, built)))).toBe(guideId)
  await expect(title(win)).toHaveText('What/Why: the "Handbook"?')
  await expect(activeTab(win)).toHaveText('What/Why: the "Handbook"?')
  // The hand-typed name link followed the title, in the note made outside the app.
  await expect.poll(() => read(path.join(vault, 'Index.md'))).not.toContain('[[Guide]]')
  guide = built
  await shoot(win, 'names-02-heading-retitle')
})

test('step 3 — the sidebar rename edits the title', async () => {
  await renameRow(win, fileRow(win, 'What/Why: the "Handbook"\\?'), 'What/Why: the "Handbook"?', 'Handbook')
  const built = `handbook-${guideId}.md`
  await expect.poll(() => read(path.join(vault, built)).then(titleOf)).toBe('Handbook')
  await expect(fileRow(win, 'Handbook')).toBeVisible()
  guide = built
})

test('step 4 — a title that builds the same name changes the title line only', async () => {
  await renameRow(win, fileRow(win, 'Handbook'), 'Handbook', 'HANDBOOK!')
  await expect.poll(() => read(path.join(vault, guide)).then(titleOf)).toBe('HANDBOOK!')
  expect(await only(vault, new RegExp(`${guideId}\\.md$`))).toBe(guide)
  await expect(fileRow(win, 'HANDBOOK!')).toBeVisible()
})

test('step 5 — a file made outside the app keeps its name until its title is edited in the app', async () => {
  // Making a note adopted the vault, so the app gave the outside file its id; its name is untouched.
  await expect.poll(() => read(path.join(vault, 'Plan.md')).then(idOf)).toMatch(new RegExp(`^${ID}$`))
  const planId = idOf(await read(path.join(vault, 'Plan.md')))
  await expect(fileRow(win, 'Plan')).toBeVisible()

  await renameRow(win, fileRow(win, 'Plan'), 'Plan', 'The Plan')
  const built = `the-plan-${planId}.md`
  await expect.poll(() => read(path.join(vault, built)).then(titleOf)).toBe('The Plan')
  expect(await read(path.join(vault, 'Plan.md'))).toBe('')
  expect(await read(path.join(vault, built))).toContain('plan-body')
  await shoot(win, 'names-05-outside-file')
})

test('step 6 — a title edited by hand shows at once and renames nothing', async () => {
  const file = path.join(vault, guide)
  await writeFile(file, (await read(file)).replace(/^title: .*$/m, 'title: Hand Edited'))
  await expect(fileRow(win, 'Hand Edited')).toBeVisible()
  expect(await only(vault, new RegExp(`${guideId}\\.md$`))).toBe(guide)
})

test('step 7 — a folder is its title in kebab-case, with its title in .folder.md', async () => {
  await create(win, 'New folder', 'Upwork 2026')
  const settings = path.join(vault, 'upwork-2026', '.folder.md')
  await expect.poll(() => read(settings).then(titleOf)).toBe('Upwork 2026')
  expect(idOf(await read(settings))).toMatch(new RegExp(`^${ID}$`))
  await expect(dirRow(win, 'Upwork 2026')).toBeVisible()

  await renameRow(win, dirRow(win, 'Upwork 2026'), 'Upwork 2026', 'Hiring: 2026')
  await expect.poll(() => read(path.join(vault, 'hiring-2026', '.folder.md')).then(titleOf)).toBe('Hiring: 2026')
  await expect(dirRow(win, 'Hiring: 2026')).toBeVisible()
  await shoot(win, 'names-07-folder')
})

test('step 8 — a copy is its own note: a fresh id, its title with copy, its own name', async () => {
  await fileRow(win, 'Hand Edited').click({ button: 'right' })
  await win.locator('.ctx-menu').getByRole('menuitem', { name: /^Copy(?: ⌘\S*)?$/ }).click()
  await win.locator('.sidebar__body').click({ button: 'right', position: { x: 40, y: 500 } })
  await win.locator('.ctx-menu').getByRole('menuitem', { name: /^Paste 1 item/ }).click()

  await expect.poll(() => only(vault, new RegExp(`^hand-edited-copy-${ID}\\.md$`))).not.toBe('')
  const copy = await only(vault, new RegExp(`^hand-edited-copy-${ID}\\.md$`))
  const content = await read(path.join(vault, copy))
  expect(titleOf(content)).toBe('Hand Edited copy')
  expect(idOf(content)).not.toBe(guideId)
  expect(copy).toBe(`hand-edited-copy-${idOf(content)}.md`)
  await expect(fileRow(win, 'Hand Edited copy')).toBeVisible()
})

test('step 9 — the search box finds a note by its id, and by an old path that holds it', async () => {
  await searchBar(win).fill(guideId)
  await expect(results(win)).toHaveText(['Hand Edited'])
  // A path copied before the retitles: the file name is stale, the id in it is not.
  await searchBar(win).fill(path.join(vault, `guide-${guideId}.md`))
  await expect(results(win)).toHaveText(['Hand Edited'])
  await searchBar(win).fill(guideId.slice(0, 5))
  await expect(results(win)).toHaveCount(0)
  await shoot(win, 'names-09-search-by-id')
  await searchBar(win).fill('')
})

test('step 10 — a row menu has one copy item', async () => {
  await fileRow(win, 'Hand Edited').click({ button: 'right' })
  await expect(menuItem(win, 'Copy path')).toBeVisible()
  await expect(menuItem(win, 'Copy ID')).toHaveCount(0)
  await expect(menuItem(win, 'Copy for Agent')).toHaveCount(0)
  await win.keyboard.press('Escape')
})

test('step 11 — a table Name cell is text: a click selects, a double-click edits the title', async () => {
  const dir = path.join(vault, 'hiring-2026')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'candidate-k3m9x2pq7abc.md'), '---\nid: k3m9x2pq7abc\ntitle: Candidate One\n---\nbody\n')
  await expect(dirRow(win, 'Hiring: 2026')).toBeVisible()
  await openFolder(win, dir)
  const cell = contents(win).locator('.view-table__name', { hasText: 'Candidate One' })
  await expect(cell).toBeVisible()
  const tabs = await tabsOf(win).count()

  await cell.click()
  await expect(tabsOf(win)).toHaveCount(tabs) // a click selects; it opens nothing
  await expect(contents(win)).toBeVisible()

  await cell.dblclick()
  await contents(win).locator('.view-cell-edit__input').fill('Candidate Uno')
  await win.keyboard.press('Enter')
  await confirmIfAsked(win)
  await expect.poll(() => read(path.join(dir, 'candidate-uno-k3m9x2pq7abc.md')).then(titleOf)).toBe('Candidate Uno')
  await expect(contents(win).locator('.view-table__name', { hasText: 'Candidate Uno' })).toBeVisible()
  await shoot(win, 'names-11-table')
  await quitApp(app)
})
