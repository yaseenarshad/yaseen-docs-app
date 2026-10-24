/**
 * THE LINE'S STYLE (YAZ-3164; CONTRACTS rule 41) against the REAL app: the `---` line's darkness
 * and thickness from the 6-dot menu, its length from the round end handle, and the comment the
 * autosave puts on disk.
 *
 * WHAT IT PROVES, and why only a real app can: the block handle is Crepe's, aimed by a real hover;
 * the line's height is real CSS layout (Crepe's border-box `hr` + `line.css`); the drag is a share
 * of the wrapper's real on-screen width; and the bytes are what the real autosave writes.
 *
 *  1. A plain line draws 15px tall (6 + 3 + 6, the default 3px) and full width.
 *  2. Right-click its handle: "Number children" (disabled), then one closed row each for "Line
 *     darkness", "Line thickness" and "Line style", nothing focused. Click "50% ▾": the box has the
 *     focus. Type 80 + Enter → `<!-- line: darkness 80% -->` on disk.
 *  3. "3px ▾", then the "6px" preset → `darkness 80%, thickness 6px`, and the line is 18px tall.
 *  4. "Solid ▾", then "Dashed" → `… style dashed -->`, drawn as dashes (a background image); dark
 *     mode keeps the dashes in the text colour.
 *  5. Click the line, drag its end handle to about 40% → `… length 40% -->` (±2).
 *  6. ⌘Z → the length part leaves the comment.
 *  7. Line numbers: the styled line shows its range at its middle (YAZ-3204).
 *  8. A line as a bullet's first block meets the bullet dot at its middle (YAZ-3207).
 *
 * Same harness as imageRender.spec.ts: temp `--user-data-dir`, a COPY of the fixture vault, one
 * serial run, `lineStyle-` screenshots. Hidden window (the harness default).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, editorOf, launchApp, layer, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Lines.md'
const NOTE_BODY = 'line-note-body'
const NOTE_TEXT = `${NOTE_BODY}\n\n***\n\nafter the line\n`

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const readNote = () => readFile(path.join(vault, NOTE), 'utf8')
const lineView = (w: Page) => editorOf(w).locator('.line-view')
const lineHr = (w: Page) => lineView(w).locator('hr')
const menu = (w: Page) => w.locator('.ctx-menu--editor')
const pickers = (w: Page) => menu(w).locator('.block-menu-picker')
const valueButton = (w: Page, i: number) => pickers(w).nth(i).locator('.block-menu-picker__value')
const box = (w: Page) => menu(w).locator('.document-zoom__custom input:visible')
const preset = (w: Page, text: string) => menu(w).locator('.document-zoom__presets button:visible', { hasText: text })
/** The `hr`'s laid-out box: what the eye sees. */
const hrBox = async (w: Page) => {
  const box = await lineHr(w).boundingBox()
  if (box === null) throw new Error('the line has no box')
  return box
}

/**
 * Hover the line so Crepe's block handle attaches to it (its mousemove is throttled, so a sweep and
 * a retry — numberedBullets.spec.ts's lesson), then right-click the 6-dot glyph at the line's own
 * height: the menu's probe reads the block at the pointer's y.
 */
async function openLineMenu(w: Page): Promise<void> {
  test.setTimeout(60_000)
  const handle = layer(w).locator('.milkdown-block-handle')
  await expect(async () => {
    const box = await hrBox(w)
    const y = box.y + box.height / 2
    await w.mouse.move(box.x + 40, y - 30)
    await w.mouse.move(box.x + Math.min(200, box.width / 2), y, { steps: 12 })
    await expect(handle).toHaveAttribute('data-show', 'true', { timeout: 1000 })
    const h = await handle.boundingBox()
    expect(h!.y).toBeLessThanOrEqual(y)
    expect(h!.y + h!.height).toBeGreaterThanOrEqual(y)
  }).toPass({ timeout: 30_000 })
  const dots = handle.locator('.operation-item').last()
  const [box, dotsBox] = await Promise.all([hrBox(w), dots.boundingBox()])
  const y = Math.min(Math.max(box.y + box.height / 2 - dotsBox!.y, 1), dotsBox!.height - 1)
  await dots.click({ button: 'right', position: { x: dotsBox!.width / 2, y } })
  await expect(menu(w)).toBeVisible()
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'linestyle-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, NOTE), NOTE_TEXT)
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, NOTE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(NOTE_BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a plain line draws 15px tall and as wide as the row', async () => {
  await expect(lineView(win)).toHaveCount(1)
  const [box, row] = await Promise.all([hrBox(win), lineView(win).boundingBox()])
  expect(box.height).toBeCloseTo(15, 0)
  expect(box.width).toBeCloseTo(row!.width, 0)
  await shoot(win, 'lineStyle-01-plain')
})

test('step 2 — the 6-dot menu of a line: type 80 + Enter sets the darkness on disk', async () => {
  await openLineMenu(win)
  await expect(menu(win).locator('.ctx-menu__item')).toHaveText(['Number children'])
  await expect(menu(win).locator('.ctx-menu__item')).toBeDisabled()
  await expect(pickers(win).locator('.block-menu-picker__label')).toHaveText(['Line darkness', 'Line thickness', 'Line style'])
  await expect(pickers(win).locator('.block-menu-picker__value')).toHaveText(['Default (50%) ▾', 'Default (3px) ▾', 'Default (Solid) ▾'])
  await expect(menu(win).locator('.block-menu-picker__panel:visible')).toHaveCount(0)
  await expect(menu(win).locator(':focus')).toHaveCount(0)
  await shoot(win, 'lineStyle-02-menu')
  await valueButton(win, 0).click()
  await expect(box(win)).toBeFocused()
  await expect(box(win)).toHaveValue('50%')
  await shoot(win, 'lineStyle-02-darkness-open')
  // The box's text is selected, so typing replaces it.
  await win.keyboard.type('80')
  await win.keyboard.press('Enter')
  await expect(menu(win)).toBeHidden()
  await expect.poll(readNote, { timeout: 10_000 }).toBe(`${NOTE_BODY}\n\n***\n\n<!-- line: darkness 80% -->\n\nafter the line\n`)
})

test('step 3 — the 6px preset makes the line 6px thick, on screen and on disk', async () => {
  await openLineMenu(win)
  await expect(pickers(win).locator('.block-menu-picker__value')).toHaveText(['80% ▾', 'Default (3px) ▾', 'Default (Solid) ▾'])
  await valueButton(win, 1).click()
  await expect(box(win)).toHaveValue('3px')
  await preset(win, '6px').click()
  await expect(menu(win)).toBeHidden()
  await expect.poll(readNote, { timeout: 10_000 }).toContain('***\n\n<!-- line: darkness 80%, thickness 6px -->\n')
  await expect.poll(async () => Math.round((await hrBox(win)).height)).toBe(18)
  await shoot(win, 'lineStyle-03-thick')
})

test('step 4 — the style picker makes the line dashed, in the darkness colour, in light and dark', async () => {
  await openLineMenu(win)
  await valueButton(win, 2).click()
  await expect(preset(win, 'Default (Solid)')).toHaveAttribute('aria-pressed', 'true')
  await expect(menu(win).locator('.line-sample:visible')).toHaveCount(4)
  await shoot(win, 'lineStyle-04-style-open')
  await preset(win, 'Dashed').click()
  await expect(menu(win)).toBeHidden()
  await expect.poll(readNote, { timeout: 10_000 }).toContain('***\n\n<!-- line: darkness 80%, thickness 6px, style dashed -->\n')
  await expect(lineView(win)).toHaveAttribute('data-line-pattern', 'dashed')
  const look = () => lineHr(win).evaluate((el) => {
    const style = getComputedStyle(el)
    return { image: style.backgroundImage, size: style.backgroundSize, color: style.backgroundColor }
  })
  const light = await look()
  expect(light.image).toMatch(/^linear-gradient/)
  // The tile is 5 × the 6px thickness: a 18px dash and a 12px gap.
  expect(light.size).toMatch(/^30px/)
  expect(light.color).toBe('rgba(0, 0, 0, 0)')
  expect((await hrBox(win)).height).toBeCloseTo(18, 0)
  await shoot(win, 'lineStyle-04-dashed-light')
  await win.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(async () => (await look()).image).not.toBe(light.image)
  await shoot(win, 'lineStyle-04-dashed-dark')
  await win.emulateMedia({ colorScheme: 'light' })
  await expect.poll(async () => (await look()).image).toBe(light.image)
})

test('step 5 — click the line, drag its end handle to about 40%: the length lands on disk', async () => {
  const box = await hrBox(win)
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(lineView(win)).toHaveClass(/\bis-selected\b/)
  const end = lineView(win).locator('.line-view__end')
  await expect(end).toBeVisible()
  const [endBox, row] = await Promise.all([end.boundingBox(), lineView(win).boundingBox()])
  const x = endBox!.x + endBox!.width / 2
  const y = endBox!.y + endBox!.height / 2
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.move(row!.x + row!.width * 0.4, y, { steps: 12 })
  await win.mouse.up()
  const re = /\*\*\*\n\n<!-- line: darkness 80%, thickness 6px, style dashed, length (\d+)% -->\n/
  await expect.poll(readNote, { timeout: 10_000 }).toMatch(re)
  const length = Number(re.exec(await readNote())![1])
  expect(length).toBeGreaterThanOrEqual(38)
  expect(length).toBeLessThanOrEqual(42)
  // The line on screen is that share of the row, and it is still selected.
  expect((await hrBox(win)).width / row!.width).toBeCloseTo(length / 100, 1)
  await expect(lineView(win)).toHaveClass(/\bis-selected\b/)
  await shoot(win, 'lineStyle-05-short')
})

test('step 6 — ⌘Z takes the length back out in one step', async () => {
  await win.keyboard.press('Meta+z')
  await expect.poll(readNote, { timeout: 10_000 }).toBe(`${NOTE_BODY}\n\n***\n\n<!-- line: darkness 80%, thickness 6px, style dashed -->\n\nafter the line\n`)
  const [lineBox, row] = await Promise.all([hrBox(win), lineView(win).boundingBox()])
  expect(lineBox.width).toBeCloseTo(row!.width, 0)
})

test('step 7 — line numbers (S22, YAZ-3204): the thick styled line shows 3–5 at its middle, and the paragraph after it 7', async () => {
  await layer(win).locator('.page-settings__trigger').click()
  const lineSwitch = layer(win).locator('.page-settings__menu button[aria-pressed]', { hasText: 'Line numbers' })
  await lineSwitch.click()
  await expect(lineSwitch).toHaveAttribute('aria-pressed', 'true')
  await win.keyboard.press('Escape')
  // The comment (line 5) is no block of the page: it is the line's range, and the next block is line 7.
  await expect.poll(() => lineView(win).getAttribute('data-line'), { timeout: 15_000 }).toBe('3')
  await expect(lineView(win)).toHaveAttribute('data-line-end', '5')
  await expect(editorOf(win).locator('p[data-line]', { hasText: NOTE_BODY })).toHaveAttribute('data-line', '1')
  await expect(editorOf(win).locator('p[data-line]', { hasText: 'after the line' })).toHaveAttribute('data-line', '7')
  // The number's box is centred on the wrapper, and the wrapper is the 18px line itself: the middle of the line.
  const at = await lineView(win).evaluate((el) => {
    const after = getComputedStyle(el, '::after')
    return { content: after.content, top: after.top, transform: after.transform, wrapper: el.getBoundingClientRect().height, line: el.querySelector('hr')!.getBoundingClientRect().height }
  })
  expect(at.content).toBe('"3–5"')
  expect(at.wrapper).toBeCloseTo(at.line, 0)
  expect(at.line).toBeCloseTo(18, 0)
  expect(parseFloat(at.top)).toBeCloseTo(at.wrapper / 2, 0)
  expect(at.transform).not.toBe('none')
  await shoot(win, 'lineStyle-07-line-numbers')
})

test('step 8 — a line as a bullet\'s first block meets the bullet dot at its middle (YAZ-3207)', async () => {
  await writeFile(path.join(vault, NOTE), `${NOTE_BODY}\n\n* text before\n* ---\n  * child\n* text after\n`)
  const item = editorOf(win).locator('.milkdown-list-item-block > li:has(> .children > .content-dom > .line-view)')
  await expect(item).toHaveCount(1, { timeout: 15_000 })
  const mids = await item.evaluate((li) => {
    const mid = (el: Element) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }
    return { dot: mid(li.querySelector(':scope > .label-wrapper')!), line: mid(li.querySelector('.line-view > hr')!) }
  })
  expect(Math.abs(mids.dot - mids.line)).toBeLessThan(1)
  await shoot(win, 'lineStyle-08-line-in-a-bullet')
})

test('step 9 — the vault\'s default line in Settings (YAZ-3208): a plain line follows it at once, a line set to solid keeps its own style', async () => {
  // An outside change gives the note one plain line and one line set to solid (S27, S92, S100).
  await writeFile(path.join(vault, NOTE), `${NOTE_BODY}\n\n***\n\n***\n\n<!-- line: style solid -->\n`)
  await expect(lineView(win)).toHaveCount(2)
  await expect(lineView(win).nth(1)).toHaveAttribute('data-line-pattern', 'solid')
  const look = (i: number) => lineView(win).nth(i).locator('hr').evaluate((el) => ({ image: getComputedStyle(el).backgroundImage, height: el.getBoundingClientRect().height }))
  expect(await look(0)).toEqual({ image: 'none', height: 15 })

  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  const row = win.locator('.settings-dialog[role="dialog"] [data-setting="textFormatting"] .line-defaults[data-level="line"]')
  await expect(row.locator('.heading-styles__size')).toHaveText(['50%', '3 px'])
  // YAZ-3221: "Line" fits, and the preview of the default line shows beside it — at least 48px wide and
  // on top at its own centre, not under the darkness "−".
  const fit = await row.evaluate((el) => {
    // The row is below Heading 6: bring it into the dialog's view before asking what is on top.
    el.scrollIntoView({ block: 'center' })
    const name = el.querySelector<HTMLElement>('.heading-styles__name')!
    const preview = el.querySelector<HTMLElement>('.heading-styles__line-preview')!
    const step = el.querySelector<HTMLElement>('.heading-styles__step')!
    const label = el.querySelector<HTMLElement>('.line-defaults__label')!.getBoundingClientRect()
    const n = name.getBoundingClientRect()
    const p = preview.getBoundingClientRect()
    const s = step.getBoundingClientRect()
    const onTop = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2)
    const apart = p.right <= s.left || p.left >= s.right || p.bottom <= s.top || p.top >= s.bottom
    // The name stays inside its label box and ends before the preview starts.
    return { previewWidth: p.width, onTop: onTop === preview ? true : `${onTop?.tagName}.${onTop?.className}`, apart, nameFits: n.right <= label.right + 0.5 && n.right <= p.left }
  })
  expect(fit.previewWidth).toBeGreaterThanOrEqual(48)
  expect(fit).toMatchObject({ onTop: true, apart: true, nameFits: true })
  await row.getByRole('button', { name: 'Line thickness larger', exact: true }).click()
  await row.locator('[aria-label="Line style"]').getByRole('button', { name: 'Dashed', exact: true }).click()
  await expect(row.locator('.heading-styles__size')).toHaveText(['50%', '4 px'])
  await shoot(win, 'lineStyle-09-settings-line')

  // Only the changed fields are in the vault's file (D8); the note's bytes do not change (D9).
  await expect.poll(async () => JSON.parse(await readFile(path.join(vault, '.yaseendocs', 'text-formatting.json'), 'utf8'))).toEqual({ version: 1, line: { thickness: 4, pattern: 'dashed' } })
  // The plain line follows the default at once, under the open dialog (S91); the solid one keeps its own (S92, S100).
  await expect.poll(async () => (await look(0)).image).toMatch(/^linear-gradient/)
  expect((await look(0)).height).toBeCloseTo(16, 0)
  expect((await look(1)).image).toBe('none')
  expect((await look(1)).height).toBeCloseTo(16, 0)

  // Reset removes the key (S97), and the plain line is solid and 3px again.
  await row.getByRole('button', { name: 'Reset line', exact: true }).click()
  await expect.poll(async () => (await look(0)).image).toBe('none')
  await win.keyboard.press('Escape')
  expect(await readNote()).toBe(`${NOTE_BODY}\n\n***\n\n***\n\n<!-- line: style solid -->\n`)
})
