/**
 * The hover preview on the new tab page (YAZ-3403 D1, D2, D7) against the REAL app: a window with no tabs shows the
 * page; a rest on a recent note opens the sidebar's note panel beside the row, with the top of the note. Then
 * Settings › Files & Links › Preview on hover › New tab page goes off: the state file says so, no panel opens on the
 * page, and the sidebar (its own switch) still previews (S36). Same harness as startPage.spec.ts (temp
 * `--user-data-dir`, a COPY of the generated fixture vault), hidden. The dwell, each close and the other places are
 * the unit suites' (`workspace/StartPage.test.tsx`, `sidebar/Sidebar.test.tsx`, `views/view/TableView.test.tsx`,
 * `editor/wikilink/wikilinkHover.test.ts`).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, fileRow, launchApp, readState, seededState, shoot } from './helpers'

/** The body of the fixture's `Ideas.md` (helpers.buildFixtureVault): the top of the note that the panel shows. */
const IDEAS_BODY = 'synthetic-idea-body'
const MINUTE = 60_000

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const recent = (w: Page) => w.locator('.start__column[data-col="recent"] .start__row')
const notePanel = (w: Page) => w.locator('.note-preview')
const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'hoverpreview-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
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
  const state = seededState(vault, null)
  state.folders[vault].opens = { [roadmap]: { score: 1, last: seededAt - MINUTE }, [ideas]: { score: 1, last: seededAt - 2 * MINUTE } }
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
