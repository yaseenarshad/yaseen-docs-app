/**
 * The table of contents of a note, in the REAL app (YAZ-2700, decisions D1–D15 on YAZ-2701):
 *  - NAMES OR LINES (D3, D4): a note shows the names of its rows at its right edge when the text
 *    column keeps its full width beside them, and small lines when it does not. The mouse on the
 *    lines opens a card with the same names.
 *  - A CLICK GOES THERE (D7): the row lands 24px below the top of the note's scroller, the caret is
 *    in it, and the file on disk is not written.
 *  - THE KEYBOARD (D8): ⌘J puts the keyboard on the current name; ↑ ↓ Home End move, ⏎ goes, Esc
 *    and a second ⌘J give the caret back to the note.
 *  - "Pin" AND "Unpin" (D2, D10) write the ONE app-wide setting, `settings.tableOfContents`.
 *  - HEADINGS OR BULLETS (D6, D14): a note of bullets lists its bullets, three levels deep. The
 *    cog's "TOC made from:" selects the source for one note, and the app saves that choice in
 *    `folders[root].tocSources`: it is there after the note is closed and after a restart.
 *  - THE PAGE SWITCHES (D12, D15): "Table of contents" hides it on this page, and "Heading
 *    levels" shows each heading's level tag. Neither is stored.
 *
 * The widths: the names need a note area of 1240px at content width "Narrow" (1040 + 200). The
 * window starts 1480px wide with the sidebar at its minimum, 180px, so the note area is 1300px.
 * Then the window goes to 1100px (a note area of 920px): lines, and still wide enough for "Pin"
 * (700px).
 *
 * Serial (the suite's idiom): each step continues the last.
 */
// Written for YAZ-2700. Not yet run: Playwright was off limits when this was written, so every
// selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SIDEBAR_MIN_W } from '../../shared/types'
import { activeTab, appWindow, clickMenuItem, editorOf, fileRow, launchApp, layer, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

/** Enough paragraphs under a row that the row can reach the top of the scroller. */
const filler = (tag: string, count: number): string => Array.from({ length: count }, (_, i) => `${tag} filler line ${i + 1}.`).join('\n\n')

/** A note of headings: six H1–H3 outside lists, and one small list that "Bullets" reads. */
const CHAPTERS = `# Guide

Intro paragraph.

## Setup

* Step one
  * Detail
* Step two

${filler('Setup', 12)}

### Install

${filler('Install', 12)}

## Usage

${filler('Usage', 12)}

## Reference

${filler('Reference', 12)}

## Appendix

${filler('Appendix', 40)}
`
const HEADING_ROWS = ['Guide', 'Setup', 'Install', 'Usage', 'Reference', 'Appendix']
const HEADING_LEVELS = ['1', '2', '3', '2', '2', '2']
/** What "Bullets" gives for the same note: its one list, two levels deep. */
const CHAPTER_BULLETS = ['Step one', 'Detail', 'Step two']

/** A note of bullets with no heading. "Too deep to list" is a fourth level, so it is no row. */
const BULLETS = `* Plan
  * Scope
    * Goals
      * Too deep to list
  * Risks
* Build
  * Engine
* Ship

${filler('Tail', 60)}
`
const BULLET_ROWS = ['Plan', 'Scope', 'Goals', 'Risks', 'Build', 'Engine', 'Ship']
const BULLET_LEVELS = ['1', '2', '3', '2', '1', '2', '1']

const WIDE = 1480
const NARROW = 1100
/** A row lands this far below the top of the scroller (`LANDING_PX`, tocPlugin.ts). */
const LANDING_PX = 24

let userData: string
let vault: string
let chaptersPath: string
let bulletsPath: string
let app: ElectronApplication
let win: Page

const host = (w: Page) => layer(w).locator('.editor-host')
const toc = (w: Page) => layer(w).locator('nav.toc')
const names = (w: Page) => toc(w).locator('.toc__name')
const lines = (w: Page) => toc(w).locator('.toc__line')
const rail = (w: Page) => toc(w).locator('.toc__rail')
const card = (w: Page) => toc(w).locator('.toc__card')
const cog = (w: Page) => layer(w).locator('.page-settings__trigger')
const menu = (w: Page) => layer(w).locator('.page-settings__menu')
/** A switch of the cog's menu by its label: "Table of contents", "Heading levels". */
const pageSwitch = (w: Page, label: string) => menu(w).locator('button[aria-pressed]', { hasText: label })
/** A choice of "TOC made from:": Auto, Headings, Bullets. */
const sourceChoice = (w: Page, label: 'Auto' | 'Headings' | 'Bullets') => menu(w).locator('.page-settings__choices button', { hasText: new RegExp(`^${label}$`) })

const levelsOf = (rows: Locator): Promise<(string | null)[]> => rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-level')))

/**
 * Where the block that reads `text` stands: its top below the top of the note's scroller, and
 * whether the caret is in it with the keyboard in the note. `kind` is `h` for a heading, and `li`
 * for a bullet (the element that Crepe's node view makes for a list item).
 */
const blockOf = (w: Page, kind: 'h' | 'li', text: string): Promise<{ top: number; caret: boolean } | null> =>
  host(w).evaluate(
    (scroller, arg) => {
      const labels = Array.from(scroller.querySelectorAll(arg.kind === 'h' ? '.ProseMirror :is(h1, h2, h3)' : '.ProseMirror .milkdown-list-item-block .content-dom > p'))
      const label = labels.find((el) => (el.textContent ?? '').trim() === arg.text)
      if (label === undefined) return null
      const block = arg.kind === 'h' ? label : label.closest('.milkdown-list-item-block')
      if (block === null) return null
      const anchor = document.getSelection()?.anchorNode ?? null
      const active = document.activeElement
      return {
        top: block.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        caret: anchor !== null && label.contains(anchor) && active !== null && active.classList.contains('ProseMirror'),
      }
    },
    { kind, text },
  )

/** The row landed: 24px below the top of the scroller (a pixel of rounding either way), the caret in it. */
async function expectLanded(w: Page, kind: 'h' | 'li', text: string): Promise<void> {
  await expect
    .poll(async () => {
      const at = await blockOf(w, kind, text)
      return at !== null && Math.abs(at.top - LANDING_PX) <= 1 && at.caret
    })
    .toBe(true)
}

async function setWindowWidth(width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, w) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(w, 750)
  }, width)
}

/** The card, opened by the mouse on the lines. */
async function openCardByMouse(w: Page): Promise<void> {
  await rail(w).hover()
  await expect(card(w)).toBeVisible()
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'toc-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'toc-vault-'))
  chaptersPath = path.join(vault, 'Chapters.md')
  bulletsPath = path.join(vault, 'Bullets.md')
  await Promise.all([writeFile(chaptersPath, CHAPTERS), writeFile(bulletsPath, BULLETS)])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a wide window shows the names of the headings beside the text', async () => {
  const state = seededState(vault, chaptersPath)
  state.sidebarWidth = SIDEBAR_MIN_W
  state.windows[0].bounds.width = WIDE
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win).locator('h2', { hasText: 'Appendix' })).toBeAttached()

  // The rule needs room: a display narrower than the seeded window gives lines, and this step cannot pass.
  const noteWidth = await layer(win).locator('section.editor').evaluate((section) => section.clientWidth)
  expect(noteWidth, `the note area is ${noteWidth}px; the names need 1240px (is the display narrower than ${WIDE}px?)`).toBeGreaterThanOrEqual(1240)

  await expect(toc(win)).toHaveAttribute('aria-label', 'Table of contents')
  await expect(toc(win)).toHaveAttribute('data-names', '')
  await expect(names(win)).toHaveText(HEADING_ROWS)
  expect(await levelsOf(names(win))).toEqual(HEADING_LEVELS)
  // The note is at its top: the first name is the current one, and the list has one tab stop.
  await expect(names(win).first()).toHaveAttribute('aria-current', 'true')
  await expect(toc(win).locator('.toc__name[tabindex="0"]')).toHaveCount(1)
  // The scroller makes the room, so the names cover no text; and there are no lines and no card.
  await expect(host(win)).toHaveCSS('padding-right', '200px')
  await expect(rail(win)).toHaveCount(0)
  await expect(card(win)).toHaveCount(0)
  // "When there is room" on a wide window: no button, the names would show in each case.
  await expect(toc(win).locator('.toc__pin')).toHaveCount(0)
  await shoot(win, 'toc-01-names')
})

test('step 2 — a narrow window shows the lines; the mouse on them opens the card with the names', async () => {
  await setWindowWidth(NARROW)

  await expect(layer(win).locator('nav.toc[data-names]')).toHaveCount(0)
  await expect(rail(win)).toBeVisible()
  await expect(rail(win)).toHaveAttribute('aria-expanded', 'false')
  await expect(lines(win)).toHaveCount(HEADING_ROWS.length)
  expect(await levelsOf(lines(win))).toEqual(HEADING_LEVELS)
  await expect(toc(win).locator('.toc__line[data-current]')).toHaveCount(1)
  await expect(host(win)).toHaveCSS('padding-right', '0px')
  await expect(card(win)).toHaveCount(0)
  await shoot(win, 'toc-02-lines')

  await openCardByMouse(win)
  await expect(rail(win)).toHaveAttribute('aria-expanded', 'true')
  await expect(card(win).locator('.toc__title')).toHaveText('Table of contents')
  await expect(card(win).locator('.toc__name')).toHaveText(HEADING_ROWS)
  // The note area is 700px wide or more, and the setting is "When there is room": "Pin" is offered.
  await expect(card(win).locator('.toc__pin')).toHaveText('Pin')
  await shoot(win, 'toc-03-card')
})

test('step 3 — a click on a row lands its heading 24px below the top, with the caret in it, and writes nothing', async () => {
  await card(win).locator('.toc__name', { hasText: 'Reference' }).click()

  await expectLanded(win, 'h', 'Reference')
  // From the card, the card closes; the row that was clicked is the current one.
  await expect(card(win)).toHaveCount(0)
  await expect(lines(win).nth(HEADING_ROWS.indexOf('Reference'))).toHaveAttribute('data-current', '')
  await expect(toc(win).locator('.toc__line[data-current]')).toHaveCount(1)
  // View state only: the file on disk has the bytes it had.
  expect(await readFile(chaptersPath, 'utf8')).toBe(CHAPTERS)
  await shoot(win, 'toc-04-landed')
})

test('step 4 — ⌘J puts the keyboard on the current name; the arrows move, ⏎ goes, Esc gives the caret back', async () => {
  // The caret is in the note, after the jump of step 3.
  await win.keyboard.press('Meta+j')
  await expect(card(win)).toBeVisible()
  await expect(names(win).nth(HEADING_ROWS.indexOf('Reference'))).toBeFocused()
  await expect(names(win).nth(HEADING_ROWS.indexOf('Reference'))).toHaveAttribute('aria-current', 'true')

  await win.keyboard.press('ArrowUp')
  await expect(names(win).nth(HEADING_ROWS.indexOf('Usage'))).toBeFocused()
  await win.keyboard.press('Enter')
  await expectLanded(win, 'h', 'Usage')
  await expect(card(win)).toHaveCount(0)

  // Home and End, then Esc: the card closes and the keyboard is in the note again.
  await win.keyboard.press('Meta+j')
  await expect(names(win).nth(HEADING_ROWS.indexOf('Usage'))).toBeFocused()
  await win.keyboard.press('Home')
  await expect(names(win).first()).toBeFocused()
  await win.keyboard.press('End')
  await expect(names(win).last()).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(card(win)).toHaveCount(0)
  await expect(editorOf(win)).toBeFocused()

  // A second ⌘J from inside the list is Esc.
  await win.keyboard.press('Meta+j')
  await expect(card(win)).toBeVisible()
  await win.keyboard.press('Meta+j')
  await expect(card(win)).toHaveCount(0)
  await expect(editorOf(win)).toBeFocused()
  expect(await readFile(chaptersPath, 'utf8')).toBe(CHAPTERS)
})

test('step 5 — "Pin" and "Unpin" write the one app-wide setting', async () => {
  await openCardByMouse(win)
  await card(win).locator('.toc__pin').click()

  // Pinned: the names show in this narrow window too, and "Unpin" is offered because it changes what shows here.
  await expect(toc(win)).toHaveAttribute('data-names', '')
  await expect(names(win)).toHaveText(HEADING_ROWS)
  await expect(toc(win).locator('.toc__pin--off')).toHaveText('Unpin')
  await expect.poll(async () => (await readState(userData)).settings.tableOfContents).toBe('pinned')
  await shoot(win, 'toc-05-pinned')

  await toc(win).locator('.toc__pin--off').click()
  await expect(layer(win).locator('nav.toc[data-names]')).toHaveCount(0)
  await expect(rail(win)).toBeVisible()
  await expect.poll(async () => (await readState(userData)).settings.tableOfContents).toBe('auto')
})

test('step 6 — a note of bullets lists its bullets, three levels deep, and a click lands on the bullet', async () => {
  await fileRow(win, 'Bullets').click()
  await expect(activeTab(win)).toContainText('Bullets')
  await expect(editorOf(win).getByText('Tail filler line 60.')).toBeAttached()

  await expect(lines(win)).toHaveCount(BULLET_ROWS.length)
  expect(await levelsOf(lines(win))).toEqual(BULLET_LEVELS)
  await openCardByMouse(win)
  await expect(card(win).locator('.toc__name')).toHaveText(BULLET_ROWS)
  await shoot(win, 'toc-06-bullets')

  await card(win).locator('.toc__name', { hasText: 'Build' }).click()
  await expectLanded(win, 'li', 'Build')
  await expect(card(win)).toHaveCount(0)
  expect(await readFile(bulletsPath, 'utf8')).toBe(BULLETS)
})

test('step 7 — "TOC made from:" selects the source of one note, and the choice is there after a reopen and a restart', async () => {
  await fileRow(win, 'Chapters').click()
  await expect(activeTab(win)).toContainText('Chapters')
  await expect(lines(win)).toHaveCount(HEADING_ROWS.length)

  await cog(win).click()
  await expect(menu(win).locator('.page-settings__label')).toContainText('TOC made from:')
  await expect(sourceChoice(win, 'Auto')).toHaveAttribute('aria-pressed', 'true')
  await sourceChoice(win, 'Bullets').click()
  // A change of the source scans at once: the rows are the bullets of the note now.
  await expect(sourceChoice(win, 'Bullets')).toHaveAttribute('aria-pressed', 'true')
  await expect(sourceChoice(win, 'Auto')).toHaveAttribute('aria-pressed', 'false')
  await expect(lines(win)).toHaveCount(CHAPTER_BULLETS.length)
  await shoot(win, 'toc-07-made-from-bullets')
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)

  // Saved for this note in the state file of the app, and never in the note.
  await expect.poll(async () => (await readState(userData)).folders[vault]?.tocSources[chaptersPath], { timeout: 10_000 }).toBe('bullets')
  expect((await readState(userData)).folders[vault]?.tocSources[bulletsPath]).toBeUndefined()
  expect(await readFile(chaptersPath, 'utf8')).toBe(CHAPTERS)

  // The note closed and opened again: its rows are its bullets, and the cog says so.
  await clickMenuItem(app, 'menu.file.close-tab', 'w1')
  await expect(activeTab(win)).toContainText('Bullets')
  await fileRow(win, 'Chapters').click()
  await expect(activeTab(win)).toContainText('Chapters')
  await expect(lines(win)).toHaveCount(CHAPTER_BULLETS.length)
  await openCardByMouse(win)
  await expect(card(win).locator('.toc__name')).toHaveText(CHAPTER_BULLETS)
  await cog(win).click()
  await expect(sourceChoice(win, 'Bullets')).toHaveAttribute('aria-pressed', 'true')
  await win.keyboard.press('Escape')

  // The app quit and started again: the choice is still there.
  await quitApp(app)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(activeTab(win)).toContainText('Chapters')
  await expect(lines(win)).toHaveCount(CHAPTER_BULLETS.length)
  expect((await readState(userData)).folders[vault]?.tocSources[chaptersPath]).toBe('bullets')
})

test('step 8 — the page switches: "Table of contents" hides it on this page, "Heading levels" shows each level tag; neither is stored', async () => {
  /** The level tag of the heading that reads `text`: the text and the opacity of its `::after`. */
  const tagOf = (text: string): Promise<{ content: string; opacity: string }> =>
    editorOf(win)
      .locator('h2', { hasText: text })
      .evaluate((heading) => {
        const after = getComputedStyle(heading, '::after')
        return { content: after.content, opacity: after.opacity }
      })

  await cog(win).click()
  await expect(pageSwitch(win, 'Table of contents')).toHaveAttribute('aria-pressed', 'true')
  await pageSwitch(win, 'Table of contents').click()
  await expect(pageSwitch(win, 'Table of contents')).toHaveAttribute('aria-pressed', 'false')
  // Off for this page: no lines, no names, and no "TOC made from:" (there is nothing to build).
  await expect(toc(win)).toHaveCount(0)
  await expect(menu(win).locator('.page-settings__label')).toHaveCount(0)
  await win.keyboard.press('Escape')
  await shoot(win, 'toc-08-off-for-this-page')
  // ⌘J does nothing on this page.
  await editorOf(win).locator('h1').click()
  await win.keyboard.press('Meta+j')
  await expect(toc(win)).toHaveCount(0)

  // On again: the saved source is still there.
  await cog(win).click()
  await pageSwitch(win, 'Table of contents').click()
  await expect(lines(win)).toHaveCount(CHAPTER_BULLETS.length)
  await expect(sourceChoice(win, 'Bullets')).toHaveAttribute('aria-pressed', 'true')

  // "Heading levels": a heading that has neither the caret nor the mouse shows its tag only with the switch on.
  await expect(pageSwitch(win, 'Heading levels')).toHaveAttribute('aria-pressed', 'false')
  expect(await tagOf('Appendix')).toEqual({ content: '"H2"', opacity: '0' })
  await pageSwitch(win, 'Heading levels').click()
  await expect(pageSwitch(win, 'Heading levels')).toHaveAttribute('aria-pressed', 'true')
  await expect(host(win)).toHaveAttribute('data-heading-levels', 'true')
  await expect.poll(() => tagOf('Appendix')).toEqual({ content: '"H2"', opacity: '0.55' })
  await win.keyboard.press('Escape')
  await shoot(win, 'toc-09-heading-levels')

  // Neither switch reaches the state file: the app-wide setting is what it was, and no key names a page switch.
  const state = await readState(userData)
  expect(state.settings.tableOfContents).toBe('auto')
  expect(JSON.stringify(state).replaceAll(vault, '')).not.toMatch(/heading.?levels|page.?settings/i)
  expect(await readFile(chaptersPath, 'utf8')).toBe(CHAPTERS)
})
