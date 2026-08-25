/**
 * Folder pages, end to end (YAZ-819; 🔒 D1/D2/D3 of YAZ-818): a page flagged `folder_page: true`
 * carries its CONTENTS below its own body — today's fully interactive bases table, fed the pages
 * that belong to it, columns from the folder page's own settings.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`),
 * which gained exactly one folder page (`Funnel Stages.md`) and one `folder_pages` entry on each
 * of the three funnel-stage pages — the smallest extension that makes the model real.
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
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `folder-` step
 * screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

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
const viewTabs = (scope: Locator) => scope.locator('.base-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.base-table tbody tr:not(.base-table__group):not(.base-table__spacer)')
/** Row names, whichever body renders: the unknown-view placeholder list, or the real table. */
const rowNames = (scope: Locator) => scope.locator('.base-row__link, .base-table__link')
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
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

  // Q7: the folder page's two skins, outline FIRST — 5.2 builds that renderer, so today it is
  // the placeholder row list, and the tabs still switch.
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table'])
  await expect(rowNames(contents(win))).toHaveText(named(...MEMBERS))
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
  const input = win.locator('.base-cell-edit__input')
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
  const input = win.locator('.base-cell-edit__input')
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
  await expect(rowNames(contents(win))).toHaveText(named('Lead Gen', 'Lead Nurture', 'Sales-Conversion', 'Untitled'))
  await shoot(win, 'folder-06-new-member-row')

  await quitApp(app)
})
