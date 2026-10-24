/**
 * CMD+F IN-PAGE FIND, end to end (YAZ-970, proving YAZ-962): Chrome-style find in the REAL app —
 * highlights, the N-of-M counter, Enter cycling, fold auto-reveal with the landing exception, and
 * the routing rule between the note editor and a folder's outline editor.
 *
 * The two proofs that are THE feature:
 *   1 a match hidden inside a collapsed bullet is revealed the moment the query matches it, and
 *     Esc puts the fold back — unless the reader LANDED inside it (the fold under the active
 *     match stays open, so Esc never hides your own caret);
 *   2 the whole session — open, type, cycle, reveal, close — leaves the file on disk
 *     byte-identical, proven after a real quit (the autosave flush point).
 *
 * Routing (locked in YAZ-967, visibility amendment YAZ-970): each editor has its own bar; CMD+F
 * belongs to an outline while focus stands inside it, and to the note editor otherwise — and a
 * folder's tab (YAZ-2290) has no note editor at all, so there the outline answers from anywhere.
 *
 * Same harness as every spec here: temp `--user-data-dir`, a COPY of the fixture vault, nothing
 * sleeps — every wait is a locator assertion on the UI consequence.
 */
// Rewritten for YAZ-2290 (folders are the pages). Not yet run: Playwright was off limits when this was written,
// so every selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  CHILD_BULLET,
  contents,
  copyVault,
  launchApp,
  md5,
  openFolder,
  outlineEditor,
  outlineLines,
  quitApp,
  searchBar,
  SEED_FILE,
  seededState,
  shoot,
  showSearchTab,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const bar = (w: Page) => w.locator('.find-bar')
const input = (w: Page) => w.locator('.find-bar__input')
const counter = (w: Page) => w.locator('.find-bar__count')
const matches = (w: Page) => w.locator('.find-match')
const active = (w: Page) => w.locator('.find-match--active')
const folded = (w: Page) => w.locator('[data-outline-folded="true"]')

test.describe('note page: highlights, cycling, fold reveal, untouched disk', () => {
  let userData: string
  let vault: string
  let app: ElectronApplication
  let win: Page
  let seedBefore: string

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'find-e2e-'))
    vault = await copyVault(await buildFixtureVault())
    seedBefore = await md5(path.join(vault, SEED_FILE))
    app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
    win = await appWindow(app, 'w1')
    await expect(win.locator('.editor-mount .ProseMirror')).toBeVisible()
  })

  test.afterAll(async () => {
    await rm(userData, { recursive: true, force: true })
    await rm(vault, { recursive: true, force: true })
  })

  test('a collapsed match is revealed, cycled to, and the fold restored per the landing rule', async () => {
    // The fixture's "Parent bullet" owns two children; collapse it so 2 of the 3 "bullet"
    // matches start hidden.
    await win.locator('.outline-toggle').first().click()
    await expect(folded(win)).toHaveCount(1)

    await win.keyboard.press('Meta+f')
    await expect(bar(win)).toBeVisible()
    await expect(input(win)).toBeFocused()

    await input(win).fill('bullet')
    await expect(counter(win)).toHaveText('1 of 3')
    // The reveal: the fold hiding matches 2 and 3 opened the moment the query matched inside it.
    await expect(folded(win)).toHaveCount(0)
    await expect(matches(win)).toHaveCount(3)
    await expect(active(win)).toHaveText('bullet')
    await shoot(win, 'find-note-revealed')

    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('2 of 3')
    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('3 of 3')
    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('1 of 3')
    await win.keyboard.press('Shift+Enter')
    await expect(counter(win)).toHaveText('3 of 3')

    // Esc with the active match INSIDE the revealed fold: the landing stays open.
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
    await expect(matches(win)).toHaveCount(0)
    await expect(folded(win)).toHaveCount(0)
    await shoot(win, 'find-note-landing-open')

    // Same search again, but END on the top-level first hit: now Esc puts the fold back exactly
    // as the reader had it. Collapse by hand first (Esc's landing left it open), then reopen —
    // the channel kept the query, and the active match starts from the caret Esc landed (3 of 3).
    await win.locator('.outline-toggle').first().click()
    await expect(folded(win)).toHaveCount(1)
    await win.keyboard.press('Meta+f')
    await expect(counter(win)).toHaveText('3 of 3')
    await expect(folded(win)).toHaveCount(0)
    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('1 of 3')
    await win.keyboard.press('Escape')
    await expect(folded(win)).toHaveCount(1)
    await shoot(win, 'find-note-fold-restored')
  })

  test(`the query also finds "${CHILD_BULLET}" case-insensitively`, async () => {
    await win.keyboard.press('Meta+f')
    await input(win).fill('child bullet ALPHA')
    await expect(counter(win)).toHaveText('1 of 1')
    await expect(active(win).first()).toBeVisible()
    await win.keyboard.press('Escape')
  })

  test('the whole session left the note byte-identical on disk (proven after a real quit)', async () => {
    await quitApp(app)
    expect(await md5(path.join(vault, SEED_FILE))).toBe(seedBefore)
  })
})

// YAZ-2691. Like the rest of this file, written from the source and not yet run here (Playwright takes over the screen).
test.describe('a paragraph taller than the window: the jump lands on the match', () => {
  /** One paragraph of 600 soft-wrapped lines, many windows tall. "zebra" stands on two late lines; a line end splits "zebra quartz". */
  const TALL_FILE = 'Tall paragraph.md'
  let userData: string
  let vault: string
  let app: ElectronApplication
  let win: Page

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'find-e2e-tall-'))
    vault = await copyVault(await buildFixtureVault())
    const lines = Array.from({ length: 600 }, (_, i) =>
      i === 480 ? 'the price of zebra' : i === 481 ? 'quartz went down' : i === 560 ? 'and zebra again' : `filler line number ${i}`,
    )
    await writeFile(path.join(vault, TALL_FILE), `# Tall\n\n${lines.join('\n')}\n`)
    app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, TALL_FILE)) })
    win = await appWindow(app, 'w1')
    await expect(win.locator('.editor-mount .ProseMirror')).toBeVisible()
  })

  test.afterAll(async () => {
    await quitApp(app)
    await rm(userData, { recursive: true, force: true })
    await rm(vault, { recursive: true, force: true })
  })

  test('each match is in the window after the query and after Enter, and a phrase is found across a line end', async () => {
    await win.keyboard.press('Meta+f')
    await input(win).fill('zebra')
    await expect(counter(win)).toHaveText('1 of 2')
    // Before the fix the window stopped at the middle of the paragraph, ~line 300, with both matches far below it.
    await expect(active(win)).toBeInViewport()
    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('2 of 2')
    await expect(active(win)).toBeInViewport()

    // A soft line end reads as one space; the highlight is painted in parts, around the break.
    await input(win).fill('zebra quartz')
    await expect(counter(win)).toHaveText('1 of 1')
    await expect(active(win).first()).toBeInViewport()
    await shoot(win, 'find-tall-paragraph')
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
  })
})

test.describe('folder tab: CMD+F belongs to the outline, the only editor it has', () => {
  const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
  /** The folder whose settings file ships an outline document — three lines of prose (YAZ-2290). */
  const FOLDER = 'Funnel Stages'
  /** A word that document says exactly once. */
  const WORD = 'deal'
  let userData: string
  let vault: string
  let app: ElectronApplication
  let win: Page

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'find-e2e-folder-'))
    vault = await copyVault(FIXTURE)
    app = await launchApp({ userData, seedState: seededState(vault, null) })
    win = await appWindow(app, 'w1')
    // The folder opens on its first view, the outline, showing the document its settings hold.
    await openFolder(win, path.join(vault, FOLDER))
    await expect(outlineEditor(contents(win))).toBeVisible()
    await expect(outlineLines(contents(win))).toHaveCount(3)
  })

  test.afterAll(async () => {
    await quitApp(app)
    await rm(userData, { recursive: true, force: true })
    await rm(vault, { recursive: true, force: true })
  })

  test('focus in the outline view: CMD+F opens the outline bar and finds its text', async () => {
    await outlineEditor(contents(win)).click()
    await win.keyboard.press('Meta+f')
    await expect(bar(win)).toHaveCount(1)
    await expect(win.locator('.view-outline-editor .find-bar')).toBeVisible()
    await input(win).fill(WORD)
    await expect(counter(win)).toHaveText('1 of 1')
    await expect(win.locator('.view-outline-editor .find-match--active')).toHaveText(WORD)
    await shoot(win, 'find-outline-active')
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
  })

  test('focus outside the editor: the outline still answers — a folder’s tab HAS no note editor', async () => {
    // A folder's tab mounts no note editor at all (YAZ-2290 D9): the views stand where a note's
    // body would be. So there is no note bar to claim the key, and the visibility amendment
    // routes CMD+F to the outline even from the sidebar. The sidebar's search bar is on the
    // Search tab only (YAZ-2638 D2), so the tab is shown first.
    await expect(win.locator('.editor-mount')).toHaveCount(0)
    await showSearchTab(win)
    await searchBar(win).click()
    await expect(searchBar(win)).toBeFocused()
    await win.keyboard.press('Meta+f')
    await expect(bar(win)).toHaveCount(1)
    await expect(win.locator('.view-outline-editor .find-bar')).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
  })
})

test.describe('the bullet thread follows the active match (YAZ-3166)', () => {
  const THREAD_FILE = 'Thread.md'
  let userData: string
  let vault: string
  let app: ElectronApplication
  let win: Page

  /** Each nested list on the path stops at its path child; the deepest stop is the anchor's own bullet. */
  const stop = (w: Page) => w.locator('.milkdown-list-item-block.outline-thread-stop')
  /** The anchor bullet's own line: the deepest stop's first paragraph, not the bullets below it. */
  const stopLine = (w: Page) => stop(w).last().locator('p').first()
  const line = (w: Page, text: string) => w.locator('.editor-mount .ProseMirror p', { hasText: text })

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'find-e2e-thread-'))
    vault = await copyVault(await buildFixtureVault())
    await writeFile(
      path.join(vault, THREAD_FILE),
      [
        '# Thread',
        '',
        '- Alpha parent',
        '  - Alpha child',
        '    - The first zebra line',
        '- Beta parent',
        '  - Beta child',
        '    - Beta grandchild',
        '      - The second zebra line',
        '- Gamma caret line',
        '',
      ].join('\n'),
    )
    app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, THREAD_FILE)) })
    win = await appWindow(app, 'w1')
    await expect(win.locator('.editor-mount .ProseMirror')).toBeVisible()
  })

  test.afterAll(async () => {
    await quitApp(app)
    await rm(userData, { recursive: true, force: true })
    await rm(vault, { recursive: true, force: true })
  })

  test('each step moves the thread to the match, a click gives it back to the caret, and Esc lands on the match', async () => {
    // The caret stands in a top-level bullet below both matches: a top-level item has no segment.
    await line(win, 'Gamma caret line').click()
    await expect(stop(win)).toHaveCount(0)

    await win.keyboard.press('Meta+f')
    await input(win).fill('zebra')
    await expect(counter(win)).toHaveText('1 of 2')
    await expect(stop(win)).toHaveCount(2)
    await expect(stopLine(win)).toHaveText('The first zebra line')

    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('2 of 2')
    await expect(stopLine(win)).toHaveText('The second zebra line')
    await expect(win.locator('.outline-thread-node')).toHaveCount(4)
    await shoot(win, 'find-thread-on-match')

    // A click in the note moves the caret: the thread goes back to it, and the bar stays open.
    await line(win, 'Alpha child').click()
    await expect(stopLine(win)).toHaveText('Alpha child')
    await expect(counter(win)).toHaveText('2 of 2')

    // The next step brings it back to the match.
    await win.getByRole('button', { name: 'Next match' }).click()
    await expect(counter(win)).toHaveText('1 of 2')
    await expect(stopLine(win)).toHaveText('The first zebra line')

    // Esc puts the caret on the match, so the thread does not move.
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
    await expect(stopLine(win)).toHaveText('The first zebra line')
  })

  test("a click on the caret's own spot gives the thread back, though the caret does not move (YAZ-3200)", async () => {
    // The caret at the END of a top-level line: its thread is the one glyph, with no stop.
    const target = line(win, 'Gamma caret line')
    const box = (await target.boundingBox())!
    const atEnd = { position: { x: box.width - 4, y: box.height / 2 } }
    await target.click(atEnd)
    await expect(stop(win)).toHaveCount(0)

    await win.keyboard.press('Meta+f')
    await input(win).fill('zebra')
    await expect(counter(win)).toHaveText('1 of 2')
    await expect(stopLine(win)).toHaveText('The first zebra line')

    // The same click again: ProseMirror sends no transaction, and the bar stays open.
    await target.click(atEnd)
    await expect(counter(win)).toHaveText('1 of 2')
    await expect(stop(win)).toHaveCount(0)
    await expect(win.locator('.outline-thread-node')).toHaveCount(1)
    await win.keyboard.press('Escape')
  })

  test('a hover on the thread line keeps the thread on the match (YAZ-3205)', async () => {
    await line(win, 'Gamma caret line').click()
    await win.keyboard.press('Meta+f')
    await input(win).fill('zebra')
    await expect(counter(win)).toHaveText('1 of 2')
    await expect(stopLine(win)).toHaveText('The first zebra line')

    // The pointer rests on the guide line the thread draws (guideLines.ts hit-tests this strip); no click, no key.
    const point = await win.evaluate(() => {
      const list = Array.from(document.querySelectorAll('.editor-mount .ProseMirror ul')).find(
        (ul) => ul.parentElement?.classList.contains('content-dom') && ul.querySelector('p')?.textContent === 'Alpha child',
      )!
      const rect = list.getBoundingClientRect()
      const font = Number.parseFloat(getComputedStyle(list).fontSize) || 16
      return { x: rect.left - ((2.15 * font) / 2 + 5), y: rect.top + 8 }
    })
    await win.mouse.move(point.x - 40, point.y)
    await win.mouse.move(point.x, point.y, { steps: 5 })
    // The fault is that something HAPPENS after the hover (the list redraws, then a selection update); give it the time.
    await win.waitForTimeout(500)
    await expect(counter(win)).toHaveText('1 of 2')
    await expect(stopLine(win)).toHaveText('The first zebra line')
    await win.keyboard.press('Escape')
  })
})
