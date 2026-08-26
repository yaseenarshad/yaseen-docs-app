/**
 * The Topics tree (6B-, YAZ-848) end-to-end against the REAL app: the sidebar's Topics lens is
 * the folder-page tree — browsing the vault by MEANING rather than by the folders on disk.
 *
 * Driven over the committed encyclopedia (`fixtures/bible-vault`), which since 7C- is a MIGRATED
 * vault: `tools/migrateFolderPages.mjs` turned its five `page_type` values into five folder pages
 * and gave them a `Home` to hang from, so the roots rule (🔒 D2) resolves `[[Home]]` and the whole
 * encyclopedia descends from ONE row. The disk still has `funnel-stages/`, `kpis/`, `problems/`,
 * `roles/`, `industries/` and `inbox/`; this lens never mentions any of them — that is the point.
 * The two `inbox/` notes carry no `folder_pages` entry at all and wait under Uncategorized.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the roots: Home alone, with the glyph and its direct-member count, collapsed
 *   2 the chevrons descend two rungs — Home's five folder pages in Home's own `order`, then
 *     Funnel Stages' three members in the [D5] fallback — each indented one rung further
 *   3 a row click OPENS the page (the file tree's own handler), and the chevron never does
 *   4 the expansion survives quit → relaunch, in the main-owned `folders[root].topicsExpanded`
 *     bucket — PAGE PATHS, never written into any note's frontmatter
 *   5 Uncategorized expands IN PLACE (🔒 D7, the locked deviation from the mockup), listing the
 *     two unfiled notes and subtracting both the root already on screen and everyone nested
 *
 * Then HOME'S BIRTH (6C-, YAZ-849). The migrated fixture HAS a Home, so both steps below run over
 * a copy with `Home.md` deleted — a vault full of folder pages that answers `[[Home]]` with
 * nothing, which is exactly the shape 6C exists for.
 *   6 the OFFER: un-adopted + no Home → the card, and one click makes Home — whereupon the five
 *     orphaned topics stop being roots and snap underneath it
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

/** The committed encyclopedia, post-migration. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const HOME = 'Home.md'
const FOLDER_PAGE = 'Funnel Stages.md'
/** Home's members, in the `order` the migration wrote onto Home's outline view. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
/** Their direct-member counts, in the same order — the whole migrated map, on one line. */
const TOPIC_COUNTS = ['3', '2', '5', '4', '3']
/** Funnel Stages' members, alphabetically — the [D5] fallback, since it declares no outline `order`. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
/** The only two pages in the migrated fixture that belong nowhere: `inbox/`, deliberately unfiled. */
const ORPHANS = ['Pipeline Review Notes', 'Positioning Draft']
/** 6C (YAZ-849): the dotfolder whose existence IS adoption, and the exact bytes a newborn Home carries. */
const VAULT_CONFIG_DIR = '.yaseendocs'
const HOME_BYTES = '---\nfolder_page: true\n---\n'

let userData: string
let vault: string
/** Every temp vault this file made, torn down together. */
const vaults: string[] = []
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

/** A copy of the encyclopedia with its Home deleted: folder pages everywhere, `[[Home]]` answering nothing. */
async function homelessVault(): Promise<string> {
  const dir = await copyVault(FIXTURE)
  vaults.push(dir)
  await rm(path.join(dir, HOME))
  return dir
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'topics-userdata-'))
  vault = await copyVault(FIXTURE)
  vaults.push(vault)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, ...vaults].map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- 🔒 D2: the roots

test('step 1 — the migrated shape: Home stands alone as the root, glyphed and counted, collapsed', async () => {
  app = await launchApp({ userData, seedState: topicsState(vault, path.join(vault, HOME)) })
  win = await appWindow(app, 'w1')

  await expect(lensTab(win, 'Topics')).toHaveAttribute('aria-selected', 'true')
  // `[[Home]]` resolves and carries the flag, so it leads — and the five folder pages the
  // migration created all say they belong to it, so NONE of them is a root of its own. Collapsed
  // by default: the whole encyclopedia is two rows.
  await expect(topicLabels(win)).toHaveText(['Home', 'Uncategorized'])
  const root = rowFor(win, 'Home')
  await expect(root.locator('.tree__glyph')).toBeVisible() // 🔒 D3: folder pages wear the folder-page glyph
  await expect(root.locator('.tree__count')).toHaveText('5') // …and their DIRECT-member count
  // The folders on disk are nowhere here — that shape belongs to the other tab.
  // (Folder-page rows wear `.tree__row--dir` themselves: same class family, same colour.)
  await expect(rowFor(win, 'funnel-stages')).toHaveCount(0)
  await expect(rowFor(win, 'inbox')).toHaveCount(0)
  await expect(win.locator('.sidebar__body .tree__row--file')).toHaveCount(0)
  // A vault that already answers `[[Home]]` is never offered one, adopted or not (the fixture has
  // no `.yaseendocs/`, so this is the offer's LIVE half deciding, not the adoption half).
  await expect(offerCard(win)).toHaveCount(0)
  await shoot(win, 'topics-01-roots')
})

// ---------------------------------------------------------------- ⚡ D6 + [D5]: the descent

test('step 2 — the chevrons descend two rungs: Home’s order, then the [D5] fallback', async () => {
  await chevron(win, 'Expand', 'Home').click()
  // Home's own outline `order` — written by the migration, not alphabetical (Funnel Stages leads).
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await expect(win.locator('.sidebar__body .tree__count')).toHaveText(['5', ...TOPIC_COUNTS, String(ORPHANS.length)])

  await chevron(win, 'Expand', 'Funnel Stages').click()
  // Funnel Stages declares no `order`, so its members fall through to alphabetical, one rung in.
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
  await expect(rowFor(win, 'Funnel Stages').locator('.tree__chevron--open')).toHaveCount(1)
  // 8 + depth * 14, the file tree's own indent: the root at 8, its topics at 22, their pages at 36.
  await expect(rowFor(win, 'Home')).toHaveCSS('padding-left', '8px')
  await expect(rowFor(win, 'Funnel Stages')).toHaveCSS('padding-left', '22px')
  await expect(rowFor(win, 'Lead Gen')).toHaveCSS('padding-left', '36px')
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

  // The chevron is its own hit target: collapsing does not open Home over the tab above.
  await chevron(win, 'Collapse', 'Home').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Uncategorized'])
  await expect(activeTab(win)).toHaveText('Lead Nurture')
  // 🔒 D4: expansion is keyed by PAGE, not by tree position — so Funnel Stages comes back open.
  await chevron(win, 'Expand', 'Home').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
  await shoot(win, 'topics-03-row-opens')
})

// ---------------------------------------------------------------- 🔒 D4: persistence

test('step 4 — the expansion survives quit → relaunch, as PAGE PATHS in the app state', async () => {
  const open = [path.join(vault, HOME), path.join(vault, FOLDER_PAGE)]
  // A Set, so the bucket's ORDER is whatever the last toggle left (step 3 re-added Home): the
  // durable claim is the membership, which is what the tree is rebuilt from.
  const stored = async () => [...((await readState(userData)).folders?.[vault]?.topicsExpanded ?? [])].sort()
  await expect.poll(stored).toEqual([...open].sort())

  await quitApp(app)
  expect(await stored()).toEqual([...open].sort())
  // Session chrome, exactly like the `baseGroups` bucket: nothing about it reaches the page.
  expect(await readFile(open[1], 'utf8')).not.toContain('topicsExpanded')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
  await shoot(win, 'topics-04-expansion-restored')
})

// ---------------------------------------------------------------- 🔒 D7: Uncategorized

test('step 5 — Uncategorized expands IN PLACE, subtracting the root and everyone nested', async () => {
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText(String(ORPHANS.length))
  await expect(uncategorizedRow(win).locator('.tree__chevron--open')).toHaveCount(0)
  await uncategorizedRow(win).click()
  await expect(uncategorizedRow(win).locator('.tree__chevron--open')).toHaveCount(1) // the chevron turns with it
  // The two unfiled notes, and nothing else: one carries frontmatter without a `folder_pages`
  // entry, the other carries none at all — belonging is an entry, never an inference from disk.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    ...MEMBERS,
    ...TOPICS.slice(1),
    'Uncategorized',
    ...ORPHANS,
  ])
  // The folder page already standing as a root is NOT listed (this surface's own subtraction),
  // and neither is anyone already nested under it.
  await expect(rowFor(win, 'Home')).toHaveCount(1) // the root row only
  await expect(rowFor(win, 'Lead Gen')).toHaveCount(1) // the nested row only
  await shoot(win, 'topics-05-uncategorized')

  // It never becomes a page: clicking an orphan opens the ORPHAN, and there is no Uncategorized tab.
  await rowFor(win, ORPHANS[0]).click()
  await expect(activeTab(win)).toHaveText(ORPHANS[0])
  await uncategorizedRow(win).click() // …and it collapses back in place
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
})

// ------------------------------------------- ⚡ the amendment (YAZ-865): the row menu is the file tree's

test('step 5b — a member row carries the FILE tree’s own menu, and Delete trashes the page', async () => {
  // The amendment on YAZ-821 (ruled by Yasin): Topics rows get the SAME right-click menu file
  // rows get. The unit tests pin the whole item list and every target; what only the real app
  // can prove is the DELETE landing — the sheet, the row leaving the MEANING tree, and the file
  // actually leaving the vault (delete.spec.ts's own assertions, from the other lens).
  const doomed = path.join(vault, 'funnel-stages', 'Lead Nurture.md')
  await rowFor(win, 'Lead Nurture').click({ button: 'right' })
  const item = (label: string) => win.locator('.ctx-menu [role="menuitem"]', { hasText: label })
  await expect(item('Reveal in Finder')).toHaveCount(1)
  await expect(item('Copy path')).toHaveCount(1)
  await expect(item('Turn into folder page')).toHaveCount(1) // state-aware: a LEAF gets the forward label
  await shoot(win, 'topics-05b-row-menu')

  await item('Delete').click()
  await expect(win.locator('.confirm')).toContainText('Delete "Lead Nurture.md"?')
  await win.locator('.confirm__btn', { hasText: 'Delete' }).click()
  // Gone from the vault (where it went — the Trash — is not this spec's business, delete.spec.ts
  // says so) AND gone from the tree, which is the whole point: one delete, both readings.
  await expect.poll(() => readFile(doomed, 'utf8').then(() => false, () => true)).toBe(true)
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'Lead Gen', 'Sales-Conversion', ...TOPICS.slice(1), 'Uncategorized'])
  await shoot(win, 'topics-05b-deleted')
  await quitApp(app)
})

// ------------------------------------------------- ⚡ the amendment (YAZ-797): the un-adopted offer

test('step 6 — an UN-ADOPTED folder is OFFERED a Home, never given one; one click makes it', async () => {
  const homeless = await homelessVault()
  expect(await onDisk(homeless, HOME)).toBeNull()
  expect(await onDisk(homeless, `${VAULT_CONFIG_DIR}/properties.json`)).toBeNull()

  app = await launchApp({ userData, seedState: topicsState(homeless, null) })
  win = await appWindow(app, 'w1')
  await expect(offerCard(win)).toContainText('Your map starts here')
  await expect(offerButton(win)).toHaveText('Create Home')
  // It replaces nothing: with `[[Home]]` answering nothing, the five folder pages have no parents
  // of their own, so the roots rule stands every one of them up — path-sorted — underneath the card.
  await expect(topicLabels(win)).toHaveText([...TOPICS, 'Uncategorized'])
  await shoot(win, 'topics-06-offer')

  await offerButton(win).click()
  // Exactly 4B's birth bytes at the vault root — no settings block, no body.
  await expect.poll(() => onDisk(homeless, HOME)).toBe(HOME_BYTES)
  // Created AND opened, in the current tab.
  await expect(activeTab(win)).toHaveText('Home')
  // The card retires the moment `[[Home]]` resolves — and the five topics stop being roots in the
  // same breath, because their own `folder_pages: ["[[Home]]"]` now lands somewhere.
  await expect(offerCard(win)).toHaveCount(0)
  await expect(topicLabels(win)).toHaveText(['Home', 'Uncategorized'])
  await expect(rowFor(win, 'Home').locator('.tree__count')).toHaveText('5')
  // Making a Home does NOT adopt the folder: the app still owns nothing invisible in here.
  expect(await onDisk(homeless, `${VAULT_CONFIG_DIR}/properties.json`)).toBeNull()
  await shoot(win, 'topics-06-home-made')
  await quitApp(app)
})

// ------------------------------------------------------- 🔒 D2: an ADOPTED vault creates its own

test('step 7 — an ADOPTED vault grows its own Home on open: once, unasked, never overwritten', async () => {
  // The same encyclopedia minus its Home, adopted: `.yaseendocs/` exists, so it has said yes already.
  const adopted = await homelessVault()
  await mkdir(path.join(adopted, VAULT_CONFIG_DIR), { recursive: true })
  expect(await onDisk(adopted, HOME)).toBeNull()

  app = await launchApp({ userData, seedState: topicsState(adopted, null) })
  win = await appWindow(app, 'w1')
  // Nobody clicked anything: Home is simply there, carrying exactly the flag, with the whole
  // encyclopedia already hanging off it.
  await expect.poll(() => onDisk(adopted, HOME)).toBe(HOME_BYTES)
  await expect(topicLabels(win)).toHaveText(['Home', 'Uncategorized'])
  await expect(offerCard(win)).toHaveCount(0) // an adopted vault is never offered
  await shoot(win, 'topics-07-auto-created')
  await quitApp(app)

  // IDEMPOTENT: the user makes it their own, and reopening the vault never recreates or
  // overwrites it — the resolver finds a Home, so nothing is written.
  const mine = `${HOME_BYTES}\n# My map\n\nmy own words\n`
  await writeFile(path.join(adopted, HOME), mine)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(topicLabels(win)).toHaveText(['Home', 'Uncategorized'])
  expect(await onDisk(adopted, HOME)).toBe(mine)
  await quitApp(app)
})
