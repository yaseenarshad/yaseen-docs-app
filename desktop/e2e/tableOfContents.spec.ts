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
 *  - THE EDGE OF THE NAMES (YAZ-2752, decisions D1–D5 on YAZ-2754): a drag of the column's left
 *    edge changes its width, stops at the limits, and writes `settings.tableOfContentsWidth`,
 *    which is there after a restart.
 *  - THE HIERARCHY OF THE NAMES (YAZ-2762, decisions D1–D10 on YAZ-2764): each level has its own
 *    tone. Thin grey lines show the levels, and the lines from the current row up to its parents
 *    are the accent colour (the path). "Level lines" in Settings says when the lines show, and
 *    writes `settings.tocLines`. With "On hover", the path also shows while the wheel turns over
 *    the note.
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
// Step 5c (YAZ-2762) is the same: written and type-checked, and not run.
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SIDEBAR_MIN_W, TOC_DEFAULT_W, TOC_MAX_W, TOC_MIN_W } from '../../shared/types'
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

/** `data-path` of each name: the level line that is on the path at that row, and null for a row that is not on it. */
const pathsOf = (w: Page): Promise<(string | null)[]> => names(w).evaluateAll((els) => els.map((el) => el.getAttribute('data-path')))

type LineState = 'shown' | 'clear' | 'fading'

/**
 * What the list of names draws now. The grey level lines read `--toc-rest` and the path reads
 * `--toc-path` (toc.css): each is `shown` when it is the token it must be (`--border`,
 * `--accent`), `clear` when it is transparent, and `fading` between the two (160 ms).
 * Each colour is read from a probe in the list itself, so both sides of a comparison are written
 * by the same engine in the same way.
 */
const linesOf = (w: Page): Promise<{ grey: LineState; path: LineState }> =>
  toc(w)
    .locator('.toc__names')
    .evaluate((list) => {
      const colourOf = (value: string): string => {
        const probe = document.createElement('span')
        probe.style.color = value
        list.appendChild(probe)
        const colour = getComputedStyle(probe).color
        probe.remove()
        return colour
      }
      const stateOf = (line: string, token: string): 'shown' | 'clear' | 'fading' => {
        const colour = colourOf(`var(${line})`)
        return colour === colourOf(`var(${token})`) ? 'shown' : colour === colourOf('transparent') ? 'clear' : 'fading'
      }
      return { grey: stateOf('--toc-rest', '--border'), path: stateOf('--toc-path', '--accent') }
    })

/**
 * The tones of the names (D1), on names that are not the current one and not below the mouse:
 * level 1 is `--fg` at weight 500, level 2 is the mix of the two text tokens, level 3 is
 * `--fg-muted`, the three are three different colours, and the current name is the accent.
 */
const tonesOf = (w: Page): Promise<{ one: boolean; weight: string; two: boolean; three: boolean; distinct: boolean; current: boolean }> =>
  toc(w)
    .locator('.toc__names')
    .evaluate((list) => {
      const colourOf = (value: string): string => {
        const probe = document.createElement('span')
        probe.style.color = value
        list.appendChild(probe)
        const colour = getComputedStyle(probe).color
        probe.remove()
        return colour
      }
      const styleOf = (selector: string): CSSStyleDeclaration | null => {
        const name = list.querySelector(selector)
        return name === null ? null : getComputedStyle(name)
      }
      const [one, two, three] = [1, 2, 3].map((level) => styleOf(`.toc__name[data-level="${level}"]:not([aria-current])`))
      return {
        one: one?.color === colourOf('var(--fg)'),
        weight: one?.fontWeight ?? '',
        two: two?.color === colourOf('color-mix(in srgb, var(--fg) 55%, var(--fg-muted))'),
        three: three?.color === colourOf('var(--fg-muted)'),
        distinct: new Set([one?.color, two?.color, three?.color]).size === 3,
        current: styleOf('.toc__name[aria-current="true"]')?.color === colourOf('var(--accent)'),
      }
    })

/** The mouse on the text of the note: not on the list, not on the lines. */
async function mouseOnNote(w: Page): Promise<void> {
  const box = await host(w).boundingBox()
  if (box === null) throw new Error('the note has no scroller')
  await w.mouse.move(box.x + box.width / 3, box.y + box.height / 2)
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

  // A scroll of the note opens nothing (YAZ-2886): the current line moves, the card stays shut.
  await mouseOnNote(win)
  await win.mouse.wheel(0, 400)
  await win.waitForTimeout(300)
  await expect(card(win)).toHaveCount(0)
  await expect(rail(win)).toHaveAttribute('aria-expanded', 'false')
  await win.mouse.wheel(0, -400)

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

test('step 5b — the edge of the names: a drag changes the width, stops at the limits, and the app saves it (YAZ-2752)', async () => {
  // Pinned in the 1100px window, the names may take what leaves the text 500px (`TEXT_FLOOR`).
  await openCardByMouse(win)
  await card(win).locator('.toc__pin').click()
  await expect(toc(win)).toHaveAttribute('data-names', '')
  await expect(host(win)).toHaveCSS('padding-right', `${TOC_DEFAULT_W}px`)
  const noteWidth = await layer(win).locator('section.editor').evaluate((section) => section.clientWidth)
  const room = Math.min(TOC_MAX_W, noteWidth - 500)
  expect(room, `the note area is ${noteWidth}px; this step needs room for more than 300px of names`).toBeGreaterThan(300)

  /** Press the edge, move it `dx` px (to the left is wider), and let go. */
  const dragEdge = async (dx: number): Promise<void> => {
    const box = await toc(win).locator('.toc__resize').boundingBox()
    if (box === null) throw new Error('the names column has no edge to drag')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await win.mouse.move(x, y)
    await win.mouse.down()
    await win.mouse.move(x + dx, y, { steps: 5 })
    await win.mouse.up()
  }

  // 100px to the left: the scroller's padding follows the column, and the release writes the setting.
  await dragEdge(-100)
  await expect(host(win)).toHaveCSS('padding-right', '300px')
  await expect.poll(async () => (await readState(userData)).settings.tableOfContentsWidth).toBe(300)
  await shoot(win, 'toc-05b-wider')

  // Far to the left: it stops where the text would get narrower than 500px.
  await dragEdge(-900)
  await expect(host(win)).toHaveCSS('padding-right', `${room}px`)
  await expect.poll(async () => (await readState(userData)).settings.tableOfContentsWidth).toBe(room)

  // Far to the right: it stops at the smallest width. A drag never unpins (D5).
  await dragEdge(900)
  await expect(host(win)).toHaveCSS('padding-right', `${TOC_MIN_W}px`)
  await expect(toc(win)).toHaveAttribute('data-names', '')
  await expect.poll(async () => (await readState(userData)).settings.tableOfContentsWidth).toBe(TOC_MIN_W)
  expect((await readState(userData)).settings.tableOfContents).toBe('pinned')

  // Back to the lines, for the steps below. The width stays saved; step 7 reads it after its restart.
  await toc(win).locator('.toc__pin--off').click()
  await expect(rail(win)).toBeVisible()
})

test('step 5c — the hierarchy of the names: a tone for each level, the level lines on hover, the path after a scroll, and the three choices of "Level lines" (YAZ-2762)', async () => {
  const TONES = { one: true, weight: '500', two: true, three: true, distinct: true, current: true }
  const BOTH = { grey: 'shown', path: 'shown' }
  const NONE = { grey: 'clear', path: 'clear' }
  /** Longer than the fade of the lines (160 ms): a line that would come has come. */
  const PAST_FADE_MS = 500
  const reading = (w: Page) => layer(w).locator('nav.toc[data-reading]')
  const name = (text: string) => names(win).nth(HEADING_ROWS.indexOf(text))

  // "On hover" is the default, in the state file and on the app container, where toc.css reads it.
  expect((await readState(userData)).settings.tocLines).toBe('hover')
  await expect(win.locator('.app')).toHaveAttribute('data-toc-lines', 'hover')

  // The card has the same list (D4): the lines show while the mouse is on its names.
  await openCardByMouse(win)
  await card(win).locator('.toc__name').first().hover()
  await expect.poll(() => linesOf(win)).toEqual(BOTH)
  await shoot(win, 'toc-05c-card-lines')

  // The names column, for the other parts of this step.
  await card(win).locator('.toc__pin').click()
  await expect(toc(win)).toHaveAttribute('data-names', '')

  // A click makes "Install" the current row: Guide › Setup › Install. The mouse is on the list, so
  // the lines show: the first line stops at "Setup" with its level piece, the second goes to "Install".
  await name('Install').click()
  await expectLanded(win, 'h', 'Install')
  await expect(name('Install')).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => pathsOf(win)).toEqual([null, '1t', '2t', null, null, null])
  await expect.poll(() => linesOf(win)).toEqual(BOTH)
  // The wash of the row below the mouse is behind the lines: the row still draws its five line pieces.
  expect(await name('Install').evaluate((el) => getComputedStyle(el).backgroundImage.split('linear-gradient').length - 1)).toBe(5)
  await shoot(win, 'toc-05c-lines-on-hover')

  // "Reference" is the third level 2 name below "Guide": the line of "Guide" passes the rows above it.
  await name('Reference').click()
  await expectLanded(win, 'h', 'Reference')
  await expect.poll(() => pathsOf(win)).toEqual([null, '1', '1', '1', '1t', null])

  // The mouse leaves the list: no lines. The tones are always there.
  await mouseOnNote(win)
  await expect.poll(() => linesOf(win)).toEqual(NONE)
  await expect.poll(() => tonesOf(win)).toEqual(TONES)
  await shoot(win, 'toc-05c-tones-at-rest')

  // The keyboard in the list shows the lines too (⌘J), and Esc takes them away with the keyboard.
  await win.keyboard.press('Meta+j')
  await expect(name('Reference')).toBeFocused()
  await expect.poll(() => linesOf(win)).toEqual(BOTH)
  await win.keyboard.press('Escape')
  await expect(editorOf(win)).toBeFocused()
  await expect.poll(() => linesOf(win)).toEqual(NONE)

  // A turn of the wheel over the note: the path shows, the grey lines do not, and the current row is still "Reference".
  await win.mouse.wheel(0, 60)
  await expect(reading(win)).toHaveCount(1)
  await expect.poll(() => linesOf(win)).toEqual({ grey: 'clear', path: 'shown' })
  await expect.poll(() => pathsOf(win)).toEqual([null, '1', '1', '1', '1t', null])
  // To the end of the note: the path follows the reader down the list, to "Appendix".
  await win.mouse.wheel(0, 100_000)
  await expect(name('Appendix')).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => pathsOf(win)).toEqual([null, '1', '1', '1', '1', '1t'])
  await expect.poll(() => linesOf(win)).toEqual({ grey: 'clear', path: 'shown' })
  await shoot(win, 'toc-05c-path-after-scroll')
  // 1500 ms after the last turn the path goes.
  await expect(reading(win)).toHaveCount(0, { timeout: 5_000 })
  await expect.poll(() => linesOf(win)).toEqual(NONE)

  /** Settings › Editor › Table of contents › "Level lines": select one choice, and close the dialog. */
  const chooseLevelLines = async (label: 'On hover' | 'Always show' | 'Never', value: 'hover' | 'always' | 'off'): Promise<void> => {
    const dialog = win.locator('.settings-dialog[role="dialog"]')
    const row = dialog.locator('[data-setting="tocLines"]')
    await clickMenuItem(app, 'menu.app.settings', 'w1')
    await expect(dialog).toBeVisible()
    await dialog.locator('.settings-nav__item', { hasText: /^Editor$/ }).click()
    await expect(row.locator('.setting__label')).toHaveText('Level lines')
    await expect(row.getByRole('button')).toHaveText(['On hover', 'Always show', 'Never'])
    await row.getByRole('button', { name: label, exact: true }).click()
    await expect(row.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(row.locator('button[aria-pressed="true"]')).toHaveCount(1)
    // The app saves the choice, and the open note follows at once: the attribute changes, the list is the same list.
    await expect.poll(async () => (await readState(userData)).settings.tocLines).toBe(value)
    await expect(win.locator('.app')).toHaveAttribute('data-toc-lines', value)
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(names(win)).toHaveText(HEADING_ROWS)
    await mouseOnNote(win)
  }

  // "Always show": the grey lines and the path at rest, with the mouse on the note.
  await chooseLevelLines('Always show', 'always')
  await expect.poll(() => linesOf(win)).toEqual(BOTH)
  await shoot(win, 'toc-05c-always-show')

  // "Never": no lines with the mouse on the list, and none on a turn of the wheel. The tones stay.
  await chooseLevelLines('Never', 'off')
  await expect.poll(() => linesOf(win)).toEqual(NONE)
  await win.mouse.wheel(0, -60)
  await expect(reading(win)).toHaveCount(1)
  await name('Guide').hover()
  await win.waitForTimeout(PAST_FADE_MS)
  expect(await linesOf(win)).toEqual(NONE)
  await mouseOnNote(win)
  await expect.poll(() => tonesOf(win)).toEqual(TONES)
  await shoot(win, 'toc-05c-never')

  // Back to "On hover", the default: at rest there are no lines again, and the mouse on the list shows them.
  await chooseLevelLines('On hover', 'hover')
  await expect(reading(win)).toHaveCount(0, { timeout: 5_000 })
  await expect.poll(() => linesOf(win)).toEqual(NONE)
  await name('Guide').hover()
  await expect.poll(() => linesOf(win)).toEqual(BOTH)

  // Back to the lines, for the steps below. The other two settings of the table of contents did not change.
  await toc(win).locator('.toc__pin--off').click()
  await expect(rail(win)).toBeVisible()
  await expect
    .poll(async () => {
      const { settings } = await readState(userData)
      return [settings.tocLines, settings.tableOfContents, settings.tableOfContentsWidth]
    })
    .toEqual(['hover', 'auto', TOC_MIN_W])
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
  // And so is the width of the names that step 5b left (YAZ-2752).
  expect((await readState(userData)).settings.tableOfContentsWidth).toBe(TOC_MIN_W)
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
