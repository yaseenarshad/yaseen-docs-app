/**
 * Bible C (GRO-2203, re-pointed at folders-as-pages in YAZ-2290): the convergence proof — one
 * committed encyclopedia driven through the REAL app, with the index, the wiki-link graph and the
 * folders all answering the same questions about it.
 *
 * The fixture (`fixtures/bible-vault/`) is five real FOLDERS of notes — `Funnel Stages`,
 * `Industries`, `KPIs`, `Problems`, `Roles` — four of them carrying a hidden `.folder.md` with its
 * columns and views, plus the two loose `inbox/` notes. A note
 * belongs to a folder by living in it: nothing in its frontmatter says so, and step 1 proves the
 * counts off the disk.
 *
 * WHAT THIS SPEC IS FOR: not the folder view's own gestures (cells, pickers, New, grouping), and
 * not the folder's tab itself. What is here — and lives nowhere else — is the CONTENT: that the
 * index reads this vault correctly, that its links and backlinks agree with its relations, and
 * that a rename leaves both the graph and the folders standing.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1  the vault is sound: zero `page_type` keys, zero broken links, and the tree shows its six
 *      folders — each holding the notes the map says, read off the disk
 *   3  wiki-link navigation: click → current tab, ⌘-click → background tab (the LOCKED model)
 *   4  the backlinks panel finds every note that names a KPI, and the ones that live in `Problems`
 *      are exactly the two problems whose relations point at it
 *   5  rename an entity page — relations, body links, backlinks AND its place in its folder all
 *      survive, still zero broken links
 *   6  rename a FOLDER (YAZ-864, YAZ-2304) — the links to it that live INSIDE
 *      `folder_settings` follow: another folder's column `target` and its own. Still zero
 *      broken links, and the folder still browses under its new name.
 *
 * Same harness as links.spec.ts / backlinks.spec.ts (temp `--user-data-dir`, a COPY of the
 * fixture, `bible-` step screenshots).
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  activeTab,
  appWindow,
  builtNote,
  contents,
  copyVault,
  dirRow,
  editorOf,
  expandDirs,
  fileRow,
  launchApp,
  layer,
  openFolder,
  quitApp,
  seededState,
  shoot,
  tabsOf,
  titleOf,
  topLabels,
  viewTabs,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
/** Every folder at the vault root, in the Files tree's own order (case-insensitive by name). */
const FOLDERS = ['Funnel Stages', 'inbox', 'Industries', 'KPIs', 'Problems', 'Roles']

/** The five folders of the encyclopedia proper. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
/** The notes living directly in each, in the same order — the shape of the whole map. */
const TOPIC_COUNTS = ['3', '2', '5', '4', '3']

/** The folder the note step 5 renames lives in. */
const KPIS = 'KPIs'

/** Every note in `Problems` — the fixture's own answer to "which mentions are problems?". */
const PROBLEMS = ['CRM Hygiene', 'Lead Quality Scoring', 'Nurture Sequencing', 'Stage Accuracy']

const FUNNEL = path.join('Funnel Stages', 'Sales-Conversion.md')
const RENAMED = 'Deal Win Rate'

/**
 * Step 6 (YAZ-864): the folder whose name is spelled in two frontmatter places that are NESTED
 * inside `folder_settings`, where the index never looked for links — `Problems`' `sold_to`
 * column `target`, and its own `reports_to` target. A link to a folder resolves to it when no
 * note holds the name (YAZ-2290 D10), so renaming the folder has to rewrite both.
 */
const ROLES = 'Roles'
const ROLES_RENAMED = 'Buyer Roles'
/** The directory that title gives the folder: its kebab-case (YAZ-2420 🔒 D6). */
const ROLES_RENAMED_DIR = 'buyer-roles'
/** The notes in it, alphabetically. */
const ROLE_MEMBERS = ['CEO', 'Head of Sales', 'RevOps Lead']
const TOPICS_AFTER = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', ROLES_RENAMED_DIR]

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const linkIn = (w: Page, text: string) => editorOf(w).locator('.wikilink', { hasText: text }).first()
const backlinksHeader = (w: Page) => layer(w).locator('.backlinks__header')
const backlinkNotes = (w: Page) => layer(w).locator('.backlinks__note')
/** The section is collapsed by default (locked) but survives a remount expanded — so check first. */
const expandBacklinks = async (w: Page): Promise<void> => {
  if ((await backlinksHeader(w).getAttribute('aria-expanded')) === 'false') await backlinksHeader(w).click()
  await expect(backlinksHeader(w)).toHaveAttribute('aria-expanded', 'true')
}

const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')
/**
 * What the name column shows. The Name cell is keyed to `file.name` (TableView's `nameCol`), and
 * it reads the page TITLE as plain text (YAZ-2420 🔒 D18, D26): a note's `title:`, or, for a note
 * that has none, its file name without the extension — never `CAC.md`.
 */
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__name')

/** The name-change confirm (⚡ YAZ-888): every rename below passes it, and its count is the rewrite's own. */
async function confirmRename(w: Page, message: string): Promise<void> {
  const sheet = w.locator('.confirm[role="dialog"]')
  await expect(sheet.locator('.confirm__text')).toHaveText(message)
  await sheet.locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect(sheet).toHaveCount(0)
}

// ---------- whole-vault audits ----------

/** Fenced and inline code can't carry links — same discipline as the index's `stripCode`. */
const maskCode = (text: string) => text.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '')
const WIKILINK = /!?\[\[([^[\]]+)\]\]/g
/** `[[Target|alias]]` / `[[Target#heading]]` → `Target`. */
const targetOf = (inner: string) => inner.split('|')[0].split('#')[0].trim()
/** A folder's own settings file — the ONE dot-entry the index reads (YAZ-2290 D1). */
const SETTINGS_FILE = '.folder.md'

/** Every file and every folder under `dir`; dot-entries are skipped, a folder's settings file aside. */
async function walk(dir: string, dirs: string[] = []): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== SETTINGS_FILE) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      dirs.push(p)
      files.push(...(await walk(p, dirs)).files)
    } else files.push(p)
  }
  return { files: files.sort(), dirs }
}

/**
 * Every wiki link in every note AND every folder settings file — frontmatter relation values and
 * column targets as much as body prose and `![[…]]` embeds — whose target names nothing in the
 * vault: no file, by basename or by root-relative path, with or without extension, no FOLDER
 * either, by name or by path (a link resolves to a folder when no note has the name, YAZ-2290
 * D10), and no page by its `title:` (YAZ-2420 🔒 D17 — a note's own, or a folder's in its settings
 * file). The durable result GRO-2203 asks for is that this is `[]` both before and after a rename.
 */
async function brokenLinks(root: string): Promise<string[]> {
  const { files, dirs } = await walk(root)
  const known = new Set<string>()
  for (const f of files) {
    const rel = path.relative(root, f)
    known.add(path.basename(f))
    known.add(path.basename(f, path.extname(f)))
    known.add(rel)
    known.add(rel.slice(0, rel.length - path.extname(rel).length))
  }
  for (const d of dirs) {
    known.add(path.basename(d))
    known.add(path.relative(root, d))
  }
  const pages = await Promise.all(files.filter((x) => x.endsWith('.md')).map(async (f) => ({ rel: path.relative(root, f), text: await readFile(f, 'utf8') })))
  for (const page of pages) {
    const title = titleOf(page.text)
    if (title !== '') known.add(title)
  }
  const broken: string[] = []
  for (const page of pages) {
    for (const m of maskCode(page.text).matchAll(WIKILINK)) {
      const t = targetOf(m[1])
      if (!known.has(t)) broken.push(`${page.rel} → [[${t}]]`)
    }
  }
  return broken
}

/**
 * How many notes live DIRECTLY in each of `folders`, read straight off the disk. Markdown files
 * only, and never the folder's own settings file.
 */
async function notesIn(root: string, folders: readonly string[]): Promise<string[]> {
  return Promise.all(
    folders.map(async (folder) => {
      const entries = await readdir(path.join(root, folder), { withFileTypes: true })
      return String(entries.filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.')).length)
    }),
  )
}

/** Any note still carrying the retired type key. The old migration's own post-check, re-asked here. */
async function withPageType(root: string): Promise<string[]> {
  const out: string[] = []
  for (const f of (await walk(root)).files.filter((x) => x.endsWith('.md'))) {
    if (/^page_type:/m.test(await readFile(f, 'utf8'))) out.push(path.relative(root, f))
  }
  return out
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'bible-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------- the scenario ----------

test('step 1 — the encyclopedia is sound, and every folder holds exactly the notes the map says', async () => {
  // The fixture itself is sound before anything runs: not one `page_type` key, and not one
  // dangling wiki link — the column targets inside the folders' settings files included.
  expect(await withPageType(vault)).toEqual([])
  expect(await brokenLinks(vault)).toEqual([])

  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')

  // The map of an encyclopedia that maintains no list: six folders, and nothing else at the root.
  await expect(topLabels(win)).toHaveText(FOLDERS)
  // THE WHOLE MAP, asked of the vault itself: the notes that LIVE in each folder — 17 notes in
  // the five folders. The tree shows no number of them (YAZ-2631 D2).
  expect(await notesIn(vault, TOPICS)).toEqual(TOPIC_COUNTS)
  await shoot(win, 'bible-01-folders')

  // A launch is collapsed since YAZ-1642: open the six folders once for every step that clicks a
  // note's row.
  await expandDirs(win, FOLDERS.map((f) => path.join(vault, f)))
})

test('step 3 — navigating the encyclopedia: click → current tab, ⌘-click → background tab', async () => {
  await fileRow(win, 'Sales-Conversion').click()
  await expect(activeTab(win)).toHaveText('Sales-Conversion')
  await expect(editorOf(win)).toContainText('Open pipeline through to closed-won')
  await expect(tabsOf(win)).toHaveCount(1)

  await linkIn(win, 'CRM Hygiene').click()
  await expect(activeTab(win)).toHaveText('CRM Hygiene')
  await expect(editorOf(win)).toContainText('The parent SKU')
  await expect(tabsOf(win)).toHaveCount(1) // the funnel page's slot, not a new tab

  await fileRow(win, 'Sales-Conversion').click()
  await expect(editorOf(win)).toContainText('Open pipeline through to closed-won')
  await linkIn(win, 'Win Rate').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Sales-Conversion', 'Win Rate'])
  await expect(activeTab(win)).toHaveText('Sales-Conversion') // background: activation never moves
  await shoot(win, 'bible-03-wikilink-navigation')
})

test('step 4 — the backlinks panel finds the whole mention set, problems included', async () => {
  // Who the problems ARE is the folder's own answer, not this file's: the four notes that
  // live in `Problems`, read straight off its Table — the first of the default views, since its
  // settings file declares columns and lists no views of its own.
  await openFolder(win, path.join(vault, 'Problems'))
  await expect(viewTabs(contents(win))).toHaveText(['Table', 'Board'])
  await expect(rowNames(contents(win))).toHaveText(PROBLEMS)

  await tabsOf(win).filter({ hasText: 'Win Rate' }).click()
  await expect(activeTab(win)).toHaveText('Win Rate')
  await expect(editorOf(win)).toContainText('Closed-won as a share of closed pipeline')

  // Four notes mention Win Rate: the two problems that name it ONLY in their `kpis_impacted`
  // relation property — frontmatter links are first-class to the index — plus the funnel page
  // and the owning role, via body prose. Path-sorted.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // Convergence: the mentions that LIVE IN `Problems` are exactly the two problems whose
  // relations point at this KPI — prose, relations and folders answering the same question.
  const mentions = await backlinkNotes(win).allTextContents()
  expect(mentions.filter((n) => PROBLEMS.includes(n)).sort()).toEqual(['CRM Hygiene', 'Stage Accuracy'])
  await shoot(win, 'bible-04-backlinks-agree')
})

test('step 5 — renaming an entity page: relations, body links, backlinks and its place in its folder survive', async () => {
  await fileRow(win, 'Win Rate').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(win.locator('.create-inline__input')).toHaveValue('Win Rate')
  await win.locator('.create-inline__input').fill(RENAMED)
  await win.keyboard.press('Enter')
  // The name-change confirm (⚡ YAZ-888), whose count is the notes the rewrite touches — the FOUR
  // that spell the name in prose and relations. No folder's settings name it: an outline holds a
  // link only when somebody types one (YAZ-2290 D5), and nobody has.
  await confirmRename(win, `Rename 'Win Rate' to '${RENAMED}'? Links in 4 notes will be updated.`)

  // Four referencing notes: two through frontmatter relations, two through body prose.
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 4 notes')
  await expect(activeTab(win)).toHaveText(RENAMED)

  const crmHygiene = path.join('Problems', 'CRM Hygiene.md')
  // relation properties (whole-value links inside a list) …
  await expect.poll(() => read(crmHygiene)).toContain(`[[${RENAMED}]]`)
  expect(await read(crmHygiene)).toContain('[[Sales Cycle Time]]') // the sibling relation is untouched
  await expect.poll(() => read(path.join('Problems', 'Stage Accuracy.md'))).toContain(`[[${RENAMED}]]`)
  // … and body links, including a note that was never opened in this run.
  await expect.poll(() => read(path.join('Roles', 'Head of Sales.md'))).toContain(`[[${RENAMED}]]`)
  await expect.poll(() => read(FUNNEL)).toContain(`[[${RENAMED}]]`)

  // The backlinks panel still finds the same FOUR notes on the renamed page.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // And it still lives where it lived: a note belongs to a folder by BEING in it, so renaming
  // the note is nothing the folder has to be told about — it is the same row, under its new
  // title, in the path order its built name (`deal-win-rate-<id>.md`, YAZ-2420 🔒 D3) now sorts
  // to: after the capitalised names of the notes made outside the app.
  expect(await read(path.join('KPIs', await builtNote(path.join(vault, 'KPIs'), 'deal-win-rate')))).toContain('unit: percent')
  await openFolder(win, path.join(vault, KPIS))
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', RENAMED])

  // The durable result: not one dangling wiki link anywhere in the vault.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-05-rename-survived')
  await quitApp(app)
})

test('step 6 — renaming a FOLDER: the links to it INSIDE folder_settings follow (YAZ-864)', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await expect(dirRow(win, ROLES)).toBeVisible()

  await dirRow(win, ROLES).click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(win.locator('.create-inline__input')).toHaveValue(ROLES)
  await win.locator('.create-inline__input').fill(ROLES_RENAMED)
  await win.keyboard.press('Enter')
  // The confirm's count sees what the rewrite sees — settings-only references included (YAZ-864).
  await confirmRename(win, `Rename '${ROLES}' to '${ROLES_RENAMED}'? Links in 2 notes will be updated.`)

  // TWO files, and both are folder settings files: the two that name Roles ONLY from inside
  // `folder_settings`, which the index never extracted as links. The three notes in the
  // folder link to each other by BARE name, which a folder rename leaves byte-identical (E1b).
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 2 notes')

  // A column `target` on ANOTHER folder, its column's other keys intact …
  const problems = path.join('Problems', '.folder.md')
  await expect.poll(() => read(problems)).toContain(`target: "[[${ROLES_RENAMED}]]"`)
  expect(await read(problems)).toContain('target: "[[KPIs]]"')
  expect(await read(problems)).toContain('required: true')
  // … the renamed folder's OWN self-target, written at its new path, beside the title it now holds …
  const renamedSettings = path.join(ROLES_RENAMED_DIR, '.folder.md')
  await expect.poll(() => read(renamedSettings).catch(() => '')).toContain(`target: "[[${ROLES_RENAMED}]]"`)
  expect(titleOf(await read(renamedSettings))).toBe(ROLES_RENAMED)
  expect(await read(renamedSettings)).toContain('kind: link')
  // … and the notes moved with their folder, their names and their own bare links untouched.
  expect(await read(path.join(ROLES_RENAMED_DIR, 'Head of Sales.md'))).toContain('reports_to: "[[CEO]]"')

  // And everything still browses: the folder opens under its new name, holding the same three
  // notes — on the first of the default views, since its settings list none.
  await openFolder(win, path.join(vault, ROLES_RENAMED_DIR))
  await expect(activeTab(win)).toHaveText(ROLES_RENAMED)
  await expect(rowNames(contents(win))).toHaveText(ROLE_MEMBERS)
  expect(await notesIn(vault, TOPICS_AFTER)).toEqual(TOPIC_COUNTS)

  // The durable result again, with the settings targets inside the audit's reach.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-06-folder-rename')
  await quitApp(app)
})
