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
 * Then HOME'S BIRTH (6C-, YAZ-849), which the fixture is also the honest shape for: it has no
 * `.yaseendocs/` either, so it is an UN-ADOPTED folder — the app must not write into it —
 * while step 7 adopts a second copy and proves the automatic half.
 *   6 the OFFER: un-adopted + no Home → the card, and one click makes Home (still un-adopted)
 *   7 the AUTO-CREATE: an ADOPTED copy grows its own Home on open, once, never overwritten
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `topics-` step
 * screenshots), with the seed pre-selecting the Topics lens.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
/** 6C (YAZ-849): the dotfolder whose existence IS adoption, and the exact bytes a newborn Home carries. */
const VAULT_CONFIG_DIR = '.yaseendocs'
const HOME = 'Home.md'
const HOME_BYTES = '---\nfolder_page: true\n---\n'

let userData: string
let vault: string
/** Step 7's second copy — the ADOPTED shape (`.yaseendocs/` present), which auto-creates. */
let adoptedVault: string | null = null
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
/** 6C's offer card and its one button. */
const offerCard = (w: Page) => w.locator('.sidebar__body .topics-offer')
const offerButton = (w: Page) => offerCard(w).locator('button')

/** What is on disk at `<vault>/<name>`, or null when it is not there at all. */
const onDisk = (vaultPath: string, name: string): Promise<string | null> => readFile(path.join(vaultPath, name), 'utf8').catch(() => null)

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
  const dirs = [userData, vault, adoptedVault].filter((dir): dir is string => typeof dir === 'string' && dir !== '')
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
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
  // The fixture has no `.yaseendocs/` either, so 6C's card is up from the first frame — above
  // the tree, replacing none of it. Step 6 drives it; here it only has to be true.
  await expect(offerCard(win)).toBeVisible()
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

// ------------------------------------------------- ⚡ the amendment (YAZ-797): the un-adopted offer

test('step 6 — an UN-ADOPTED folder is OFFERED a Home, never given one; one click makes it', async () => {
  // Five steps of real use have gone by and the app has still written no Home into a folder it
  // never adopted — which is the whole rule.
  expect(await onDisk(vault, HOME)).toBeNull()
  expect(await onDisk(vault, `${VAULT_CONFIG_DIR}/properties.json`)).toBeNull()

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(offerCard(win)).toContainText('Your map starts here')
  await expect(offerButton(win)).toHaveText('Create Home')
  // It replaces nothing: the tree the previous steps left is still underneath it.
  await expect(topicLabels(win)).toHaveText(['Funnel Stages', ...MEMBERS, 'Uncategorized'])
  await shoot(win, 'topics-06-offer')

  await offerButton(win).click()
  // Exactly 4B's birth bytes at the vault root — no settings block, no body.
  await expect.poll(() => onDisk(vault, HOME)).toBe(HOME_BYTES)
  // Created AND opened, in the current tab.
  await expect(activeTab(win)).toHaveText('Home')
  // The card retires the moment `[[Home]]` resolves, and the tree roots on it — Home leads,
  // Funnel Stages follows (🔒 D2). No members yet, so no chevron and a count of 0.
  await expect(offerCard(win)).toHaveCount(0)
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, 'Uncategorized'])
  await expect(rowFor(win, 'Home').locator('.tree__count')).toHaveText('0')
  // Making a Home does NOT adopt the folder: the app still owns nothing invisible in here.
  expect(await onDisk(vault, `${VAULT_CONFIG_DIR}/properties.json`)).toBeNull()
  await shoot(win, 'topics-06-home-made')
  await quitApp(app)
})

// ------------------------------------------------------- 🔒 D2: an ADOPTED vault creates its own

test('step 7 — an ADOPTED vault grows its own Home on open: once, unasked, never overwritten', async () => {
  // The same encyclopedia, adopted: `.yaseendocs/` exists, so this vault has said yes already.
  adoptedVault = await copyVault(FIXTURE)
  await mkdir(path.join(adoptedVault, VAULT_CONFIG_DIR), { recursive: true })
  expect(await onDisk(adoptedVault, HOME)).toBeNull()

  app = await launchApp({ userData, seedState: topicsState(adoptedVault, null) })
  win = await appWindow(app, 'w1')
  // Nobody clicked anything: Home is simply there, carrying exactly the flag.
  await expect.poll(() => onDisk(adoptedVault as string, HOME)).toBe(HOME_BYTES)
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'Uncategorized'])
  await expect(offerCard(win)).toHaveCount(0) // an adopted vault is never offered
  await shoot(win, 'topics-07-auto-created')
  await quitApp(app)

  // IDEMPOTENT: the user makes it their own, and reopening the vault never recreates or
  // overwrites it — the resolver finds a Home, so nothing is written.
  const mine = `${HOME_BYTES}\n# My map\n\nmy own words\n`
  await writeFile(path.join(adoptedVault, HOME), mine)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'Uncategorized'])
  expect(await onDisk(adoptedVault, HOME)).toBe(mine)
  await quitApp(app)
})
