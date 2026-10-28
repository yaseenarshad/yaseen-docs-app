/**
 * The yaseendraw engine swap (YAZ-868/930) end-to-end against the REAL app: the vendored fork
 * build behind the SAME sidecar contract as stock — plus the features the swap exists for.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 a sidecar carrying the fork's formatting metadata (`lineBolds` / `lineUnderlines`) renders
 *     in the page preview as REAL styled output — `font-weight="bold"` and
 *     `text-decoration="underline"` in the exported SVG — with the offline rule still holding:
 *     not a single request leaves the app
 *   2 the feature round-trips THROUGH the UI: a plain text element, selected in the modal and hit
 *     with the fork's Cmd+B, is autosaved to its sidecar with `"fontWeight": "bold"` on disk,
 *     and the in-page preview redraws bold — proof the swap changed the engine, not the plumbing
 *   3 a STOCK-authored scene (no formatting fields at all) still opens clean in the modal —
 *     the label says Saved, nothing on disk moves: old drawings are untouched by the new engine
 *   4 Enter keeps the line format (YAZ-3177): a new line typed after the styled line is saved bold
 *     and underlined too — `lineBolds` / `lineUnderlines` grow to `[true, true]`
 *   5 in the text editor of a per-line bold element, a double click selects one word, a triple
 *     click selects the line, and a drag after a double click keeps its range (YAZ-3175:
 *     Chromium's pointerdown carries no click count)
 *   6 opening a text element's editor and leaving it with no edit leaves the modal clean: nothing
 *     is written and ✕ closes without asking (YAZ-3210: the engine bumps the element's version
 *     anyway); a real edit is autosaved, and ✕ still closes without asking (YAZ-3528)
 *
 * Same harness as drawing.spec.ts (temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `yaseendraw-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, editorOf, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Engine.md'
/** Already in remark's normalised form — the note must stay byte-identical through everything. */
const noteBody = () => `# Engine\n\nengine-note-body\n\n![[${STYLED}]]\n\n![[${PLAIN}]]\n`
const DRAWINGS_DIR = path.join('assets', 'drawings')
const STYLED = 'styled.excalidraw'
const PLAIN = 'plain.excalidraw'

/** Every field `restore()` needs — the same base drawing.spec.ts uses. */
const ELEMENT_BASE = {
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  groupIds: [],
  frameId: null,
  roundness: null,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
}

const TEXT_BASE = {
  ...ELEMENT_BASE,
  type: 'text',
  x: 20,
  y: 40,
  width: 200,
  height: 30,
  fontSize: 20,
  fontFamily: 1,
  textAlign: 'left',
  verticalAlign: 'top',
  containerId: null,
  lineHeight: 1.25,
}

const scene = (elements: unknown[]) =>
  `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} }, null, 2)}\n`

/** The fork's per-line metadata, exactly as its editor persists it (YAZ-868 scope findings). */
const styledScene = () =>
  scene([{ ...TEXT_BASE, id: 'styled', text: 'styled-label', originalText: 'styled-label', lineBolds: [true], lineUnderlines: [true] }])

/** A stock 0.18.x scene: NO formatting fields anywhere — what every pre-swap drawing looks like. */
const plainScene = () => scene([{ ...TEXT_BASE, id: 'plain', text: 'plain-label', originalText: 'plain-label' }])

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const rendered = (w: Page) => editorOf(w).locator('.drawing-preview--ready svg')
const previewOf = (w: Page, target: string) => editorOf(w).locator(`.drawing-preview[data-drawing-target="${target}"]`)
const modal = (w: Page) => w.locator('.drawing-modal')
const modalCanvas = (w: Page) => modal(w).locator('.drawing-modal__canvas')
/** The save label where the Save button was (YAZ-3528 D2). */
const saveLabel = (w: Page) => modal(w).locator('.drawing-modal__bar .save-indicator')
const closeModal = (w: Page) => modal(w).getByRole('button', { name: 'Close drawing' }).click()

const readNote = () => readFile(path.join(vault, NOTE), 'utf8')
const readSidecar = (name: string) => readFile(path.join(vault, DRAWINGS_DIR, name), 'utf8')

/** Watch every window request; anything that leaves for the network breaks the 🔒 offline rule. */
function watchExternal(w: Page): string[] {
  const external: string[] = []
  w.on('request', (req) => {
    if (/^https?:/i.test(req.url())) external.push(req.url())
  })
  return external
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaseendraw-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.join(vault, DRAWINGS_DIR), { recursive: true })
  await writeFile(path.join(vault, DRAWINGS_DIR, STYLED), styledScene())
  await writeFile(path.join(vault, DRAWINGS_DIR, PLAIN), plainScene())
  await writeFile(path.join(vault, NOTE), noteBody())
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — fork formatting metadata renders as real bold + underline SVG, offline', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, NOTE)) })
  win = await appWindow(app, 'w1')
  const external = watchExternal(win)
  await expect(editorOf(win)).toContainText('engine-note-body')

  await expect(rendered(win)).toHaveCount(2)
  // The styled line came out styled: these attributes are what the fork's SVG exporter emits for
  // `lineBolds` / `lineUnderlines` — stock 0.18.x cannot produce either.
  const styledSvg = await previewOf(win, STYLED).locator('svg').innerHTML()
  expect(styledSvg).toContain('font-weight="bold"')
  expect(styledSvg).toContain('text-decoration="underline"')
  // And the plain neighbour stayed plain — styling is per element, not a rendering side effect.
  const plainSvg = await previewOf(win, PLAIN).locator('svg').innerHTML()
  expect(plainSvg).not.toContain('font-weight="bold"')
  expect(plainSvg).not.toContain('text-decoration')
  await shoot(win, 'yaseendraw-01-styled-preview')

  expect(external).toEqual([])
  expect(await readNote()).toBe(noteBody())
})

test('step 2 — Cmd+B in the modal round-trips: `"fontWeight": "bold"` lands in the sidecar and the preview goes bold', async () => {
  const beforeNote = await readNote()

  await previewOf(win, PLAIN).click()
  await expect(modal(win)).toBeVisible()
  await expect(modalCanvas(win).locator('canvas').first()).toBeVisible()
  await expect(saveLabel(win)).toHaveText('Saved')

  // Select the one element, then the fork's own shortcut. The canvas needs the pointer's focus
  // first — a click on empty canvas, then select-all, is the gesture a user actually makes.
  const box = await modalCanvas(win).boundingBox()
  if (box === null) throw new Error('the modal canvas has no box')
  await win.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)
  await win.keyboard.press('ControlOrMeta+a')
  await win.keyboard.press('ControlOrMeta+b')

  // The toggle is the change the modal tracks: the autosave writes the fork's field while it is open.
  await expect.poll(() => readSidecar(PLAIN)).toContain('"fontWeight": "bold"')
  await expect(saveLabel(win)).toHaveText('Saved')
  await shoot(win, 'yaseendraw-02-bold-toggled')
  await closeModal(win)
  await expect(modal(win)).toHaveCount(0)

  // The in-page preview re-read the sidecar and now draws bold — the whole point of the swap.
  await expect.poll(async () => previewOf(win, PLAIN).locator('svg').innerHTML()).toContain('font-weight="bold"')
  await shoot(win, 'yaseendraw-03-preview-bold')

  // The note itself never moved: formatting lives in the sidecar, exactly like every other edit.
  expect(await readNote()).toBe(beforeNote)
})

test('step 3 — a stock-authored scene opens clean: nothing to save, disk untouched', async () => {
  // STYLED stands in for "authored elsewhere" here; what matters is opening WITHOUT editing.
  const before = await readSidecar(STYLED)

  await previewOf(win, STYLED).click()
  await expect(modal(win)).toBeVisible()
  await expect(modalCanvas(win).locator('canvas').first()).toBeVisible()
  // Opened and untouched is CLEAN — the new engine does not rewrite old scenes on sight.
  await expect(saveLabel(win)).toHaveText('Saved')
  await shoot(win, 'yaseendraw-04-reopen-clean')
  await win.keyboard.press('Escape')
  await expect(modal(win)).toHaveCount(0)

  expect(await readSidecar(STYLED)).toBe(before)
})

test('step 4 — Enter keeps the line format: the new line is saved bold and underlined too', async () => {
  await previewOf(win, STYLED).click()
  await expect(modal(win)).toBeVisible()
  await expect(modalCanvas(win).locator('canvas').first()).toBeVisible()

  // Select the one text element, Enter starts editing it, End puts the caret after the styled line.
  const box = await modalCanvas(win).boundingBox()
  if (box === null) throw new Error('the modal canvas has no box')
  await win.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)
  await win.keyboard.press('ControlOrMeta+a')
  await win.keyboard.press('Enter')
  const editor = modal(win).locator('textarea.excalidraw-wysiwyg')
  await expect(editor).toBeFocused()
  await win.keyboard.press('End')
  await win.keyboard.press('Enter')
  await win.keyboard.type('next-line')
  // A click on empty canvas ends the edit, as a user does.
  await win.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)
  await shoot(win, 'yaseendraw-05-enter-keeps-format')

  await closeModal(win)
  await expect(modal(win)).toHaveCount(0)

  await expect.poll(async () => JSON.parse(await readSidecar(STYLED)).elements[0]).toMatchObject({
    originalText: 'styled-label\nnext-line',
    lineBolds: [true, true],
    lineUnderlines: [true, true],
  })
})

test('step 5 — a double click selects a word, a triple click the line, and a drag keeps its range', async () => {
  const before = await readSidecar(STYLED)
  await previewOf(win, STYLED).click()
  await expect(modal(win)).toBeVisible()
  const box = await modalCanvas(win).boundingBox()
  if (box === null) throw new Error('the modal canvas has no box')
  await win.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)
  await win.keyboard.press('ControlOrMeta+a')
  await win.keyboard.press('Enter')

  // Per-line bold (`lineBolds`) turns on the fork's own caret layer, the path that counts clicks itself.
  const editor = modal(win).locator('textarea.excalidraw-wysiwyg')
  await expect(editor).toBeVisible()
  const field = await editor.boundingBox()
  if (field === null) throw new Error('the text editor has no box')
  // Step 4 added a second line: aim at the middle of the first one.
  const at = { x: field.x + 8, y: field.y + field.height / 4 }
  const selection = () => editor.evaluate((t: HTMLTextAreaElement) => [t.selectionStart, t.selectionEnd])

  await win.mouse.dblclick(at.x, at.y)
  await expect.poll(selection).toEqual([0, 'styled'.length])
  await win.mouse.click(at.x, at.y, { clickCount: 3 })
  await expect.poll(selection).toEqual([0, 'styled-label'.length])
  await shoot(win, 'yaseendraw-06-word-selected')

  // A drag after a double click keeps the character range that the drag made (S7).
  await win.waitForTimeout(700)
  await win.mouse.move(at.x, at.y)
  await win.mouse.down({ clickCount: 1 })
  await win.mouse.up({ clickCount: 1 })
  await win.mouse.down({ clickCount: 2 })
  await win.mouse.move(field.x + field.width - 8, at.y, { steps: 8 })
  const dragged = await selection()
  expect(dragged[1]).toBeGreaterThan(dragged[0])
  await win.mouse.up({ clickCount: 2 })
  await expect.poll(selection).toEqual(dragged)

  // Leave the editor with Esc, the modal with ✕ (the canvas keeps a second Esc). A selection is not
  // an edit, so ✕ closes without asking (YAZ-3210) and nothing reaches the disk.
  await win.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await modal(win).getByRole('button', { name: 'Close drawing' }).click()
  await expect(modal(win).locator('.drawing-modal__confirm')).toHaveCount(0)
  await expect(modal(win)).toHaveCount(0)
  expect(await readSidecar(STYLED)).toBe(before)
})

test('step 6 — the text editor left with no edit is not an edit; a typed letter is', async () => {
  const before = await readSidecar(STYLED)
  const editor = modal(win).locator('textarea.excalidraw-wysiwyg')
  const confirm = modal(win).locator('.drawing-modal__confirm')
  const close = () => modal(win).getByRole('button', { name: 'Close drawing' }).click()
  /** Opens the modal, selects the one text element and opens its editor with Enter. */
  const openEditor = async () => {
    await previewOf(win, STYLED).click()
    await expect(modal(win)).toBeVisible()
    await expect(modalCanvas(win).locator('canvas').first()).toBeVisible()
    const box = await modalCanvas(win).boundingBox()
    if (box === null) throw new Error('the modal canvas has no box')
    await win.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8)
    await win.keyboard.press('ControlOrMeta+a')
    await win.keyboard.press('Enter')
    await expect(editor).toBeFocused()
  }

  // In and out with Esc, nothing typed: clean, so ✕ just closes and nothing is written.
  await openEditor()
  await win.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(saveLabel(win)).toHaveText('Saved')
  await close()
  await expect(confirm).toHaveCount(0)
  await expect(modal(win)).toHaveCount(0)
  expect(await readSidecar(STYLED)).toBe(before)

  // One letter typed is an edit: the autosave writes it, and ✕ still closes without asking.
  await openEditor()
  await win.keyboard.press('End')
  await win.keyboard.type('!')
  await win.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect.poll(async () => JSON.parse(await readSidecar(STYLED)).elements[0].originalText).toContain('!')
  await expect(saveLabel(win)).toHaveText('Saved')
  await shoot(win, 'yaseendraw-07-typed-is-saved')
  await close()
  await expect(confirm).toHaveCount(0)
  await expect(modal(win)).toHaveCount(0)
  await quitApp(app)
})
