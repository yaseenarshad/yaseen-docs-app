/**
 * Search E (YAZ-805): the ⌘K search feature driven end-to-end through the REAL app — the
 * persistent sidebar bar (YAZ-801), the search TREE that replaces the active tab's tree while a
 * query is typed (YAZ-2620: the Files tree cut down to the matches and their parent folders) and
 * the title/alias ranking behind it (YAZ-802), over a COPY of the committed encyclopedia fixture
 * (`fixtures/bible-vault`) plus ONE seeded note that makes the ranking and the alias deterministic.
 *
 * That seeded note is `Nurture.md` at the vault root, aliased `Zephyr Codename`. It turns the
 * query "Nurture" into one match of each rank bucket — exact `Nurture`, prefix `Nurture
 * Sequencing`, substring `Lead Nurture` — in three places of the tree: the root, `Problems/` and
 * `Funnel Stages/`. The tree draws the exact match LAST, which is the only way this fixture can
 * PROVE that the highlight starts on the best match and not on the top row.
 *
 * The ⌘K accelerator itself is NOT driven here: a native menu accelerator cannot be fired from
 * Playwright (`keyboard.press('Meta+K')` silently does nothing), so the shortcut is pinned by
 * `desktop/src/main/menu.test.ts` and a recorded human check on YAZ-804. Everything below is
 * the DOM the accelerator lands on.
 *
 * Serial by design (the suite's idiom): each step continues the previous state, and every step
 * starts from `closeAllTabs` + an empty query so the one before it cannot colour it.
 */
// Rewritten for YAZ-2290 (folders are the pages) and again for YAZ-2620 (the results are a tree). Not yet run:
// Playwright was off limits both times, so every selector here was read from the source, not observed. Run it
// once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, copyVault, dirRow, editorOf, expandDirs, fileRow, launchApp, quitApp, seededState, shoot, tabsOf } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia — copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')

/** The seeded note (see the module doc): the exact hit for "Nurture", and the ONE alias in the vault. */
const SEEDED = 'Nurture.md'
const SEEDED_BODY = 'search-seeded-nurture-body'
const ALIAS = 'Zephyr Codename'

/** Bodies of the fixture pages the steps land on. */
const SEQUENCING_BODY = 'Contacts stall between'
const CEO_BODY = 'Signs off on anything'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (the suite's shared idioms) ----------

const treeRows = (w: Page) => w.locator('.tree__row')

const searchBar = (w: Page) => w.locator('[aria-label="Search notes"]')
/** A result is a tree row (YAZ-2620): a MATCH, or — dim — a row that only gives a match its place. */
const matchLabels = (w: Page) => w.locator('.sidebar__body .tree__row:not(.tree__row--context) .tree__label')
const parentLabels = (w: Page) => w.locator('.sidebar__body .tree__row--context .tree__label')
/** The typed text, bold where it sits in a match. */
const marks = (w: Page) => w.locator('.sidebar__body .tree__mark')

// ---------- gestures ----------

/**
 * Closes every open tab, leaving the empty state (the easyWave idiom), then empties the query.
 * Always the ACTIVE tab's ✕: an inactive tab only reveals its close button on hover (tabs.css).
 */
async function reset(w: Page): Promise<void> {
  for (;;) {
    const n = await tabsOf(w).count()
    if (n === 0) break
    await w.locator('.tabbar__tab--active .tabbar__close').click()
    await expect(tabsOf(w)).toHaveCount(n - 1)
  }
  await expect(w.locator('.editor-msg')).toHaveText('Select a file from the sidebar.')
  await searchBar(w).fill('')
  await expect(treeRows(w).first()).toBeVisible()
}

/**
 * Types `query` into the bar and waits for the matches it must show, top to bottom as the tree
 * draws them.
 *
 * The fill lives INSIDE the retry: the bar is a controlled input, so a value set while React is
 * re-rendering it can be swallowed — the bar ends up empty and no rows ever arrive (seen under
 * full-suite load once YAZ-847 grew the suite by a spec). Re-filling the same query is a no-op
 * when it did land, so a healthy run still settles on the first attempt.
 */
async function search(w: Page, query: string, labels: readonly string[]): Promise<void> {
  await expect(async () => {
    await searchBar(w).fill(query)
    expect(await matchLabels(w).allTextContents()).toEqual(labels)
  }).toPass({ timeout: 15_000 })
}

/** The highlight: the ONE row that wears the selected style, by its label. */
async function expectHighlight(w: Page, label: string): Promise<void> {
  await expect(w.locator('.sidebar__body .tree__row--selected .tree__label')).toHaveText([label])
}

/** "Nurture", as the tree draws its three matches: `Funnel Stages/`, `Problems/`, then the root. */
const NURTURE = ['Lead Nurture', 'Nurture Sequencing', 'Nurture']

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'search-userdata-'))
  vault = await copyVault(FIXTURE)
  // Seeded BEFORE launch, so the first index scan already carries the alias.
  await writeFile(
    path.join(vault, SEEDED),
    `---\naliases: ["${ALIAS}"]\n---\n\n# Nurture\n\n${SEEDED_BODY}\n`,
  )
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- YAZ-802 / 803 / 2620: find and open

test('step 1 — a typed title cuts the tree down to the matches and their parents; Enter opens the BEST match in the CURRENT tab', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Roles', 'CEO.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(CEO_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  await expect(searchBar(win)).toBeVisible() // persistent: there before anyone asked for it
  await expect(treeRows(win).first()).toBeVisible() // …with the tree below it, as usual

  // Each match keeps its place: below its folder, which is open and dim. Nothing else shows.
  await search(win, 'Nurture', NURTURE)
  await expect(parentLabels(win)).toHaveText(['Funnel Stages', 'Problems'])
  await expect(treeRows(win)).toHaveCount(5)
  await expect(marks(win)).toHaveText(['Nurture', 'Nurture', 'Nurture']) // the typed text, bold in each match
  // Exact → prefix → substring, the shared `[[` matcher's ranking (YAZ-802): the highlight starts
  // on the exact match, though the tree draws it last.
  await expectHighlight(win, 'Nurture')
  await shoot(win, 'search-01-tree')

  // Enter opens the highlight in the CURRENT tab: still ONE tab, now the seeded note.
  await searchBar(win).press('Enter')
  await expect(activeTab(win)).toHaveText('Nurture')
  await expect(editorOf(win)).toContainText(SEEDED_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  // Opening does not dismiss the results — the query is still typed, so the rows are still there.
  await expect(matchLabels(win)).toHaveText(NURTURE)
})

test('step 2 — a frontmatter alias finds its note: ONE row, under its title, with nothing bold', async () => {
  await reset(win)
  // Nothing in the vault is CALLED Zephyr: the only way to this row is through the alias.
  await search(win, 'Zephyr', ['Nurture'])
  await expect(marks(win)).toHaveCount(0)
  await shoot(win, 'search-02-alias-row')

  await fileRow(win, 'Nurture').click()
  await expect(activeTab(win)).toHaveText('Nurture')
  await expect(editorOf(win)).toContainText(SEEDED_BODY)
  await expect.poll(() => decodeURI(win.url())).toContain(SEEDED)
})

test('step 3 — ⌘-click on a row opens a BACKGROUND tab; the active tab never moves', async () => {
  await reset(win)
  // Since YAZ-1646 the launch no longer unfolds the restored tab's ancestors: open `Roles/` by hand.
  await expandDirs(win, [path.join(vault, 'Roles')])
  await fileRow(win, 'CEO').click() // an active tab to leave alone
  await expect(activeTab(win)).toHaveText('CEO')

  await search(win, 'Nurture', NURTURE)
  await fileRow(win, 'Nurture Sequencing').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['CEO', 'Nurture Sequencing'])
  await expect(activeTab(win)).toHaveText('CEO')
  await expect(editorOf(win)).toContainText(CEO_BODY)

  // Activating it later is the ordinary tab gesture — the background tab is a real one.
  await tabsOf(win).filter({ hasText: 'Nurture Sequencing' }).click()
  await expect(editorOf(win)).toContainText(SEQUENCING_BODY)
})

test('step 4 — ArrowDown / ArrowUp walk the MATCHES from the input, never a parent row, clamped at BOTH ends', async () => {
  await reset(win)
  await search(win, 'Nurture', NURTURE)
  await expectHighlight(win, 'Nurture') // the best match: the last row the tree draws

  // At the bottom: ArrowDown holds, it never wraps to the top (the `[[` picker's rule).
  await searchBar(win).press('ArrowDown')
  await expectHighlight(win, 'Nurture')

  // Two presses cross two matches — and step over the `Problems` row between them.
  await searchBar(win).press('ArrowUp')
  await expectHighlight(win, 'Nurture Sequencing')
  await searchBar(win).press('ArrowUp')
  await expectHighlight(win, 'Lead Nurture')

  // At the top: ArrowUp holds too, and never lands on `Funnel Stages` above it.
  await searchBar(win).press('ArrowUp')
  await expectHighlight(win, 'Lead Nurture')

  // The keyboard's highlight is what Enter opens.
  await searchBar(win).press('Enter')
  await expect(activeTab(win)).toHaveText('Lead Nurture')
})

// ---------------------------------------------------------------- YAZ-2620: the folds are the search's own

test('step 5 — a fold in the search lasts as long as its query; a matched folder opens to ALL it holds; Esc brings the Files tree back as it was', async () => {
  await reset(win)
  await dirRow(win, 'Industries').click()
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()

  // A click on a parent row folds it: its match leaves the screen, and the arrows no longer stop on it.
  await search(win, 'Nurture', NURTURE)
  await dirRow(win, 'Problems').click()
  await expect(matchLabels(win)).toHaveText(['Lead Nurture', 'Nurture'])
  await searchBar(win).press('ArrowUp')
  await expectHighlight(win, 'Lead Nurture')

  // A folder the query matched, with no match inside it, shows CLOSED — whatever Files has it as —
  // and one click looks inside: everything it holds, dim.
  await searchBar(win).fill('Industries')
  await expect(dirRow(win, 'Industries')).not.toHaveClass(/tree__row--context/)
  await expect(fileRow(win, 'PLG SaaS')).toHaveCount(0)
  await dirRow(win, 'Industries').click()
  await expect(fileRow(win, 'PLG SaaS')).toHaveClass(/tree__row--context/)
  // …and a double-click opens the folder's own page as a tab.
  await dirRow(win, 'Industries').dblclick()
  await expect(activeTab(win)).toHaveText('Industries')

  // Esc with text EMPTIES the query (it only gives up focus on a second press) — and the Files
  // tree comes back with its own folds: the swap is a conditional render, never a teardown.
  await searchBar(win).press('Escape')
  await expect(searchBar(win)).toHaveValue('')
  await expect(marks(win)).toHaveCount(0)
  await expect(parentLabels(win)).toHaveCount(0)
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()
})

test('step 6 — a query nothing answers to shows "No matches"; the `esc` keycap clears it and restores the tree', async () => {
  await reset(win)
  await searchBar(win).fill('zzqqxvw')
  await expect(win.locator('p.sidebar__msg')).toHaveText('No matches')
  await expect(treeRows(win)).toHaveCount(0)
  await shoot(win, 'search-06-no-matches')

  // The `esc` keycap is the way out in sight (YAZ-2630): there while a query is typed, and a click clears it.
  await win.locator('.sidebar__search-clear').click()
  await expect(searchBar(win)).toHaveValue('')
  await expect(searchBar(win)).toBeFocused()
  await expect(win.locator('.sidebar__search-clear')).toHaveCount(0)
  await expect(win.locator('p.sidebar__msg')).toHaveCount(0)
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()
  await quitApp(app)
})
