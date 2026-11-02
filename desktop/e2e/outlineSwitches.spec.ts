/**
 * Guide lines and Folding, the page cog's switches, in the REAL app (YAZ-4094, decisions D2, F1, G4 on its
 * working log YAZ-4095):
 *  - THE SWITCHES are "Guide lines" and "Folding" in the page cog, after "Section indent". Both start on.
 *  - OFF: no chevron on a bullet or a heading, no "Collapse all" button, and no guide line (the nested
 *    list's `::before` strip has no content).
 *  - THEY ARE SAVED IN the note: `guide-lines: false` and `folding: false` in its frontmatter
 *    (`shared/pageSwitches.ts`), every other byte kept, and they are still off after a restart.
 *
 * Same harness as every spec here: temp `--user-data-dir`, a COPY of the fixture vault with one note of
 * this spec's own in it, `outline-switches-` step screenshots. Serial: each step continues the last.
 */
// Written for YAZ-4119 (the audit of YAZ-4094). Not yet run: e2e runs only with the user's OK, so every
// selector here was read from the source, not observed. Run it once and fix what it finds.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { notePageSwitches, setNotePageSwitch } from '../../shared/pageSwitches'
import { appWindow, buildFixtureVault, copyVault, editorOf, launchApp, layer, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Outline.md'
const CHILD = 'child-bullet-e2e'
/** A heading with text under it (a heading chevron) and a bullet with a child (a bullet chevron and one guide line). */
const BODY = `# Plan

* parent-bullet-e2e
  * ${CHILD}
* leaf-bullet-e2e
`
/** The note after both clicks: the two keys in a new frontmatter block, and the text as it was. */
const BOTH_OFF = setNotePageSwitch(setNotePageSwitch(BODY, 'guide-lines', false), 'folding', false)

let userData: string
let vaultSrc: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const cog = (w: Page) => layer(w).locator('.page-settings__trigger')
const menu = (w: Page) => layer(w).locator('.page-settings__menu')
const pageSwitch = (w: Page, label: 'Guide lines' | 'Folding') => menu(w).locator('button[aria-pressed]', { hasText: label })
const chevrons = (w: Page) => editorOf(w).locator('.outline-toggle, .heading-toggle')
const foldAll = (w: Page) => layer(w).locator('.fold-all__trigger')
const child = (w: Page) => editorOf(w).getByText(CHILD)

/** The `content` of the guide-line strip of the nested list: `none` when the line is off (guideLines.css). */
const guideLine = (w: Page): Promise<string> =>
  editorOf(w)
    .locator('li.list-item > .children > .content-dom > ul')
    .first()
    .evaluate((ul) => getComputedStyle(ul, '::before').content)

/** Both switches of the cog, as `[guide lines, folding]` aria-pressed values; the menu is closed again. */
async function cogSwitches(w: Page): Promise<(string | null)[]> {
  await cog(w).click()
  await expect(menu(w)).toBeVisible()
  const pressed = [await pageSwitch(w, 'Guide lines').getAttribute('aria-pressed'), await pageSwitch(w, 'Folding').getAttribute('aria-pressed')]
  await w.keyboard.press('Escape')
  await expect(menu(w)).toHaveCount(0)
  return pressed
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'outlineswitches-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a note with no choice follows the defaults: chevrons, the "Collapse all" button and a guide line', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(child(win)).toBeVisible()

  expect(await cogSwitches(win)).toEqual(['true', 'true'])
  await expect(chevrons(win)).not.toHaveCount(0)
  await expect(foldAll(win)).toHaveCount(1)
  expect(await guideLine(win)).not.toBe('none')
  await shoot(win, 'outline-switches-01-defaults')
})

test('step 2 — "Guide lines" and "Folding" off in the page cog: no guide line, no chevron and no "Collapse all"; both are written IN the note', async () => {
  await cog(win).click()
  await expect(menu(win)).toBeVisible()
  await pageSwitch(win, 'Guide lines').click()
  await expect(pageSwitch(win, 'Guide lines')).toHaveAttribute('aria-pressed', 'false')
  await pageSwitch(win, 'Folding').click()
  await expect(pageSwitch(win, 'Folding')).toHaveAttribute('aria-pressed', 'false')
  await win.keyboard.press('Escape')
  await expect(menu(win)).toHaveCount(0)

  await expect(chevrons(win)).toHaveCount(0)
  await expect(foldAll(win)).toHaveCount(0)
  await expect.poll(() => guideLine(win)).toBe('none')
  // Nothing is hidden: the child bullet still shows.
  await expect(child(win)).toBeVisible()
  await expect.poll(async () => notePageSwitches(await readFile(notePath, 'utf8')), { timeout: 10_000 }).toEqual({ 'guide-lines': false, folding: false })
  await shoot(win, 'outline-switches-02-off')
})

test('step 3 — after a restart both are still off, read from the note: its frontmatter, no chevron, no guide line', async () => {
  await quitApp(app) // the autosave flush point: a pending write would land here
  // The two keys and nothing else: the text of the note is as it was written.
  expect(await readFile(notePath, 'utf8')).toBe(BOTH_OFF)

  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(child(win)).toBeVisible()
  await expect(chevrons(win)).toHaveCount(0)
  await expect(foldAll(win)).toHaveCount(0)
  expect(await guideLine(win)).toBe('none')
  expect(await cogSwitches(win)).toEqual(['false', 'false'])
  await shoot(win, 'outline-switches-03-after-restart')
})
