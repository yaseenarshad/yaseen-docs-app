/**
 * HIDDEN TAB LAYERS KEEP EVERYTHING (YAZ-2195, 🔒 D5). Every visited tab stays mounted (rule 6);
 * a hidden layer is `visibility: hidden` plus `content-visibility: hidden`, so it skips style,
 * layout and paint while hidden. This proves, against the REAL app, that skipping them loses
 * nothing a tab owns across a round trip: its scroll offset, caret, undo history, unsaved buffer,
 * open find session and document zoom.
 *
 * Tab A carries the caret, the typing (unsaved — checked straight after the switch back), undo and
 * zoom; tab B carries an open find session, because closing find moves the caret by design (the
 * landing rule in findInPage.spec.ts). Both carry a scroll offset. Same harness as tabs.spec.ts:
 * temp `--user-data-dir`, a COPY of the fixture vault, nothing sleeps.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const LINES = 300
const note = (prefix: string) => `# Long ${prefix}\n\n${Array.from({ length: LINES }, (_, i) => `${prefix}-line-${i}`).join('\n\n')}\n`

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const tab = (w: Page, name: string) => w.locator('.tabbar [role="tab"]', { hasText: name })
const activeLayer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const hiddenLayers = (w: Page) => w.locator('.tabstack__layer--hidden')
const editorOf = (layer: Locator) => layer.locator('.ProseMirror')
const scrollerOf = (layer: Locator) => layer.locator('.editor-host')
const zoomOf = (layer: Locator) => layer.locator('.document-zoom__value')
/** The paragraph starting with `text` and no further digit (`b-line-3`, never `b-line-30`). */
const line = (layer: Locator, text: string) => editorOf(layer).locator('p', { hasText: new RegExp(`^${text}(?!\\d)`) })
const scrollTop = (layer: Locator) => scrollerOf(layer).evaluate((el) => el.scrollTop)
const scrollTo = (layer: Locator, top: number) => scrollerOf(layer).evaluate((el, y) => void (el.scrollTop = y), top)

const recorded: { aTop?: number; aZoom?: string; bTop?: number; bCount?: string } = {}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'tab-layers-userdata-'))
  vault = await copyVault(await buildFixtureVault())
  await writeFile(path.join(vault, 'Long A.md'), note('a'))
  await writeFile(path.join(vault, 'Long B.md'), note('b'))
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — tab A: scroll, caret, unsaved typing and zoom', async () => {
  const state = seededState(vault, path.join(vault, 'Long A.md'))
  state.windows[0].tabs = [path.join(vault, 'Long A.md'), path.join(vault, 'Long B.md')]
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  const a = activeLayer(win)
  await expect(editorOf(a)).toContainText('a-line-0')

  await a.locator('.document-zoom__step[aria-label="Zoom in"]').click()
  await expect(zoomOf(a)).not.toHaveText('100%')
  recorded.aZoom = (await zoomOf(a).textContent()) ?? undefined

  await line(a, 'a-line-60').scrollIntoViewIfNeeded()
  await line(a, 'a-line-60').click()
  await win.keyboard.press('End')
  await win.keyboard.type(' unsaved-A', { delay: 10 })
  await expect(line(a, 'a-line-60')).toHaveText('a-line-60 unsaved-A')
  await scrollTo(a, 1500)
  recorded.aTop = await scrollTop(a)
  expect(recorded.aTop).toBeGreaterThan(1000)
})

test('step 2 — tab B: the hidden layer skips rendering; B gets its own scroll and an open find session', async () => {
  await tab(win, 'Long B').click()
  const b = activeLayer(win)
  await expect(editorOf(b)).toContainText('b-line-0')
  const hidden = await hiddenLayers(win).first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { visibility: s.visibility, contentVisibility: s.getPropertyValue('content-visibility') }
  })
  expect(hidden).toEqual({ visibility: 'hidden', contentVisibility: 'hidden' })

  await line(b, 'b-line-3').click()
  // Let the click's selectionchange reach ProseMirror before ⌘F reads the caret (helpers' `settledCaret` barrier).
  await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))))
  await win.keyboard.press('Meta+f')
  const bar = b.locator('.find-bar')
  await expect(bar).toBeVisible()
  await bar.locator('.find-bar__input').fill('b-line-2')
  // A new query lands on the first match AT OR AFTER the caret (findInPage.ts `nextActive`): with the
  // caret in b-line-3 that is b-line-20, the second match — b-line-2 itself sits above the caret.
  await expect(bar.locator('.find-bar__count')).toHaveText(/^2 of \d+$/)
  recorded.bCount = (await bar.locator('.find-bar__count').textContent()) ?? undefined
  await scrollTo(b, 800)
  recorded.bTop = await scrollTop(b)
  await expect(zoomOf(b)).toHaveText('100%')
  await shoot(win, 'tab-layers-02-b-find')
})

test('step 3 — back to A: scroll, zoom and the unsaved buffer are as left; the caret and undo history resume', async () => {
  await tab(win, 'Long A').click()
  const a = activeLayer(win)
  await expect(line(a, 'a-line-60')).toHaveText('a-line-60 unsaved-A')
  await expect(zoomOf(a)).toHaveText(recorded.aZoom!)
  expect(Math.abs((await scrollTop(a)) - recorded.aTop!)).toBeLessThanOrEqual(1)

  // The caret: focusing the editor (no click, which would move it) restores ProseMirror's own
  // selection, so a typed key lands right after the unsaved text.
  await editorOf(a).focus()
  // ProseMirror puts its selection back into the DOM a moment after focus.
  await expect.poll(() => win.evaluate(() => document.getSelection()?.anchorNode?.textContent ?? '')).toContain('unsaved-A')
  await win.keyboard.type('Q')
  await expect(line(a, 'a-line-60')).toHaveText('a-line-60 unsaved-AQ')
  // Undo history survived the round trip: the Q, then the typing from step 1.
  await win.keyboard.press('Meta+z')
  await expect(line(a, 'a-line-60')).toHaveText('a-line-60 unsaved-A')
  await win.keyboard.press('Meta+z')
  await expect(line(a, 'a-line-60')).toHaveText('a-line-60')
  await shoot(win, 'tab-layers-03-a-restored')
})

test('step 4 — back to B: its find session and scroll are as left', async () => {
  await tab(win, 'Long B').click()
  const b = activeLayer(win)
  const bar = b.locator('.find-bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator('.find-bar__input')).toHaveValue('b-line-2')
  await expect(bar.locator('.find-bar__count')).toHaveText(recorded.bCount!)
  expect(Math.abs((await scrollTop(b)) - recorded.bTop!)).toBeLessThanOrEqual(1)
  await expect(zoomOf(b)).toHaveText('100%')
})
