/**
 * THE FREE-FORM OUTLINE, end to end (YAZ-904; the surface landed in YAZ-900→903, and YAZ-2290
 * made it what it is now): a folder's outline view is ONE markdown bullet list the user types
 * into — a second Milkdown instance (`OutlineEditor`) holding `views[i].outline` in the folder's
 * hidden `.folder.md` — and it is a plain document and nothing more.
 *
 * WHAT IS PROVEN HERE, and nowhere else: that the document is text. A `[[link]]` in it is just a
 * link (YAZ-2290 D5) — it adds nobody to the folder and touches nobody's file — and what the
 * folder holds is decided by what lives in it, which the Table answers independently of every
 * line typed here. Everything is asserted ON DISK through the shared frontmatter helpers
 * (`folderColumns.spec.ts`'s idiom): the outline is a string inside `folder_page_settings`, and
 * a `toContain` over the whole file would pass on a block that had lost half of it.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`), on
 * `Funnel Stages` — the folder whose settings file SHIPS an outline document, three lines of
 * prose. Everything this file types happens on top of that text.
 *
 * TOMBSTONE (YAZ-2290 D5), because this file used to be the membership outline's own proof: a
 * line that was exactly one resolving wikilink no longer IS a membership. Writing one tags
 * nothing, deleting one asks nothing (the un-tag sheet is gone, and its two steps with it), no
 * member is ADOPTED into the document, the page body no longer migrates into it on first open,
 * and the `order` list retires with nobody's first write. What was step 2's tag is now a link
 * that changes no file but the settings.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 first open: the document is exactly what the settings file ships, opening wrote NOTHING,
 *     and a TEXT line typed under it lands as one settings write (and the Table has not moved)
 *   2 `[[` opens the picker; picking a page turns the line into a wikilink in the document — and
 *     that is ALL it does: the picked page's own file is byte-identical and the Table has not moved
 *   3 Tab indents: the nesting is in the document on disk and in the editor's own DOM (step 5
 *     reads it back after a relaunch)
 *   4 bullets-only (🔒 F3): `# heading` typed in a bullet stays nine literal characters
 *   5 quit → relaunch: the text, the nesting and the link are all in the settings file, not in
 *     the session — byte for byte — and the folder's rows read back off the Table
 *
 * DRIVING A PROSEMIRROR FROM PLAYWRIGHT is its own small craft — macOS caret keys, a wikilink's
 * hidden brackets, and ProseMirror's deferred read of the browser's selection all bite — so the
 * craft lives in `helpers.ts` (`outlineCaret` → `caretAtEndOfLine` → `bulletAfterLine` /
 * `writeOutlineLine` / `pickOutlineLink`), shared with every spec that types into an outline. Read
 * its docblock before changing a keystroke here.
 *
 * Nothing here sleeps: every debounced commit (500 ms, `OutlineEditor`'s own) is gated on the
 * disk state or on the UI consequence it causes.
 *
 * Same harness as folderView.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `outline-`
 * step screenshots).
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import {
  activeTab,
  appWindow,
  bulletAfterLine,
  contents,
  copyVault,
  indentOutlineLine,
  launchApp,
  openFolder,
  outlineEditor,
  outlineLineIndex,
  outlineLines,
  outlineNested,
  outlineSaid,
  pickOutlineLink,
  quitApp,
  seededState,
  sheet,
  shoot,
  typeOutlineLine,
  viewTabs,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER = 'Funnel Stages'
const SETTINGS_FILE = path.join(FOLDER, '.folder.md')
/** The notes that live in the folder — its rows, whatever the outline says. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
/** The page this spec links to from the outline: a kpi, so it lives in ANOTHER folder. */
const SUBJECT = 'CAC'
const SUBJECT_FILE = path.join('KPIs', 'CAC.md')

/** The document the settings file ships, as the editor RENDERS it — one bullet per line. */
const BODY = [
  'Funnel Stages',
  'The stages a deal walks through, from first touch to closed-won. Every note in this',
  'folder is one of them — there is no list to maintain.',
]
/** …and as the EDITOR re-serialises it, once the document has been typed into at all (Milkdown's own `* `). */
const BODY_COMMITTED = BODY.map((line) => `* ${line}`)

/** The two text lines the document grows; neither is a link. */
const NOTE = 'Only the notes in the folder are its rows'
const CHILD = 'and this one is nested under it'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

/** The name cell shows the page TITLE — the basename, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-table__link')

const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')

/** One outline view, as the folder's settings hold it. */
interface OnDiskView {
  type?: string
  name?: string
  outline?: string
}

/** The folder's outline VIEW as written — parsed, never string-matched (folderColumns.spec.ts's rule). */
async function outlineViewOnDisk(): Promise<OnDiskView> {
  const { frontmatter } = splitFrontmatter(await read(SETTINGS_FILE))
  const settings = (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { views?: OnDiskView[] }
  return settings.views?.find((v) => v.type === 'outline') ?? {}
}

/** The stored document itself. */
const outlineOnDisk = async (): Promise<string> => (await outlineViewOnDisk()).outline ?? ''

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'outline-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — first open: the document is what the settings ship, opening writes nothing, and a typed line is one settings write', async () => {
  const shipped = await read(SETTINGS_FILE)

  app = await launchApp({ userData, seedState: seededState(vault, null) })
  win = await appWindow(app, 'w1')
  await openFolder(win, path.join(vault, FOLDER))
  await expect(activeTab(win)).toHaveText(FOLDER)

  // THE FIRST OPEN: the outline is the folder's first view, and what it shows is the stored
  // document — three lines of prose, and not one line for a note (YAZ-2290 D5). A mere look
  // is not an edit: the settings file is byte-identical once the editor has mounted.
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table', 'Board'])
  await expect(outlineLines(contents(win))).toHaveText(BODY)
  expect(await read(SETTINGS_FILE)).toBe(shipped)
  await shoot(win, 'outline-01-shipped-document')

  // The user's own text lives in the very same document, under the prose.
  await typeOutlineLine(win, contents(win), BODY.length - 1, NOTE)

  // ONE `folder_page_settings` write, debounced 500ms — and the editor re-serialises the WHOLE
  // document, so this is where a shipped line could have been lost: every one of them is still
  // here, in Milkdown's own `* ` spelling, with the typed line after them.
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(NOTE)
  const view = await outlineViewOnDisk()
  expect(view.name).toBe('Outline') // the view itself is untouched — only its content key moved
  expect(view.outline?.split('\n').filter((l) => l.trim() !== '')).toEqual([...BODY_COMMITTED, `* ${NOTE}`])

  // TEXT MEANS NOTHING to what the folder holds: its rows are the notes in it, as before.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(MEMBERS)
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect(sheet(win)).toHaveCount(0)
  await shoot(win, 'outline-02-text-line')
})

test('step 2 — `[[` picks a page, and the link line is JUST a link: the picked page and the folder’s rows do not move', async () => {
  const before = await read(SUBJECT_FILE)

  await bulletAfterLine(win, contents(win), await outlineLineIndex(contents(win), NOTE))
  await pickOutlineLink(win, SUBJECT, 'outline-03-picker')

  // The picker inserts PLAIN TEXT `[[CAC]]`, and the document — the ONE thing that moved — holds
  // it, typed in by hand under the note line.
  await expect.poll(() => outlineSaid(contents(win))).toEqual([...BODY, NOTE, `[[${SUBJECT}]]`])
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(`* [[${SUBJECT}]]`)
  // A link in an outline says nothing about what the folder holds (YAZ-2290 D5): the picked page's
  // own file is byte for byte what it was, and no sheet asked about anything.
  expect(await read(SUBJECT_FILE)).toBe(before)
  await expect(sheet(win)).toHaveCount(0)

  // …and CAC lives in `KPIs`, so it is no row of THIS folder: the Table has not moved either.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(MEMBERS)
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await shoot(win, 'outline-04-linked')
})

test('step 3 — Tab indents, and the nesting is in the document itself', async () => {
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), NOTE), CHILD)
  await indentOutlineLine(win, contents(win), CHILD)

  // The editor's own DOM says it: a bullet list inside a bullet list, which is the only shape the
  // bullets-only lock allows to nest at all.
  await expect(outlineNested(contents(win))).toHaveText([CHILD])
  // And so does the document on disk — two spaces deeper than the line it hangs from.
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(`* ${NOTE}\n  * ${CHILD}`)
  // The link line is a SIBLING of the text, not a casualty of it: still depth 0.
  expect(await outlineOnDisk()).toContain(`\n* [[${SUBJECT}]]`)
  await shoot(win, 'outline-05-nested')
})

test('step 4 — bullets-only: `# heading` typed in a bullet is nine literal characters', async () => {
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), CHILD), '# heading')

  // 🔒 F3: the narrowed `list_item` schema makes the markdown input rule DECLINE rather than fire,
  // so the characters stay standing as list text and no heading node is ever created.
  await expect(outlineEditor(contents(win)).locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0)
  await expect(outlineLines(contents(win)).filter({ hasText: '# heading' })).toHaveCount(1)
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain('# heading')
  await shoot(win, 'outline-06-bullets-only')
})

test('step 5 — the document lives in the settings file, not in the session: it survives quit → relaunch', async () => {
  const document = await outlineOnDisk()
  await quitApp(app) // the REAL quit path: the pending settings write is flushed before exit

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  // The folder's tab is restored like any other, on its first view — the outline.
  await expect(activeTab(win)).toHaveText(FOLDER)
  await expect(contents(win)).toBeVisible()

  // The text, the nesting, the shipped prose and the link, read back out of the one place they
  // live — BYTE FOR BYTE the document the quit flushed: a mount that types nothing writes nothing.
  await expect(outlineLines(contents(win)).filter({ hasText: NOTE })).toHaveCount(1)
  await expect(outlineNested(contents(win)).filter({ hasText: CHILD })).toHaveCount(1)
  await expect(outlineLines(contents(win)).first()).toHaveText(BODY[0])
  await expect(outlineLines(contents(win)).last()).toHaveText(`[[${SUBJECT}]]`)
  expect(await outlineOnDisk()).toBe(document)

  // What the folder holds was never the document's to say: the Table answers it, and it is the
  // three notes that have lived there all along.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(MEMBERS)
  await shoot(win, 'outline-07-survives-relaunch')

  await quitApp(app)
})
