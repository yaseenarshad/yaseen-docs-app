/**
 * Search E (YAZ-805): the ⌘K search feature driven end-to-end through the REAL app — the Search
 * tab (YAZ-2638 D2: the second tab of the sidebar, and the only one with the search bar of
 * YAZ-801), the search TREE that is its body while text is typed (YAZ-2620: the Files tree cut
 * down to the matches and their parent folders) and the title/alias ranking behind it (YAZ-802),
 * over a COPY of the committed encyclopedia fixture (`fixtures/bible-vault`) plus ONE seeded note
 * that makes the ranking and the alias deterministic.
 *
 * That seeded note is `Nurture.md` at the vault root, aliased `Zephyr Codename`. It turns the
 * query "Nurture" into one match of each rank bucket — exact `Nurture`, prefix `Nurture
 * Sequencing`, substring `Lead Nurture` — in three places of the tree: the root, `Problems/` and
 * `Funnel Stages/`. The tree draws the exact match LAST, which is the only way this fixture can
 * PROVE that the highlight starts on the best match and not on the top row.
 *
 * The ⌘K KEY itself is NOT pressed here: a native menu accelerator cannot be fired from Playwright
 * (`keyboard.press('Meta+K')` silently does nothing), so the key is pinned by
 * `desktop/src/main/menu.test.ts` and a recorded human check on YAZ-804. Steps 1 and 7 click the
 * menu item the key belongs to, by its id (`menu.file.search`, the `clickMenuItem` idiom): the same
 * handler, the same message to the renderer. Every other step shows the Search tab by a click on it.
 *
 * Since YAZ-2638 the old rules of the bar are overturned, and the steps say the new ones: the bar
 * is on the Search tab only; Esc and the `esc` keycap go back to the lens the window last showed
 * and KEEP the text; a typed query is the body of the Search tab and of no other tab; "Add to
 * focus" on a result stays on the Search tab; "Show in sidebar" leads the menu of a row of Search,
 * Focus and Favorites.
 *
 * Serial by design (the suite's idiom): each step continues the previous state, and steps 1 to 7
 * start from `reset` — no tab, an empty query, the Files tab — so the one before cannot colour them.
 */
// Rewritten for YAZ-2290 (folders are the pages), for YAZ-2620 (the results are a tree) and for YAZ-2638 (Search
// is a tab). Not yet run: Playwright was off limits each time, so every selector here was read from the source,
// not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, clickMenuItem, copyVault, dirRow, editorOf, expandDirs, fileRow, launchApp, lensTab, menuItem, quitApp, readState, searchBar, searchTab, seededState, shoot, showSearchTab, tabsOf, topLabels } from './helpers'

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

/** Row 1 of the sidebar: Files, then the three glyph tabs, whose names live in `aria-label`. */
const sidebarTabs = (w: Page) => w.locator('.sidebar__lenses [role="tab"]')
const focusTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Focus"]')
const heartTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Favorites"]')
/** The `esc` keycap of the bar (YAZ-2638 S13): always there, and a click is the key. */
const keycap = (w: Page) => w.locator('.sidebar__search-back')
/** The one line a body shows in place of a tree: the empty Search tab's help, or "No matches". */
const bodyMsg = (w: Page) => w.locator('.sidebar__body p.sidebar__msg')
/** The items of the row menu that is open, top level, in the order drawn. */
const rowMenuItems = (w: Page) => w.locator('.ctx-overlay .ctx-menu [role="menuitem"]')
/** The tree item of a folder, by its path: `aria-expanded` is the LI's, not the row's (Tree.tsx). */
const dirItem = (w: Page, dir: string) => w.locator(`li[role="treeitem"]:has(> .tree__row--dir[data-path="${dir}"])`)
/** App's one passive toast (`.link-notice`) — its text. */
const toast = (w: Page) => w.locator('.link-notice__text')
/** A result is a tree row (YAZ-2620): a MATCH, or — dim — a row that only gives a match its place. */
const matchLabels = (w: Page) => w.locator('.sidebar__body .tree__row:not(.tree__row--context) .tree__label')
const parentLabels = (w: Page) => w.locator('.sidebar__body .tree__row--context .tree__label')
/** The typed text, bold where it sits in a match. */
const marks = (w: Page) => w.locator('.sidebar__body .tree__mark')

// ---------- gestures ----------

/**
 * Closes every open tab, leaving the empty state (the easyWave idiom), then empties the query and
 * goes back to Files. The query is emptied on the Search tab — no other tab has the bar, and the
 * text stays while a different tab shows (YAZ-2638 S10), so a step would inherit it otherwise.
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
  await showSearchTab(w)
  await searchBar(w).fill('')
  await lensTab(w, 'Files').click()
  await expect(lensTab(w, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(w)).toHaveCount(0)
  await expect(treeRows(w).first()).toBeVisible()
}

/** Shuts `dir` on the Files tree when it is open — the mirror of `expandDirs`, by the same click. */
async function collapseDir(w: Page, dir: string): Promise<void> {
  const row = w.locator(`.tree__row--dir[data-path="${dir}"]`)
  await expect(row).toBeVisible()
  await expect
    .poll(async () => {
      if ((await dirItem(w, dir).getAttribute('aria-expanded')) !== 'true') return false
      await row.click()
      return (await dirItem(w, dir).getAttribute('aria-expanded')) === 'true'
    })
    .toBe(false)
}

/**
 * Shows the Search tab, types `query` into its bar and waits for the matches it must show, top to
 * bottom as the tree draws them.
 *
 * The fill lives INSIDE the retry: the bar is a controlled input, so a value set while React is
 * re-rendering it can be swallowed — the bar ends up empty and no rows ever arrive (seen under
 * full-suite load once YAZ-847 grew the suite by a spec). Re-filling the same query is a no-op
 * when it did land, so a healthy run still settles on the first attempt.
 */
async function search(w: Page, query: string, labels: readonly string[]): Promise<void> {
  await showSearchTab(w)
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

/** The window's stored tab and focus list — window identity, in `yaseendocs.json`. */
const windowOnDisk = async () => (await readState(userData)).windows[0]
/** The vault's stored favorites, vault-RELATIVE paths; null while the file is absent. */
async function favoritesOnDisk(): Promise<string[] | null> {
  const raw = await readFile(path.join(vault, '.yaseendocs', 'favorites.json'), 'utf8').catch(() => null)
  return raw === null ? null : (JSON.parse(raw) as { favorites: string[] }).favorites
}

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

test('step 1 — ⌘K shows the Search tab, its bar and one line of help; a typed title cuts the tree down to the matches and their parents; Enter opens the BEST match in the CURRENT tab', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Roles', 'CEO.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(CEO_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  // The tab row reads Files, Search, Focus, Favorites (YAZ-2638 S1); the window opens on Files,
  // which has the tree and NO bar (S6) — before YAZ-2638 the bar stood on every tab.
  await expect.poll(() => sidebarTabs(win).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label') ?? tab.textContent))).toEqual(['Files', 'Search', 'Focus', 'Favorites'])
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(treeRows(win).first()).toBeVisible()

  // ⌘K (File › Search Vault, by its menu id) shows the Search tab with the caret in its bar (S2).
  await clickMenuItem(app, 'menu.file.search', 'w1')
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toBeFocused()
  // With no text the body is one line and no tree (S7), and the `esc` keycap is in the bar already (S13).
  await expect(bodyMsg(win)).toHaveText('Type to search every note and folder.')
  await expect(treeRows(win)).toHaveCount(0)
  await expect(keycap(win)).toBeVisible()
  await shoot(win, 'search-00-empty-tab')

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
  // Opening does not dismiss the results — the Search tab stays (S24), so the rows are still there.
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(matchLabels(win)).toHaveText(NURTURE)

  // Esc in the page, with the Search tab showing, puts the caret in the search bar.
  await editorOf(win).getByText(SEEDED_BODY).click()
  await expect(searchBar(win)).not.toBeFocused()
  await win.keyboard.press('Escape')
  await expect(searchBar(win)).toBeFocused()
  // ⌘K while the Search tab shows puts the caret back in the bar and changes nothing else (S4).
  await editorOf(win).getByText(SEEDED_BODY).click()
  await clickMenuItem(app, 'menu.file.search', 'w1')
  await expect(searchBar(win)).toBeFocused()
  await expect(searchBar(win)).toHaveValue('Nurture')
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

test('step 5 — a fold in the search lasts as long as its query; a matched folder opens to ALL it holds; Esc goes back to the Files tree as it was, and the Search tab keeps the text and the fold', async () => {
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

  // Esc goes back to the lens the window last showed — Files — and the text STAYS (YAZ-2638 S12;
  // before, Esc emptied the query). The Files tree is there with its own folds: the swap is a
  // conditional render, never a teardown.
  await searchBar(win).press('Escape')
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(marks(win)).toHaveCount(0)
  await expect(parentLabels(win)).toHaveCount(0)
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()
  await expect(fileRow(win, 'PLG SaaS')).not.toHaveClass(/tree__row--context/)

  // The Search tab again, by a click (S5): the caret is in the bar, and the text and the fold are as they were left (S10).
  await searchTab(win).click()
  await expect(searchBar(win)).toBeFocused()
  await expect(searchBar(win)).toHaveValue('Industries')
  await expect(dirRow(win, 'Industries')).not.toHaveClass(/tree__row--context/)
  await expect(fileRow(win, 'PLG SaaS')).toHaveClass(/tree__row--context/)
})

test('step 6 — a query nothing answers to shows "No matches"; the `esc` keycap goes back to the Files tree, and the text is still in the Search tab', async () => {
  await reset(win)
  await showSearchTab(win)
  await searchBar(win).fill('zzqqxvw')
  await expect(bodyMsg(win)).toHaveText('No matches')
  await expect(treeRows(win)).toHaveCount(0)
  await shoot(win, 'search-06-no-matches')

  // The `esc` keycap is the way out in sight (YAZ-2638 S13; before, YAZ-2630: it showed only with
  // a query, and cleared it). It is always in the bar, and a click does what Esc does: back to Files.
  await expect(keycap(win)).toHaveAttribute('aria-label', 'Leave search')
  await keycap(win).click()
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(keycap(win)).toHaveCount(0)
  await expect(bodyMsg(win)).toHaveCount(0)
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()

  // Nothing cleared the text (S14: there is no clear button): the Search tab still says what it said.
  await searchTab(win).click()
  await expect(searchBar(win)).toHaveValue('zzqqxvw')
  await expect(bodyMsg(win)).toHaveText('No matches')
})

// ---------------------------------------------------------------- YAZ-2638: "Show in sidebar"

test('step 7 — ⌘K, a query, a right-click on a result: "Show in sidebar" is the FIRST item; a click shows the Files tab with the row flashing and its folder open, and opens no tab; the Search tab still has the text and the results', async () => {
  await reset(win)
  const problems = path.join(vault, 'Problems')
  // A tab in front to leave alone, and `Problems/` shut on Files, so the reveal has a folder to open.
  await expandDirs(win, [path.join(vault, 'Roles')])
  await fileRow(win, 'CEO').click()
  await expect(tabsOf(win)).toHaveText(['CEO'])
  await collapseDir(win, problems)
  await expect(fileRow(win, 'Nurture Sequencing')).toHaveCount(0)

  // ⌘K, then the query.
  await clickMenuItem(app, 'menu.file.search', 'w1')
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toBeFocused()
  await search(win, 'Nurture', NURTURE)

  // A right-click on a result: the item leads its menu, before the focus toggle (S26, S27).
  await fileRow(win, 'Nurture Sequencing').click({ button: 'right' })
  await expect(rowMenuItems(win).first()).toHaveText('Show in sidebar')
  await expect(rowMenuItems(win).nth(1)).toHaveText('Add to focus')
  await shoot(win, 'search-07-show-in-sidebar-menu')
  await menuItem(win, 'Show in sidebar').click()

  // The Files tab shows, the row is in the tree and wears the flash, and its folder is open (S29).
  // The flash lasts 3 seconds (`SIDEBAR_REVEAL_MS`), so it is read first.
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(fileRow(win, 'Nurture Sequencing')).toHaveClass(/tree__row--revealed/)
  await expect(dirItem(win, problems)).toHaveAttribute('aria-expanded', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(marks(win)).toHaveCount(0)
  await shoot(win, 'search-08-shown-in-files')
  // It opened no tab, the tab in front is the same, and the row is not selected (S30).
  await expect(tabsOf(win)).toHaveText(['CEO'])
  await expect(activeTab(win)).toHaveText('CEO')
  await expect(editorOf(win)).toContainText(CEO_BODY)
  await expect(fileRow(win, 'Nurture Sequencing')).not.toHaveClass(/tree__row--selected/)

  // Back on the Search tab the text, the results and the highlight — on the row that was
  // right-clicked — are as they were left (S10, S33; before, the reveal emptied the query).
  await searchTab(win).click()
  await expect(searchBar(win)).toHaveValue('Nurture')
  await expect(matchLabels(win)).toHaveText(NURTURE)
  await expect(parentLabels(win)).toHaveText(['Funnel Stages', 'Problems'])
  await expectHighlight(win, 'Nurture Sequencing')
})

test('step 8 — "Add to focus" and "Add to favorites" on a result stay on the Search tab; on a Focus row and on a Favorites row "Show in sidebar" is the FIRST item and shows the row in Files, and neither list changes; a Files row has no such item', async () => {
  // Continues step 7: the Search tab, with "Nurture" typed.
  const sequencing = path.join(vault, 'Problems', 'Nurture Sequencing.md')
  const funnel = path.join(vault, 'Funnel Stages')
  await expect(matchLabels(win)).toHaveText(NURTURE)

  // An add from a result changes the list and STAYS on the Search tab (YAZ-2638 S20; before,
  // YAZ-2619 D3: it showed the Focus tab). The favorite toggle stays too (S21).
  await fileRow(win, 'Nurture Sequencing').click({ button: 'right' })
  await menuItem(win, 'Add to focus').click()
  await expect(toast(win)).toHaveText('Added to focus')
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await fileRow(win, 'Lead Nurture').click({ button: 'right' })
  await menuItem(win, 'Add to favorites').click()
  await expect(toast(win)).toHaveText('Added to favorites')
  await expect(searchTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveValue('Nurture')
  await expect(matchLabels(win)).toHaveText(NURTURE)
  await expect.poll(async () => (await windowOnDisk())?.focusList).toEqual([sequencing])
  await expect.poll(favoritesOnDisk).toEqual(['Funnel Stages/Lead Nurture.md'])

  // The Focus tab: no bar (S6), the item as its one top row, and "Show in sidebar" first in its menu (S34).
  await focusTab(win).click()
  await expect(focusTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(topLabels(win)).toHaveText(['Nurture Sequencing'])
  await fileRow(win, 'Nurture Sequencing').click({ button: 'right' })
  await expect(rowMenuItems(win).first()).toHaveText('Show in sidebar')
  await expect(rowMenuItems(win).nth(1)).toHaveText('Remove from focus')
  await shoot(win, 'search-09-focus-row-menu')
  await menuItem(win, 'Show in sidebar').click()
  // The row shows in Files, and the focus list is as it was (S36).
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(fileRow(win, 'Nurture Sequencing')).toHaveClass(/tree__row--revealed/)
  expect((await windowOnDisk())?.focusList).toEqual([sequencing])

  // The Favorites tab: the same item, first, and the click opens the folder above the row in Files.
  await collapseDir(win, funnel)
  await expect(fileRow(win, 'Lead Nurture')).toHaveCount(0)
  await heartTab(win).click()
  await expect(heartTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(searchBar(win)).toHaveCount(0)
  await expect(topLabels(win)).toHaveText(['Lead Nurture'])
  await fileRow(win, 'Lead Nurture').click({ button: 'right' })
  await expect(rowMenuItems(win).first()).toHaveText('Show in sidebar')
  await menuItem(win, 'Show in sidebar').click()
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(fileRow(win, 'Lead Nurture')).toHaveClass(/tree__row--revealed/)
  await expect(dirItem(win, funnel)).toHaveAttribute('aria-expanded', 'true')
  expect(await favoritesOnDisk()).toEqual(['Funnel Stages/Lead Nurture.md'])
  await expect(tabsOf(win)).toHaveText(['CEO']) // neither click opened a tab

  // A row of the Files tab is in the sidebar's tree already: its menu has no such item (S28, S38).
  await fileRow(win, 'Lead Nurture').click({ button: 'right' })
  await expect(menuItem(win, 'Add to focus')).toBeVisible()
  await expect(menuItem(win, 'Show in sidebar')).toHaveCount(0)
  await win.keyboard.press('Escape')
  await expect(rowMenuItems(win)).toHaveCount(0)

  // The Search tab still has the text.
  await searchTab(win).click()
  await expect(searchBar(win)).toHaveValue('Nurture')
  await expect(matchLabels(win)).toHaveText(NURTURE)
  // Search is never stored (S15): the window quits on the Search tab, and the tab on disk is the last LENS.
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  expect((await windowOnDisk())?.sidebarLens).toBe('files')
})
