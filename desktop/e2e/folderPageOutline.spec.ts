/**
 * THE FREE-FORM OUTLINE, end to end (YAZ-904; the surface landed in YAZ-900→903): a folder page's
 * outline view is no longer a list of member rows — it is ONE markdown bullet list the user types
 * into, a second Milkdown instance (`OutlineEditor`) holding `views[i].outline`, with the members
 * the document does not NAME appended below it as the read-only rows they always were.
 *
 * WHAT IS PROVEN HERE, and nowhere else: that the document and the vault agree. A line that is
 * exactly one resolving wikilink IS a membership — writing it tags the target's own card, deleting
 * it asks before un-tagging — while every other line is text and means nothing at all. Everything
 * is asserted ON DISK through the shared frontmatter helpers (`folderPageColumns.spec.ts`'s idiom):
 * the outline is a string inside `folder_page_settings`, and a `toContain` over the whole file
 * would pass on a block that had lost half of it.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`), on
 * `Home` — the one folder page that SHIPS an outline `order`, which is what makes the lazy
 * migration visible: the [D5] list seeds the document, is read and never written, and retires the
 * moment the first edit gives the page a document of its own.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 a TEXT line: `views[0].outline` holds it on disk, `order` is GONE from that view (the lazy
 *     migration), and the Table — the membership set — has not moved
 *   2 `[[` opens the picker; picking a non-member turns the line into a wikilink, writes
 *     `folder_pages` onto the PICKED page's own card, and the page arrives as a Table row
 *   3 Tab indents: the nesting is in the document on disk and in the editor's own DOM (step 7
 *     reads it back after a relaunch)
 *   4 deleting the link line ASKS — the very sheet the × has used since YAZ-820 — and CONFIRM
 *     un-tags on disk, dropping the row from the Table
 *   5 the same deletion CANCELLED keeps the membership: the page moves into the appended
 *     `.view-outline__list` section, and the next edit never asks again
 *   6 bullets-only (🔒 F3): `# heading` typed in a bullet stays six literal characters
 *   7 quit → relaunch: the text, the nesting and the membership are all on the page, not in the
 *     session
 *
 * DRIVING A PROSEMIRROR FROM PLAYWRIGHT is its own small craft — macOS caret keys, a wikilink's
 * hidden brackets, and ProseMirror's deferred read of the browser's selection all bite — so the
 * craft lives in `helpers.ts` (`outlineCaret` → `caretAtEndOfLine` → `bulletAfterLine` /
 * `writeOutlineLine` / `pickOutlineLink`), shared with every spec that types into an outline. Read
 * its docblock before changing a keystroke here.
 *
 * Nothing here sleeps: every debounced commit (500 ms, `OutlineEditor`'s own) is gated on the disk
 * state or on the UI consequence it causes.
 *
 * Same harness as folderPages.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `outline-`
 * step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import {
  appWindow,
  bulletAfterLine,
  clearOutlineLine,
  copyVault,
  indentOutlineLine,
  launchApp,
  outlineEditor,
  outlineLineIndex,
  outlineLines,
  outlineNested,
  pickOutlineLink,
  quitApp,
  seededState,
  shoot,
  typeOutlineLine,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'Home.md'
/** Home's members, in the `order` the migration wrote onto its outline view — the document's seed. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
/** The page this spec tags into Home: a kpi, so it starts a NON-member that already belongs elsewhere. */
const SUBJECT = 'CAC'
const SUBJECT_FILE = path.join('kpis', 'CAC.md')

/** The two text lines the document grows; neither is a link, so neither means anything to membership. */
const NOTE = 'Only the lines below that are links mean anything'
const CHILD = 'and this one is nested under it'
/** The unrelated edit step 5 makes after a cancelled removal — the one that must not re-ask. */
const KEPT = 'kept on purpose, and never asked about again'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const rowNames = (scope: Locator) => scope.locator('.view-table__link')
/** The APPENDED section (YAZ-903): members the document does not name, still members. */
const appended = (scope: Locator) => scope.locator('.view-outline__link')
const sheet = (w: Page) => w.locator('[role="dialog"]')
const sheetBtn = (w: Page, label: string) => sheet(w).locator('.confirm__btn', { hasText: label })
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
/** `file.name` is Obsidian's TFile name — extension included. */
const named = (...names: string[]) => names.map((n) => `${n}.md`)

const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')

/** One outline view, as the folder page's frontmatter holds it. */
interface OnDiskView {
  type?: string
  name?: string
  order?: string[]
  outline?: string
}

/** Home's outline VIEW as written — parsed, never string-matched (folderPageColumns.spec.ts's rule). */
async function outlineViewOnDisk(): Promise<OnDiskView> {
  const { frontmatter } = splitFrontmatter(await read(FOLDER_PAGE))
  const settings = (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { views?: OnDiskView[] }
  return settings.views?.find((v) => v.type === 'outline') ?? {}
}

/** The stored document itself — `''` while the page still has none (the pre-migration state). */
const outlineOnDisk = async (): Promise<string> => (await outlineViewOnDisk()).outline ?? ''

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'outline-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a text line lands in views[0].outline on disk, and `order` retires with it', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, FOLDER_PAGE)) })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()

  // THE SEED: the [D5] `order`, frozen into a document — one flat wikilink line per entry, in the
  // sequence the migration wrote. Nothing is appended, because the document names every member.
  await expect(outlineLines(contents(win))).toHaveText(TOPICS.map((n) => `[[${n}]]`))
  await expect(appended(contents(win))).toHaveCount(0)
  // …and it is still only a SEED: the page has no document of its own yet, and `order` is intact.
  expect(await outlineOnDisk()).toBe('')
  expect((await outlineViewOnDisk()).order).toEqual(TOPICS.map((n) => `[[${n}]]`))
  await shoot(win, 'outline-01-seeded-from-order')

  await typeOutlineLine(win, contents(win), TOPICS.length - 1, NOTE)

  // ONE `folder_page_settings` write, debounced 500ms: the document arrives AND `order` is deleted
  // in the same write — the lazy migration, spent the first time the page is edited.
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(NOTE)
  const view = await outlineViewOnDisk()
  expect(view.order).toBeUndefined()
  expect(view.name).toBe('Outline') // the view itself is untouched — only its two content keys moved
  expect(view.outline?.split('\n').filter((l) => l.trim() !== '')).toEqual([
    ...TOPICS.map((n) => `* [[${n}]]`),
    `* ${NOTE}`,
  ])

  // TEXT MEANS NOTHING: the membership set is exactly what it was, so the Table has not moved.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(named(...TOPICS))
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect(sheet(win)).toHaveCount(0)
  await shoot(win, 'outline-02-text-line')
})

test('step 2 — `[[` picks a page, and the LINK LINE tags it on that page’s own card', async () => {
  const before = await read(SUBJECT_FILE)
  expect(before).not.toContain('[[Home]]') // CAC is a kpi and nothing else, before this step

  await bulletAfterLine(win, contents(win), await outlineLineIndex(contents(win), NOTE))
  await pickOutlineLink(win, SUBJECT, 'outline-03-picker')

  // The picker inserts PLAIN TEXT `[[CAC]]` — and that line, being exactly one resolving wikilink,
  // is a membership. The write lands on the PICKED page's card and it ADDS: `[[KPIs]]` survives.
  await expect(outlineLines(contents(win)).last()).toHaveText(`[[${SUBJECT}]]`)
  await expect.poll(() => read(SUBJECT_FILE), { timeout: 10_000 }).toContain('[[Home]]')
  const after = await read(SUBJECT_FILE)
  expect(after).toContain('[[KPIs]]') // a page belongs to as many topics as it says
  expect(after).toContain('unit: currency') // every other key survives
  expect(after).toContain(`# ${SUBJECT}`) // and the body
  // …and the folder page maintains no list of its own: only the document it holds mentions CAC.
  expect(await outlineOnDisk()).toContain(`* [[${SUBJECT}]]`)

  // The membership set moved, so THIS time the Table did too.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(named(...TOPICS, SUBJECT))
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect(appended(contents(win))).toHaveCount(0) // named by the document, so not appended
  await shoot(win, 'outline-04-tagged')
})

test('step 3 — Tab indents, and the nesting is in the document itself', async () => {
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), NOTE), CHILD)
  await indentOutlineLine(win, contents(win), CHILD)

  // The editor's own DOM says it: a bullet list inside a bullet list, which is the only shape the
  // bullets-only lock allows to nest at all.
  await expect(outlineNested(contents(win))).toHaveText([CHILD])
  // And so does the document on disk — two spaces deeper than the line it hangs from.
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(`* ${NOTE}\n  * ${CHILD}`)
  // The link line is a SIBLING of the text, not a casualty of it: still depth 0, still a membership.
  expect(await outlineOnDisk()).toContain(`\n* [[${SUBJECT}]]`)
  expect(await read(SUBJECT_FILE)).toContain('[[Home]]')
  await shoot(win, 'outline-05-nested')
})

test('step 4 — deleting the link line ASKS, and CONFIRM un-tags on disk', async () => {
  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), `[[${SUBJECT}]]`))

  // The very sheet the hover × has used since YAZ-820 — a deletion is a QUESTION, never a write.
  await expect(sheet(win)).toContainText(
    `Remove '${SUBJECT}' from 'Home'? The page is not deleted — its file stays put. It remains in: KPIs.`,
  )
  await shoot(win, 'outline-06-remove-sheet')
  await sheetBtn(win, 'Remove').click()

  await expect.poll(() => read(SUBJECT_FILE), { timeout: 10_000 }).not.toContain('[[Home]]')
  expect(await read(SUBJECT_FILE)).toContain('[[KPIs]]') // only THIS folder page's entry was dropped
  await expect(sheet(win)).toHaveCount(0)
  await expect(appended(contents(win))).toHaveCount(0) // not named, and not a member either

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(named(...TOPICS))
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await shoot(win, 'outline-07-untagged')
})

test('step 5 — CANCEL keeps the membership: the page moves into the appended section, and is never asked about twice', async () => {
  // Tag it again, so there is a membership to decline dropping.
  await bulletAfterLine(win, contents(win), await outlineLineIndex(contents(win), NOTE))
  await pickOutlineLink(win, SUBJECT)
  await expect.poll(() => read(SUBJECT_FILE), { timeout: 10_000 }).toContain('[[Home]]')

  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), `[[${SUBJECT}]]`))
  await expect(sheet(win)).toBeVisible()
  await sheetBtn(win, 'Cancel').click()

  // 🔒 THE YAZ-903 RULING: cancel keeps the membership and does NOT put the text back. The page is
  // a member the document does not NAME, which is exactly what the appended section is for.
  await expect(appended(contents(win))).toHaveText([SUBJECT])
  expect(await read(SUBJECT_FILE)).toContain('[[Home]]')
  expect(await outlineOnDisk()).not.toContain(`[[${SUBJECT}]]`)
  await shoot(win, 'outline-08-cancelled-into-appended')

  // …and `prev` advanced with the text, so the next keystroke does not re-ask a question already
  // answered: an unrelated edit commits with no sheet at all.
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), NOTE), KEPT)
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(KEPT)
  await expect(sheet(win)).toHaveCount(0)
  await expect(appended(contents(win))).toHaveText([SUBJECT])
})

test('step 6 — bullets-only: `# heading` typed in a bullet is six literal characters', async () => {
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), CHILD), '# heading')

  // 🔒 F3: the narrowed `list_item` schema makes the markdown input rule DECLINE rather than fire,
  // so the characters stay standing as list text and no heading node is ever created.
  await expect(outlineEditor(contents(win)).locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0)
  await expect(outlineLines(contents(win)).filter({ hasText: '# heading' })).toHaveCount(1)
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain('# heading')
  await shoot(win, 'outline-09-bullets-only')
})

test('step 7 — the document lives on the page, not in the session: it survives quit → relaunch', async () => {
  const document = await outlineOnDisk()
  await quitApp(app) // the REAL quit path: the pending settings write is flushed before exit

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await fileRow(win, 'Home').click()
  await expect(contents(win)).toBeVisible()

  // The text, the nesting and the topics, read back out of the one place they live — byte for
  // byte the document the quit flushed, re-parsed into the same bullets it was typed as.
  expect(await outlineOnDisk()).toBe(document)
  await expect(outlineLines(contents(win)).filter({ hasText: NOTE })).toHaveCount(1)
  await expect(outlineNested(contents(win)).filter({ hasText: CHILD })).toHaveCount(1)
  await expect(outlineLines(contents(win)).first()).toHaveText(`[[${TOPICS[0]}]]`)
  // The membership step 5 declined to drop is still a membership — on the member's own card, in
  // the appended section, and in the Table.
  expect(await read(SUBJECT_FILE)).toContain('[[Home]]')
  await expect(appended(contents(win))).toHaveText([SUBJECT])
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(named(...TOPICS, SUBJECT))
  await shoot(win, 'outline-10-survives-relaunch')

  await quitApp(app)
})
