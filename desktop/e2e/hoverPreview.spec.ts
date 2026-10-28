/**
 * The hover preview on the new tab page (YAZ-3403 D1, D2, D7) against the REAL app: a window with no tabs shows the
 * page; a rest on a recent note opens the sidebar's note panel beside the row, with the top of the note. Then
 * Settings › Files & Links › Preview on hover › New tab page goes off: the state file says so, no panel opens on the
 * page, and the sidebar (its own switch) still previews (S36). Same harness as startPage.spec.ts (temp
 * `--user-data-dir`, a COPY of the generated fixture vault), hidden. The dwell, each close and the other places are
 * the unit suites' (`workspace/StartPage.test.tsx`, `sidebar/Sidebar.test.tsx`, `views/view/TableView.test.tsx`,
 * `editor/wikilink/wikilinkHover.test.ts`). YAZ-3508: a rest on a code file in Files and in Recents shows its card, coloured.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, fileRow, launchApp, readState, seededState, shoot, wholeRow } from './helpers'

/** The body of the fixture's `Ideas.md` (helpers.buildFixtureVault): the top of the note that the panel shows. */
const IDEAS_BODY = 'synthetic-idea-body'
const MINUTE = 60_000
/** YAZ-3508: a code file whose card shows coloured code. */
const CODE_FILE = 'hover-demo.ts'
const CODE_BODY = `// A comment\nexport function greet(name: string): string {\n  return 'hi ' + name + 42\n}\n${Array.from({ length: 100 }, (_, i) => `export const row${i} = ${i}`).join('\n')}\n`
const codePanel = (w: Page) => w.locator('.code-hover')
const recentsTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Recents"]')

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

test.describe.configure({ mode: 'serial' })

const recent = (w: Page) => w.locator('.start__column[data-col="recent"] .start__row')
const notePanel = (w: Page) => w.locator('.note-preview')
const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'hoverpreview-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, CODE_FILE), CODE_BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('YAZ-3403 S1, S15, S36: a rest on a recent note of the new tab page shows its top beside the row; with "New tab page" off in Settings no panel opens there, and the sidebar still previews', async () => {
  const roadmap = path.join(vault, 'Projects', 'Roadmap.md')
  const ideas = path.join(vault, 'Ideas.md')
  // A window with no tabs shows the new tab page; its "Recently viewed" column reads the seeded open history.
  const seededAt = Date.now()
  // The whole lens row, so Recents is a tab (YAZ-3508's step below); the code file's save is in its log.
  const state = wholeRow(seededState(vault, null))
  state.folders[vault].opens = { [roadmap]: { score: 1, last: seededAt - MINUTE }, [ideas]: { score: 1, last: seededAt - 2 * MINUTE } }
  state.folders[vault].edits = { [path.join(vault, CODE_FILE)]: seededAt - MINUTE }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(recent(win).locator('.start__name')).toHaveText(['Roadmap', 'Ideas'])

  // S1: the rest opens the sidebar's note panel, beside the row, with the note's name and the top of its text.
  const row = recent(win).nth(1)
  await row.hover()
  await expect(notePanel(win)).toBeVisible()
  await expect(notePanel(win).locator('.board-preview__name')).toHaveText('Ideas')
  await expect(notePanel(win).locator('.note-preview__body')).toContainText(IDEAS_BODY)
  const [rowBox, panelBox] = await Promise.all([row.boundingBox(), notePanel(win).boundingBox()])
  expect(panelBox!.x >= rowBox!.x + rowBox!.width || panelBox!.x + panelBox!.width <= rowBox!.x).toBe(true) // beside the row, not over it
  await shoot(win, 'hover-preview-01-new-tab-page')
  // S12: the pointer leaves the row, and the panel goes.
  await win.locator('.start__heading').first().hover()
  await expect(notePanel(win)).toHaveCount(0)

  // S15: Settings › Files & Links › Preview on hover › New tab page: Off. The state file keeps it.
  await clickMenuItem(app, 'menu.app.settings', 'w1')
  await expect(dialog(win)).toBeVisible()
  await dialog(win).getByRole('textbox', { name: 'Search settings', exact: true }).fill('new tab page')
  const place = dialog(win).locator('[data-setting="hoverPreviewIn.newTab"]')
  await place.getByRole('button', { name: 'Off', exact: true }).click()
  await expect(place.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await readState(userData)).settings.hoverPreviewIn).toMatchObject({ newTab: false, sidebar: true })
  await dialog(win).getByRole('button', { name: 'Close settings', exact: true }).click()
  await expect(dialog(win)).toHaveCount(0)

  // No panel on the page now: the rest is well past the 400 ms dwell.
  await recent(win).nth(1).hover()
  await win.waitForTimeout(1_000)
  await expect(notePanel(win)).toHaveCount(0)
  await shoot(win, 'hover-preview-02-new-tab-page-off')

  // S36: each other place keeps its own switch — a Files row of the sidebar still previews.
  await fileRow(win, 'Ideas').hover()
  await expect(notePanel(win)).toBeVisible()
  await expect(notePanel(win).locator('.note-preview__body')).toContainText(IDEAS_BODY)
})

/** The distinct colours of the coloured spans in the code card. */
const cardColours = (w: Page) => codePanel(w).locator('.code-hover__body').evaluate((body) => Array.from(new Set(Array.from(body.querySelectorAll('span[class*="mtk"]')).map((el) => getComputedStyle(el).color))))

test('YAZ-3508: a rest on a code file in Files and in Recents shows the top of the file, coloured, at most 60 lines', async () => {
  test.setTimeout(60_000)
  // A Files row first: the sidebar's own switch is still on.
  await fileRow(win, CODE_FILE).hover()
  await expect(codePanel(win)).toBeVisible()
  await expect(codePanel(win).locator('.board-preview__name')).toHaveText(CODE_FILE)
  await expect(codePanel(win).locator('.code-hover__body')).toContainText('export function greet')
  // Coloured: the keyword, the string, the comment and the number are not all one colour.
  await expect.poll(async () => (await cardColours(win)).length).toBeGreaterThanOrEqual(3)
  await expect(codePanel(win).locator('.code-hover__body')).toContainText('row55')
  await expect(codePanel(win).locator('.code-hover__body')).not.toContainText('row56') // 4 lines of code, then 56 rows: 60 lines
  await shoot(win, 'hover-preview-03-code-file')
  await win.locator('.sidebar__lenses').hover()
  await expect(codePanel(win)).toHaveCount(0)

  // Recents lists it (its save is in the seeded log): rest on its row there.
  await recentsTab(win).click()
  const recentRow = win.locator('.sidebar__body [aria-label="Recents"] [data-path]').filter({ hasText: CODE_FILE }).first()
  await recentRow.hover()
  await expect(codePanel(win)).toBeVisible()
  await expect.poll(async () => (await cardColours(win)).length).toBeGreaterThanOrEqual(3)
  await shoot(win, 'hover-preview-04-code-file-recents')
})
