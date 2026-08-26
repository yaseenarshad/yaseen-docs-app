/**
 * The Excalidraw embed (YAZ-852) end-to-end against the REAL app: a drawing is a SIDECAR FILE
 * in the vault plus one plain-markdown embed line in the note — never a schema node, never a
 * blob inside the page.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 typing `/` offers **Drawing** on Crepe's own block menu; choosing it writes an empty scene
 *     under `assets/drawings/` and leaves `![[<name>.excalidraw]]` at the caret, every other byte
 *     of the note untouched — twice in a row, and the second drawing gets its OWN file
 *     (create-only writes never overwrite, YAZ-876)
 *   … later units extend this same spec: the embed RENDERS as a preview (YAZ-878), and clicking
 *     it opens the editing modal that writes the scene back (YAZ-879). Add their steps below.
 *
 * Same harness as title.spec.ts (temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `drawing-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Drawings.md'
/** Already in remark's normalised form, so the ONLY diff a save can make is the inserted line. */
const NOTE_BODY = `# Drawings\n\ndrawing-note-body\n`
const DRAWINGS_DIR = path.join('assets', 'drawings')
/** `Drawing YYYY-MM-DD HH.mm.ss[ n].excalidraw` — the creator's clock name (client/src/drawings). */
const DRAWING_NAME = /^Drawing \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}( \d+)?\.excalidraw$/

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
/** Crepe's OWN slash menu (YAZ-877 rides it — there is no second popup to find). */
const slashMenu = (w: Page) => layer(w).locator('.milkdown-slash-menu')
const slashItem = (w: Page, label: string) => slashMenu(w).locator('li').filter({ hasText: label })

const readNote = () => readFile(path.join(vault, NOTE), 'utf8')
const listDrawings = async () => (await readdir(path.join(vault, DRAWINGS_DIR)).catch(() => [])).sort()

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
  // Nothing exists yet: the drawings home is made by the first write, never scaffolded.
  expect(await listDrawings()).toEqual([])

  // --- first drawing ---
  await newBlockAfter(win, 'drawing-note-body')
  await win.keyboard.type('/')
  await expect(slashMenu(win)).toBeVisible()
  await expect(slashItem(win, 'Drawing')).toBeVisible()
  await shoot(win, 'drawing-01-slash-menu')
  await slashItem(win, 'Drawing').click()

  await expect.poll(listDrawings).toHaveLength(1)
  const [first] = await listDrawings()
  expect(first).toMatch(DRAWING_NAME)
  // On disk it is a valid EMPTY Excalidraw scene, not a placeholder.
  const scene = JSON.parse(await readFile(path.join(vault, DRAWINGS_DIR, first), 'utf8')) as Record<string, unknown>
  expect(scene).toEqual({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [], appState: {}, files: {} })
  // The note gained ONE line — the plain-markdown embed — and nothing else moved.
  await expect.poll(readNote).toBe(`${NOTE_BODY}\n![[${first}]]\n`)
  await expect(editorOf(win)).toContainText(`![[${first}]]`)
  await shoot(win, 'drawing-02-embed-inserted')

  // --- second drawing: create-only writes never overwrite (YAZ-876) ---
  await newBlockAfter(win, first)
  await win.keyboard.type('/')
  await expect(slashItem(win, 'Drawing')).toBeVisible()
  await slashItem(win, 'Drawing').click()

  await expect.poll(listDrawings).toHaveLength(2)
  const both = await listDrawings()
  for (const name of both) expect(name).toMatch(DRAWING_NAME)
  expect(new Set(both).size).toBe(2)
  const second = both.find((n) => n !== first) as string
  // The first scene is still exactly where it was; the second is its own file.
  await expect.poll(readNote).toBe(`${NOTE_BODY}\n![[${first}]]\n\n![[${second}]]\n`)
  expect(await readFile(path.join(vault, DRAWINGS_DIR, first), 'utf8')).toBe(await readFile(path.join(vault, DRAWINGS_DIR, second), 'utf8'))
  await shoot(win, 'drawing-03-second-drawing')

  await quitApp(app)
})
