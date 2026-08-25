/**
 * The Topics tree (6B-, YAZ-848) end-to-end against the REAL app: the sidebar's Topics lens is
 * the folder-page tree — browsing the vault by MEANING rather than by the folders on disk.
 *
 * Driven over the committed encyclopedia (`fixtures/bible-vault`), which is deliberately the
 * NO-HOME shape: there is no `Home.md` at all, so the roots rule (🔒 D2) falls through to "every
 * folder page nobody claims" and stands `Funnel Stages` up on its own. Its three members live in
 * a `funnel-stages/` folder on disk that the tree never mentions — that is the whole point of the
 * lens — and everything else in the fixture belongs nowhere yet, so it waits under Uncategorized.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the roots: Funnel Stages alone, with the glyph and its direct-member count, collapsed
 *   2 the chevron nests its three members, in the [D5] order, indented one rung
 *   3 a row click OPENS the page (the file tree's own handler), and the chevron never does
 *   4 the expansion survives quit → relaunch, in the main-owned `folders[root].topicsExpanded`
 *     bucket — PAGE PATHS, never written into any note's frontmatter
 *   5 Uncategorized expands IN PLACE (🔒 D7, the locked deviation from the mockup), listing the
 *     orphans and subtracting both the root already on screen and everyone already nested
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `topics-` step
 * screenshots), with the seed pre-selecting the Topics lens.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'Funnel Stages.md'
/** Its members, alphabetically — the [D5] fallback, since the fixture declares no outline `order`. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
/** Everything in the fixture that says it belongs nowhere: 2 industries + 5 kpis + 4 problems + 3 roles. */
const ORPHAN_COUNT = 14

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators ----------

const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
/** Every row the topic tree renders, in document order. */
const topicRows = (w: Page) => w.locator('.sidebar__body .tree__row')
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
const rowFor = (w: Page, label: string) => topicRows(w).filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const chevron = (w: Page, action: 'Expand' | 'Collapse', label: string) => w.locator(`.sidebar__body [aria-label="${action} ${label}"]`)
const uncategorizedRow = (w: Page) => w.locator('.sidebar__body .tree__row--muted')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')

/** `seededState` pre-selects the FILES lens for the rest of the suite; this spec is about Topics. */
function topicsState(vaultPath: string, file: string | null) {
  const state = seededState(vaultPath, file)
  state.sidebarLens = 'topics'
  return state
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'topics-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- 🔒 D2: the roots

test('step 1 — the no-Home shape: Funnel Stages stands as a root, glyphed and counted, collapsed', async () => {
  app = await launchApp({ userData, seedState: topicsState(vault, path.join(vault, FOLDER_PAGE)) })
  win = await appWindow(app, 'w1')

  await expect(lensTab(win, 'Topics')).toHaveAttribute('aria-selected', 'true')
  // No `Home.md` in this vault, so no Home row — and the rest of the rule still stands the one
  // unclaimed folder page up. Collapsed by default: the tree is exactly two rows.
  await expect(topicLabels(win)).toHaveText(['Funnel Stages', 'Uncategorized'])
  const root = rowFor(win, 'Funnel Stages')
  await expect(root.locator('.tree__glyph')).toBeVisible() // 🔒 D3: folder pages wear the base glyph
  await expect(root.locator('.tree__count')).toHaveText('3') // …and their DIRECT-member count
  // The disk folder `funnel-stages/` is nowhere here — that shape belongs to the other tab.
  // (Folder-page rows wear `.tree__row--dir` themselves: same class family, same colour.)
  await expect(rowFor(win, 'funnel-stages')).toHaveCount(0)
  await expect(win.locator('.sidebar__body .tree__row--file')).toHaveCount(0)
  await shoot(win, 'topics-01-roots')
})

// ---------------------------------------------------------------- ⚡ D6 + [D5]: the descent

test('step 2 — the chevron nests the three members, in the [D5] order, one rung in', async () => {
  await chevron(win, 'Expand', 'Funnel Stages').click()
  await expect(topicLabels(win)).toHaveText(['Funnel Stages', ...MEMBERS, 'Uncategorized'])
  await expect(rowFor(win, 'Funnel Stages').locator('.tree__chevron--open')).toHaveCount(1)
  // 8 + depth * 14, the file tree's own indent: the root at 8, its members at 22.
  await expect(rowFor(win, 'Funnel Stages')).toHaveCSS('padding-left', '8px')
  await expect(rowFor(win, 'Lead Gen')).toHaveCSS('padding-left', '22px')
  // Leaves: no glyph, no count, nothing to expand.
  await expect(rowFor(win, 'Lead Gen').locator('.tree__glyph')).toHaveCount(0)
  await expect(rowFor(win, 'Lead Gen').locator('.tree__count')).toHaveCount(0)
  await expect(chevron(win, 'Expand', 'Lead Gen')).toHaveCount(0)
  await shoot(win, 'topics-02-nested-members')
})

// ---------------------------------------------------------------- 🔒 D3: the row gestures

test('step 3 — a row click OPENS the page; the chevron only ever expands', async () => {
  await rowFor(win, 'Lead Nurture').click()
  await expect(activeTab(win)).toHaveText('Lead Nurture')
  await expect(editorOf(win)).toContainText('Lead Nurture')

  // The chevron is its own hit target: collapsing does not open Funnel Stages over the tab above.
  await chevron(win, 'Collapse', 'Funnel Stages').click()
  await expect(topicLabels(win)).toHaveText(['Funnel Stages', 'Uncategorized'])
  await expect(activeTab(win)).toHaveText('Lead Nurture')
  await chevron(win, 'Expand', 'Funnel Stages').click()
  await expect(topicLabels(win)).toHaveText(['Funnel Stages', ...MEMBERS, 'Uncategorized'])
  await shoot(win, 'topics-03-row-opens')
})

// ---------------------------------------------------------------- 🔒 D4: persistence

test('step 4 — the expansion survives quit → relaunch, as PAGE PATHS in the app state', async () => {
  const folderPagePath = path.join(vault, FOLDER_PAGE)
  await expect.poll(async () => (await readState(userData)).folders?.[vault]?.topicsExpanded).toEqual([folderPagePath])

  await quitApp(app)
  expect((await readState(userData)).folders[vault].topicsExpanded).toEqual([folderPagePath])
  // Session chrome, exactly like the `baseGroups` bucket: nothing about it reaches the page.
  expect(await readFile(folderPagePath, 'utf8')).not.toContain('topicsExpanded')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(topicLabels(win)).toHaveText(['Funnel Stages', ...MEMBERS, 'Uncategorized'])
  await shoot(win, 'topics-04-expansion-restored')
})

// ---------------------------------------------------------------- 🔒 D7: Uncategorized

test('step 5 — Uncategorized expands IN PLACE, subtracting the root and everyone nested', async () => {
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText(String(ORPHAN_COUNT))
  await expect(uncategorizedRow(win).locator('.tree__chevron--open')).toHaveCount(0)
  await uncategorizedRow(win).click()
  await expect(uncategorizedRow(win).locator('.tree__chevron--open')).toHaveCount(1) // the chevron turns with it
  await expect(topicRows(win)).toHaveCount(2 + MEMBERS.length + ORPHAN_COUNT)
  // An orphan is listed…
  await expect(rowFor(win, 'CAC')).toHaveCount(1)
  // …the folder page already standing as a root is NOT (this surface's own subtraction), and
  // neither is anyone already nested under it.
  await expect(rowFor(win, 'Funnel Stages')).toHaveCount(1) // the root row only
  await expect(rowFor(win, 'Lead Gen')).toHaveCount(1) // the nested row only
  await shoot(win, 'topics-05-uncategorized')

  // It never becomes a page: clicking an orphan opens the ORPHAN, and there is no Uncategorized tab.
  await rowFor(win, 'CAC').click()
  await expect(activeTab(win)).toHaveText('CAC')
  await uncategorizedRow(win).click() // …and it collapses back in place
  await expect(topicLabels(win)).toHaveText(['Funnel Stages', ...MEMBERS, 'Uncategorized'])
  await quitApp(app)
})
