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
 *  2. Right-click its handle: "Number children" (disabled), "Line darkness", "Line thickness"; the
 *     darkness box has the focus. Type 80 + Enter → `<!-- line: darkness 80% -->` on disk.
 *  3. The "6px" preset → `darkness 80%, thickness 6px`, and the line is 18px tall.
 *  4. Click the line, drag its end handle to about 40% → `… length 40% -->` (±2).
 *  5. ⌘Z → the length part leaves the comment.
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
const boxes = (w: Page) => menu(w).locator('.document-zoom__custom input')
const preset = (w: Page, text: string) => menu(w).locator('.document-zoom__presets button', { hasText: text })
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
  await expect(menu(win).locator('.document-zoom__custom label')).toHaveText(['Line darkness', 'Line thickness'])
  await expect(boxes(win).first()).toBeFocused()
  await expect(boxes(win).nth(0)).toHaveValue('50%')
  await expect(boxes(win).nth(1)).toHaveValue('3px')
  await shoot(win, 'lineStyle-02-menu')
  // The box's text is selected, so typing replaces it.
  await win.keyboard.type('80')
  await win.keyboard.press('Enter')
  await expect(menu(win)).toBeHidden()
  await expect.poll(readNote, { timeout: 10_000 }).toBe(`${NOTE_BODY}\n\n***\n\n<!-- line: darkness 80% -->\n\nafter the line\n`)
})

test('step 3 — the 6px preset makes the line 6px thick, on screen and on disk', async () => {
  await openLineMenu(win)
  await expect(boxes(win).nth(0)).toHaveValue('80%')
  await expect(boxes(win).nth(1)).toHaveValue('3px')
  await preset(win, '6px').click()
  await expect(menu(win)).toBeHidden()
  await expect.poll(readNote, { timeout: 10_000 }).toContain('***\n\n<!-- line: darkness 80%, thickness 6px -->\n')
  await expect.poll(async () => Math.round((await hrBox(win)).height)).toBe(18)
  await shoot(win, 'lineStyle-03-thick')
})

test('step 4 — click the line, drag its end handle to about 40%: the length lands on disk', async () => {
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
  const re = /\*\*\*\n\n<!-- line: darkness 80%, thickness 6px, length (\d+)% -->\n/
  await expect.poll(readNote, { timeout: 10_000 }).toMatch(re)
  const length = Number(re.exec(await readNote())![1])
  expect(length).toBeGreaterThanOrEqual(38)
  expect(length).toBeLessThanOrEqual(42)
  // The line on screen is that share of the row, and it is still selected.
  expect((await hrBox(win)).width / row!.width).toBeCloseTo(length / 100, 1)
  await expect(lineView(win)).toHaveClass(/\bis-selected\b/)
  await shoot(win, 'lineStyle-04-short')
})

test('step 5 — ⌘Z takes the length back out in one step', async () => {
  await win.keyboard.press('Meta+z')
  await expect.poll(readNote, { timeout: 10_000 }).toBe(`${NOTE_BODY}\n\n***\n\n<!-- line: darkness 80%, thickness 6px -->\n\nafter the line\n`)
  const [box, row] = await Promise.all([hrBox(win), lineView(win).boundingBox()])
  expect(box.width).toBeCloseTo(row!.width, 0)
})
