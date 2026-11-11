/**
 * The Excalidraw embed (YAZ-852) end-to-end against the REAL app: a drawing is a SIDECAR FILE
 * in the vault plus one plain-markdown embed line in the note — never a schema node, never a
 * blob inside the page.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 typing `/` offers **Drawing** on Crepe's own block menu; choosing it writes an empty scene
 *     named after the note in the note's folder (YAZ-4831 items 2, 3: `Drawings drawing.excalidraw`)
 *     and leaves `![[<name>.excalidraw]]` at the caret, every other byte of the note untouched —
 *     twice in a row, and the second drawing gets its OWN file (` 2`; create-only writes never
 *     overwrite, YAZ-876)
 *   2 the two embeds RENDER as board windows (YAZ-4820): decorations only, so the note on disk is
 *     the same bytes it was — the window's picture stands where the raw `![[…]]` text is, which is
 *     hidden, never duplicated beside it
 *   3 a sidecar CORRUPTED on disk (the scene replaced by junk) reopens as a window that says
 *     "Can't show drawing: <name>" (YAZ-4834 A4) — no crash, no rewrite: the note is still
 *     byte-identical and the healthy drawing beside it still renders
 *   4 "Edit in a popup" on a window's right-click menu opens the MODAL (YAZ-4820 D7): a rectangle
 *     drawn there with the real mouse is AUTOSAVED to the sidecar while the modal is open
 *     (YAZ-3528) — same shape, still pretty-printed — a second one drawn just before ✕ is on disk
 *     once the modal is gone, the window redraws from the watcher WITHOUT a remount, and reopening
 *     the saved drawing writes nothing: the label says Saved and Esc closes it outright. The note
 *     never moves.
 *   5 the saved rectangle SURVIVES the app (YAZ-880): quit, relaunch, and it is back on the page
 *     read cold from the sidecar alone — still without a single request leaving the app
 *   6 and it was never the note's drawing: a SECOND note embedding the same `![[…]]` line draws
 *     the very same scene from the one file, which is what the modular sidecar buys (🔒 locked)
 *
 * Same harness as title.spec.ts (temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `drawing-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isAtomicTmp } from '../../shared/fileKind'
import { activeTab, appWindow, buildFixtureVault, copyVault, editorOf, fileRow, launchApp, layer, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Drawings.md'
/** Already in remark's normalised form, so the ONLY diff a save can make is the inserted line. */
const NOTE_BODY = `# Drawings\n\ndrawing-note-body\n`
/** "/drawing" puts the board in the note's own folder (YAZ-4831 item 3): here, the vault root. */
const DRAWINGS_DIR = ''
/** Step 7's second home for the SAME drawing; its body needs a name only step 1 knows. */
const REUSE_NOTE = 'Reuse.md'
const reuseNoteBody = () => `# Reuse\n\nreuse-note-body\n\n![[${second}]]\n`
/** `<note title> drawing[ n].excalidraw` — the board is named after the note (YAZ-4831 item 2). */
const DRAWING_NAME = /^Drawings drawing( \d+)?\.excalidraw$/
/** What step 4 writes over a sidecar: still a `.excalidraw` file, no longer a scene. */
const JUNK = 'this file is not a scene any more\n'

/** Every field `restore()` needs, shared by both elements of `DRAWN_SCENE`. */
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

/** A real drawing: a box and a line of TEXT, which is what makes the font path matter (step 3). */
const DRAWN_SCENE = `${JSON.stringify(
  {
    type: 'excalidraw',
    version: 2,
    source: 'yaseen-docs',
    elements: [
      { ...ELEMENT_BASE, id: 'box', type: 'rectangle', x: 0, y: 0, width: 240, height: 140 },
      {
        ...ELEMENT_BASE,
        id: 'label',
        type: 'text',
        x: 20,
        y: 40,
        width: 200,
        height: 30,
        text: 'drawn-scene',
        originalText: 'drawn-scene',
        fontSize: 20,
        fontFamily: 1,
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        lineHeight: 1.25,
      },
    ],
    appState: {},
    files: {},
  },
  null,
  2,
)}\n`

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page
/** The two sidecars step 1 creates; steps 2 and 3 render and then corrupt them. */
let first: string
let second: string
/** Step 5's saved rectangle exactly as the window's picture drew it — steps 6 and 7 both draw it again. */
let savedSvg: string

/** Crepe's OWN slash menu (YAZ-877 rides it — there is no second popup to find). */
const slashMenu = (w: Page) => layer(w).locator('.milkdown-slash-menu')
const slashItem = (w: Page, label: string) => slashMenu(w).locator('li').filter({ hasText: label })
/** The board window (YAZ-4820): one per `.excalidraw` embed, in its ready (the picture) or can't-show state. */
const previews = (w: Page) => editorOf(w).locator('.board-embed .board-window')
const rendered = (w: Page) => editorOf(w).locator('.board-window--ready .board-window__img')
const brokenChips = (w: Page) => editorOf(w).locator('.board-window--broken .board-window__message')
/** One embed's own window, by the board name its pill shows (the file name with no extension). */
const previewOf = (w: Page, target: string) =>
  editorOf(w).locator('.board-window', { has: w.locator('.board-window__name', { hasText: new RegExp(`^${target.replace(/\.excalidraw$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
/** The SVG text a window's picture shows: its `<img>` reads a blob URL of it (YAZ-4825). */
const pictureOf = (w: Page, target: string) => previewOf(w, target).locator('.board-window__img').evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())
/** "Edit in a popup" (D7): the window's right-click menu. */
async function editInPopup(w: Page, target: string): Promise<void> {
  await previewOf(w, target).click({ button: 'right' })
  await w.locator('.ctx-menu__item', { hasText: 'Edit in a popup' }).click()
}

/** The YAZ-879 modal and its parts; the canvas inside it is the engine's, mounted by the seam. */
const modal = (w: Page) => w.locator('.drawing-modal')
const modalCanvas = (w: Page) => modal(w).locator('.drawing-modal__canvas')
/** The save label where the Save button was (YAZ-3528 D2). */
const saveLabel = (w: Page) => modal(w).locator('.drawing-modal__bar .save-indicator')

const readNote = () => readFile(path.join(vault, NOTE), 'utf8')
const readSidecar = (name: string) => readFile(path.join(vault, DRAWINGS_DIR, name), 'utf8')
const readScene = async (name: string) => JSON.parse(await readSidecar(name)) as { type: string; source: string; elements: Array<{ type: string }>; files: unknown }
/** The note's boards in the drawings home, an in-flight atomic write's `.tmp-<hex>` sibling included. */
const drawingsDir = async () => (await readdir(path.join(vault, DRAWINGS_DIR)).catch(() => [])).filter((name) => name.startsWith('Drawings drawing')).sort()
/** The drawings a user has: a new file is born `tmp → fsync → link` (YAZ-2177), and its tmp name is never a drawing (YAZ-2179). */
const listDrawings = async () => (await drawingsDir()).filter((name) => !isAtomicTmp(name))

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'drawing-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, NOTE), NOTE_BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * Caret to the end of the paragraph holding `afterText`, then a fresh empty paragraph under it
 * — the block a `/` menu may open on (Crepe's own rule: not in a list, selection at block end).
 */
async function newBlockAfter(w: Page, afterText: string): Promise<void> {
  await editorOf(w).locator('p').filter({ hasText: afterText }).last().click()
  await w.keyboard.press('End')
  await w.keyboard.press('Enter')
}

test('step 1 — "/" offers Drawing; each pick writes its own empty scene and leaves only the embed line behind', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, NOTE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('drawing-note-body')
  // Nothing exists yet.
  expect(await listDrawings()).toEqual([])

  // --- first drawing ---
  await newBlockAfter(win, 'drawing-note-body')
  await win.keyboard.type('/')
  await expect(slashMenu(win)).toBeVisible()
  await expect(slashItem(win, 'Drawing')).toBeVisible()
  await shoot(win, 'drawing-01-slash-menu')
  await slashItem(win, 'Drawing').click()

  await expect.poll(listDrawings).toHaveLength(1)
  ;[first] = await listDrawings()
  expect(first).toMatch(DRAWING_NAME)
  // On disk it is a valid EMPTY Excalidraw scene, not a placeholder.
  const scene = JSON.parse(await readFile(path.join(vault, DRAWINGS_DIR, first), 'utf8')) as Record<string, unknown>
  expect(scene).toEqual({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [], appState: {}, files: {} })
  // The note gained ONE line — the plain-markdown embed — and nothing else moved.
  await expect.poll(readNote).toBe(`${NOTE_BODY}\n![[${first}]]\n`)
  await expect(editorOf(win)).toContainText(`![[${first}]]`)
  await shoot(win, 'drawing-02-embed-inserted')

  // --- second drawing: create-only writes never overwrite (YAZ-876) ---
  // No re-click on the embed's paragraph: its text is under the window, and the
  // caret is already exactly where the insert left it (at the LIVE selection) — so Enter alone
  // opens the next block, which is the real gesture anyway.
  await win.keyboard.press('Enter')
  await win.keyboard.type('/')
  await expect(slashItem(win, 'Drawing')).toBeVisible()
  await slashItem(win, 'Drawing').click()

  await expect.poll(listDrawings).toHaveLength(2)
  const both = await listDrawings()
  for (const name of both) expect(name).toMatch(DRAWING_NAME)
  expect(new Set(both).size).toBe(2)
  second = both.find((n) => n !== first) as string
  // The first scene is still exactly where it was; the second is its own file.
  await expect.poll(readNote).toBe(`${NOTE_BODY}\n![[${first}]]\n\n![[${second}]]\n`)
  expect(await readFile(path.join(vault, DRAWINGS_DIR, first), 'utf8')).toBe(await readFile(path.join(vault, DRAWINGS_DIR, second), 'utf8'))
  // Every write finished: no tmp sibling outlives it.
  await expect.poll(drawingsDir).toEqual([first, second].sort())
  await shoot(win, 'drawing-03-second-drawing')

  await quitApp(app)
})

test('step 2 — both embeds render as windows: the picture stands where the raw text is, and the note is untouched', async () => {
  const before = await readNote()
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('drawing-note-body')

  await expect(previews(win)).toHaveCount(2)
  await expect(rendered(win)).toHaveCount(2)
  // The embed text is still IN the document — decorations only — but NOT on screen: a window
  // standing next to its own `![[…]]` is exactly the duplication this rule forbids.
  await expect(editorOf(win)).not.toContainText('![[', { useInnerText: true })
  await expect(editorOf(win)).toContainText(`![[${first}]]`)
  await expect(editorOf(win)).toContainText(`![[${second}]]`)
  await shoot(win, 'drawing-04-previews')

  expect(await readNote()).toBe(before)
  await quitApp(app)
})

test('step 3 — a scene with real elements draws, TEXT INCLUDED, without a single request leaving the app', async () => {
  const before = await readNote()
  // What YAZ-879's modal will one day save: replace the first empty scene with a real drawing.
  await writeFile(path.join(vault, DRAWINGS_DIR, first), DRAWN_SCENE)

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  // 🔒 The offline rule: nothing about a window may reach the network — the fonts a text
  // element needs are the app's own copy under `app://yaseen/excalidraw-assets/`.
  const external: string[] = []
  win.on('request', (req) => {
    if (/^https?:/i.test(req.url())) external.push(req.url())
  })
  await expect(editorOf(win)).toContainText('drawing-note-body')

  await expect(rendered(win)).toHaveCount(2)
  // The drawn scene has real extent — an empty one shows "Empty drawing", no picture.
  const box = await rendered(win).first().boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(80)
  expect(box?.height ?? 0).toBeGreaterThan(80)
  // Its font arrived: exportToSvg only inlines an `@font-face` once the woff2 actually loaded,
  // so a `data:` src IS the proof that the local asset path answered (item 25).
  const svg = await pictureOf(win, first)
  expect(svg).toContain('@font-face')
  expect(svg).toContain('src: url(data:')
  await shoot(win, 'drawing-05-drawn-scene')

  expect(external).toEqual([])
  expect(await readNote()).toBe(before)
  await quitApp(app)
})

test('step 4 — a corrupted sidecar says "Can\'t show drawing"; nothing crashes and nothing is rewritten', async () => {
  const before = await readNote()
  // The file is still there and still named a drawing — only its bytes are no longer a scene.
  await writeFile(path.join(vault, DRAWINGS_DIR, first), JUNK)

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('drawing-note-body')

  await expect(brokenChips(win)).toHaveCount(1)
  // A4: the file is there, so it is not "Missing"; it would not draw.
  await expect(brokenChips(win)).toHaveText(`Can't show drawing: ${first.replace(/\.excalidraw$/, '')}`)
  // Its healthy neighbour is unaffected.
  await expect(rendered(win)).toHaveCount(1)
  await shoot(win, 'drawing-06-broken-chip')

  // No repair, no rewrite: the note is the same bytes and the junk is still junk.
  expect(await readNote()).toBe(before)
  expect(await readFile(path.join(vault, DRAWINGS_DIR, first), 'utf8')).toBe(JUNK)
  await quitApp(app)
})

test('step 5 — "Edit in a popup" opens the modal; a rectangle DRAWN there is saved back and the window redraws', async () => {
  const before = await readNote()
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('drawing-note-body')
  // `first` is still the junk step 4 wrote, and `second` is an empty scene: its window says "Empty drawing".
  await expect(rendered(win)).toHaveCount(0)
  await expect(previewOf(win, second)).toHaveClass(/board-window--empty/)
  expect((await readScene(second)).elements).toEqual([])

  // --- open ---
  await editInPopup(win, second)
  await expect(modal(win)).toBeVisible()
  await expect(modalCanvas(win).locator('canvas').first()).toBeVisible()
  // Opened and untouched is CLEAN, and there is no Save button: the modal saves by itself.
  await expect(saveLabel(win)).toHaveText('Saved')
  await expect(modal(win).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await shoot(win, 'drawing-07-modal-open')

  // --- draw, with the real mouse on the engine's own toolbar and canvas ---
  // The engine's own toolbar: yaseendraw's tool is a real BUTTON carrying the testid itself
  // (stock hid a radio under a label), and it reports selection through `aria-pressed`.
  await modal(win).locator('[data-testid="toolbar-rectangle"]').click()
  await expect(modal(win).locator('[data-testid="toolbar-rectangle"]')).toHaveAttribute('aria-pressed', 'true')
  const box = await modalCanvas(win).boundingBox()
  if (box === null) throw new Error('the modal canvas has no box')
  // Right of centre and below the toolbar: the tool islands hug the top-left of the canvas.
  const x = box.x + box.width * 0.55
  const y = box.y + box.height * 0.4
  const drag = async (fromY: number): Promise<void> => {
    await win.mouse.move(x, fromY)
    await win.mouse.down()
    await win.mouse.move(x + 180, fromY + 90, { steps: 12 })
    await win.mouse.up()
  }
  await drag(y)

  // --- autosave: the rectangle reaches the sidecar while the modal is still open ---
  await expect.poll(async () => (await readScene(second)).elements.length).toBe(1)
  await expect(modal(win)).toBeVisible()
  await expect(saveLabel(win)).toHaveText('Saved')
  await shoot(win, 'drawing-08-rectangle-drawn')

  // --- close: a second rectangle drawn just before ✕ is on disk once the modal is gone (the close
  // saves it when the 500 ms timer has not; unit test S4 pins the close's own save) ---
  await modal(win).locator('[data-testid="toolbar-rectangle"]').click()
  await drag(y + 140)
  await modal(win).getByRole('button', { name: 'Close drawing' }).click()
  await expect(modal(win)).toHaveCount(0)

  // On disk: the sidecar GAINED both rectangles, and it is still the same kind of file — the shape
  // YAZ-877 created, pretty-printed with a trailing newline and its `files` map intact.
  expect((await readScene(second)).elements.map((e) => e.type)).toEqual(['rectangle', 'rectangle'])
  const saved = await readScene(second)
  expect(saved.type).toBe('excalidraw')
  expect(saved.source).toBe('yaseen-docs')
  expect(saved.files).toEqual({})
  const raw = await readSidecar(second)
  expect(raw.endsWith('\n')).toBe(true)
  expect(raw).toContain('\n  "elements": [')

  // The window heard the write from the watcher and drew it — no remount, no reload (D5).
  await expect(rendered(win)).toHaveCount(1)
  savedSvg = await pictureOf(win, second)
  expect(savedSvg).toContain('<svg')
  await shoot(win, 'drawing-09-preview-redrawn')

  // --- reopen: the saved drawing opens CLEAN, and Esc closes it outright without a write ---
  await editInPopup(win, second)
  await expect(modal(win)).toBeVisible()
  await expect(saveLabel(win)).toHaveText('Saved')
  await win.keyboard.press('Escape')
  await expect(modal(win)).toHaveCount(0)
  expect(await readSidecar(second)).toBe(raw)

  // The NOTE never moved: the modal edits a sidecar, never the page (decorations only, rule 27).
  expect(await readNote()).toBe(before)
  await quitApp(app)
})

test('step 6 — the saved drawing survives quit → relaunch: read cold from the sidecar, still offline', async () => {
  const beforeNote = await readNote()
  const beforeSidecar = await readSidecar(second)
  app = await launchApp({ userData }) // NO re-seed: restore is whatever step 5's quit wrote
  win = await appWindow(app, 'w1')
  // 🔒 The offline rule again, on the path a user actually lives on: reopening yesterday's note.
  const external: string[] = []
  win.on('request', (req) => {
    if (/^https?:/i.test(req.url())) external.push(req.url())
  })
  await expect(editorOf(win)).toContainText('drawing-note-body')

  // A new process, a new editor, a new read — and the rectangle is on screen again, because the
  // sidecar is the only place it ever lived: nothing about it is in the note or in the app state.
  await expect(rendered(win)).toHaveCount(1)
  await expect(brokenChips(win)).toHaveCount(1) // `first` is still step 4's junk, still inert
  const svg = await pictureOf(win, second)
  expect(svg.length).toBeGreaterThan(0)
  expect(svg).toBe(savedSvg) // the very drawing step 5 saved, down to the stroke
  const box = await rendered(win).first().boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(80)
  expect(box?.height ?? 0).toBeGreaterThan(80)
  await shoot(win, 'drawing-10-survives-relaunch')

  expect(external).toEqual([])
  // Reopening reads and never writes: both files are the bytes step 5 left behind.
  expect(await readNote()).toBe(beforeNote)
  expect(await readSidecar(second)).toBe(beforeSidecar)
})

test('step 7 — one drawing, two notes: a SECOND note embedding the same sidecar draws the same scene', async () => {
  const beforeNote = await readNote()
  const beforeSidecar = await readSidecar(second)
  // Written straight onto disk — the honest path for a line someone typed in another editor — and
  // it is the SAME embed text, because a sidecar is a file in the vault like any other: nothing
  // about it belongs to the note that happened to create it.
  await writeFile(path.join(vault, REUSE_NOTE), reuseNoteBody())

  await fileRow(win, 'Reuse').click()
  await expect(activeTab(win)).toHaveText('Reuse')
  await expect(editorOf(win)).toContainText('reuse-note-body')

  // Its own note, its own editor mount, its own read of the ONE file on disk — and the same
  // rectangle comes out. This is what the modular sidecar is FOR (🔒 the locked decision).
  await expect(previews(win)).toHaveCount(1)
  await expect(rendered(win)).toHaveCount(1)
  const svg = await pictureOf(win, second)
  expect(svg.length).toBeGreaterThan(0)
  expect(svg).toBe(savedSvg)
  await shoot(win, 'drawing-11-second-note')

  // Nothing was copied to make that happen: still two sidecars, and both notes are as written.
  expect(await listDrawings()).toEqual([first, second].sort())
  expect(await readFile(path.join(vault, REUSE_NOTE), 'utf8')).toBe(reuseNoteBody())
  expect(await readSidecar(second)).toBe(beforeSidecar)
  expect(await readNote()).toBe(beforeNote)
  await quitApp(app)
})
