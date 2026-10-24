/**
 * RECENTS (YAZ-3235): the 6th sidebar tab lists the files the app saved last, by day (D3 to D7).
 * A save in the app logs the file (D1, S1); the note then stands at the top of "Today" with the time
 * of the save (S18). A right-click on its row → "Show in sidebar" shows the Files tab, unfolds the
 * folder and lights the note (D7, S20).
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a temp vault, `recents-` step
 * screenshots, out of sight (`YASEEN_DOCS_E2E_HIDDEN`).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, fileRow, launchApp, lensTab, menuItem, readState, seededState, shoot } from './helpers'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const recentsTab = (w: Page) => w.locator('.sidebar__lenses [role="tab"][aria-label="Recents"]')
const day = (w: Page, label: string) => w.locator('.sidebar__body [aria-label="Recents"] > li').filter({ has: w.locator('.recents__day', { hasText: new RegExp(`^${label}$`) }) })
const rowsOf = (scope: ReturnType<typeof day>) => scope.locator('ul .tree__row')
const MARKER = 'recents-e2e-marker'

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz3235-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'yaz3235-vault-'))
  await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
  await mkdir(path.join(vault, 'Projects'), { recursive: true })
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('a save puts the note at the top of Today with its time; "Show in sidebar" shows it lit in Files', async () => {
  const plan = path.join(vault, 'Projects', 'Plan.md')
  const old = path.join(vault, 'Old.md')
  await writeFile(plan, 'plan body\n')
  await writeFile(old, 'old body\n')
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime()
  const state = seededState(vault, plan)
  // A save of yesterday, logged before this run.
  state.folders[vault].edits = { [old]: yesterday }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')

  // S1: type in the open note; the autosave writes it, and main logs the save.
  await win.locator('.ProseMirror').getByText('plan body').click()
  await win.keyboard.press('End')
  await win.keyboard.type(` ${MARKER}`, { delay: 15 })
  await expect.poll(async () => (await readFile(plan, 'utf8')).includes(MARKER), { timeout: 10_000 }).toBe(true)
  await expect.poll(async () => (await readState(userData)).folders[vault]?.edits[plan] ?? 0, { timeout: 10_000 }).toBeGreaterThan(now.getTime() - 1000)

  // S13: the 6th tab, a glyph named "Recents". S18: the note at the top of Today, with the time on the right.
  await recentsTab(win).click()
  await expect(recentsTab(win)).toHaveAttribute('aria-selected', 'true')
  await expect(win.locator('.sidebar__body .recents__day')).toHaveText(['Today', 'Yesterday'])
  const top = rowsOf(day(win, 'Today')).first()
  await expect(top.locator('.tree__label')).toHaveText('Plan')
  await expect(top.locator('.tree__count')).toHaveText(/^\d{1,2}:\d{2}/)
  await expect(top).toHaveAttribute('title', plan)
  await expect(top).toHaveClass(/tree__row--active/)
  await expect(rowsOf(day(win, 'Yesterday')).locator('.tree__label')).toHaveText(['Old'])
  await shoot(win, 'recents-1-today')

  // D7, S20: right-click → "Show in sidebar": the Files tab shows, the folder unfolds, and the note is lit.
  await top.click({ button: 'right' })
  await expect(win.locator('.ctx-overlay .ctx-menu [role="menuitem"]').first()).toHaveText('Show in sidebar')
  await shoot(win, 'recents-2-menu')
  await menuItem(win, 'Show in sidebar').click()
  await expect(lensTab(win, 'Files')).toHaveAttribute('aria-selected', 'true')
  await expect(fileRow(win, 'Plan')).toBeVisible()
  await expect(fileRow(win, 'Plan')).toHaveClass(/tree__row--active/)
  await shoot(win, 'recents-3-shown-in-files')
})
