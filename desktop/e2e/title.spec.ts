/**
 * The page title (⚡ YAZ-888) end-to-end against the REAL app: every page shows its own title as
 * block ZERO of the note's scroller, and editing it IS a rename — through the same one door the
 * sidebar's Rename reaches, so the confirm sheet, the `title:` line, the built file name
 * (YAZ-2420 🔒 D16), the link rewrite and the tab remap all come with it.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 a file made outside the app shows its own name as its title, and committing an edit asks
 *     first with the honest count, then renames on disk, in the tab strip, in the sidebar and in
 *     the note that links to it
 *   2 LEAVING the field commits (YAZ-1553): click away with a changed name and the same sheet
 *     asks — no Enter needed — and the rename lands everywhere step 1 proved
 *   3 Escape is the only discard: no sheet, nothing on disk moves
 *   4 leaving with the UNCHANGED name is silent: the field closes, no sheet
 *
 * Same harness as rename.spec.ts (temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `title-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, buildFixtureVault, builtNote, confirmSheet, copyVault, editorOf, fileRow, idOf, launchApp, layer, quitApp, seededState, shoot, titleOf } from './helpers'

test.describe.configure({ mode: 'serial' })

/** Seeded on top of the fixture vault: Index links to Guide. */
const GUIDE_BODY = 'guide-note-body'
const RENAMED = 'Handbook'
const LEFT = 'Manual'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page
/** The id the first title edit gives Guide.md (🔒 D29); every later name is built on it. */
let guideId = ''

/** Block ZERO of the open note's scroller: the heading, and the input a click swaps in. */
const title = (w: Page) => layer(w).locator('.page-title__text')
const titleInput = (w: Page) => layer(w).locator('.page-title__input')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'title-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await Promise.all([
    writeFile(path.join(vault, 'Guide.md'), `# Guide\n\n${GUIDE_BODY}\n`),
    writeFile(path.join(vault, 'Index.md'), '# Index\n\nSee [[Guide]] here.\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** The rename pipeline is still in flight right after confirming; a missing file must keep polling. */
const readWhenReady = (p: string) => readFile(p, 'utf8').catch(() => '')

test('step 1 — editing the title renames the page: sheet with the honest count, then disk, tab, sidebar and the linking note all follow', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Guide.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(GUIDE_BODY)
  // A file made outside the app has no `title:` yet: its file name, minus the extension, is its title (🔒 D5).
  await expect(title(win)).toHaveText('Guide')
  await shoot(win, 'title-01-page-title')

  await title(win).click()
  await expect(titleInput(win)).toHaveValue('Guide')
  await titleInput(win).fill(RENAMED)
  await win.keyboard.press('Enter')

  // The name changed, so the one door asks first — with the count of notes the rewrite will touch.
  await expect(confirmSheet(win).locator('.confirm__text')).toHaveText(`Rename 'Guide' to '${RENAMED}'? Links in 1 note will be updated.`)
  await shoot(win, 'title-02-confirm-sheet')
  await confirmSheet(win).locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect(confirmSheet(win)).toHaveCount(0)

  // Disk: the title is written and the file takes the name built from it, body intact; nothing
  // remains at the old path.
  await expect.poll(() => builtNote(vault, 'handbook')).not.toBe('')
  const built = await builtNote(vault, 'handbook')
  const renamed = await readFile(path.join(vault, built), 'utf8')
  guideId = idOf(renamed)
  expect(built).toBe(`handbook-${guideId.toLowerCase()}.md`)
  expect(titleOf(renamed)).toBe(RENAMED)
  expect(renamed).toContain(GUIDE_BODY)
  await expect(readFile(path.join(vault, 'Guide.md'), 'utf8')).rejects.toThrow()
  // The note that linked to it was rewritten, and the passive summary says so.
  await expect.poll(() => readWhenReady(path.join(vault, 'Index.md'))).toBe(`# Index\n\nSee [[${RENAMED}]] here.\n`)
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 1 note')
  // Every surface shows the new name: the title itself, the tab strip and the sidebar row.
  await expect(title(win)).toHaveText(RENAMED)
  await expect(activeTab(win)).toHaveText(RENAMED)
  await expect(fileRow(win, RENAMED)).toBeVisible()
  await shoot(win, 'title-03-renamed')

  // And the rewritten link in the referencing note renders — and resolves — under the new name.
  await fileRow(win, 'Index').click()
  await expect(editorOf(win).locator('.wikilink', { hasText: RENAMED }).first()).toBeVisible()
})

test('step 2 — leaving the title commits (YAZ-1553): click away with a changed name and the sheet asks, then everything follows', async () => {
  await fileRow(win, RENAMED).click()
  await expect(title(win)).toHaveText(RENAMED)

  await title(win).click()
  await titleInput(win).fill(LEFT)
  // No Enter: clicking into the note is the leave, and the leave is the commit.
  await editorOf(win).click()
  // Only the NAMES are pinned: step 1 rewrote Index.md moments ago, and whether the count reads
  // 1 or 0 depends on how far the debounced reindex has caught up (rename.spec step 7's rule).
  await expect(confirmSheet(win).locator('.confirm__text')).toContainText(`Rename '${RENAMED}' to '${LEFT}'?`)
  await shoot(win, 'title-04-clickaway-sheet')
  await confirmSheet(win).locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect(confirmSheet(win)).toHaveCount(0)

  // The same id under the new title's name.
  const left = path.join(vault, `manual-${guideId.toLowerCase()}.md`)
  await expect.poll(() => readWhenReady(left)).toContain(GUIDE_BODY)
  expect(titleOf(await readFile(left, 'utf8'))).toBe(LEFT)
  await expect(readFile(path.join(vault, `handbook-${guideId.toLowerCase()}.md`), 'utf8')).rejects.toThrow()
  await expect.poll(() => readWhenReady(path.join(vault, 'Index.md'))).toBe(`# Index\n\nSee [[${LEFT}]] here.\n`)
  await expect(title(win)).toHaveText(LEFT)
  await expect(activeTab(win)).toHaveText(LEFT)
  await expect(fileRow(win, LEFT)).toBeVisible()
  await shoot(win, 'title-05-clickaway-renamed')
})

test('step 3 — Escape is the only discard: no sheet, nothing on disk moves', async () => {
  await title(win).click()
  await titleInput(win).fill('Discarded')
  await win.keyboard.press('Escape')
  await expect(titleInput(win)).toHaveCount(0)
  await expect(confirmSheet(win)).toHaveCount(0)
  await expect(title(win)).toHaveText(LEFT)
  expect(titleOf(await readFile(path.join(vault, `manual-${guideId.toLowerCase()}.md`), 'utf8'))).toBe(LEFT)
})

test('step 4 — leaving with the UNCHANGED name is silent: the field closes and no sheet asks', async () => {
  await title(win).click()
  await expect(titleInput(win)).toHaveValue(LEFT)
  await editorOf(win).click()
  await expect(titleInput(win)).toHaveCount(0)
  await expect(confirmSheet(win)).toHaveCount(0)
  await expect(title(win)).toHaveText(LEFT)
  await quitApp(app)
})
