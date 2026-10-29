/**
 * Today's daily note (YAZ-3607) against the REAL app: one window on two temp vaults, Daily notes on, the daily notes
 * folder "Daily" only in the SECOND vault (with a template), and the active tab in the first:
 *   1 The calendar button in the sidebar footer makes today's note in the second vault's Daily, from its template, and
 *     opens it (D5, D6, D15)
 *   2 Two more presses, one of them File › Open Today's Daily Note, open the same note: still one file (D5, D11)
 *   3 "Make a folder for each day" on, in the middle of the day: the note made before it opens (D18); with that note
 *     deleted on disk, the next press makes the day folder and the note in it, from the template (D9, D16)
 * The menu item is clicked by id with no focus step (`clickMenuItemQuietly`): a hidden run never takes the focus.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { activeTab, appWindow, clickMenuItemQuietly, fileRow, launchApp, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let first: string
let second: string
let app: ElectronApplication
let win: Page

/** Today's name in the default style, `YYYY-MM-DD`, on this Mac's day. */
const today = (() => {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
})()

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'daily-userdata-'))
  first = await mkdtemp(path.join(tmpdir(), 'daily-first-'))
  second = await mkdtemp(path.join(tmpdir(), 'daily-second-'))
  await writeFile(path.join(first, 'Top.md'), 'top\n')
  await mkdir(path.join(second, 'Daily'))
  await writeFile(path.join(second, 'Daily', '.template.md'), '## Top 3 today\n\n- \n')
  const state = seededState(first, path.join(first, 'Top.md'))
  state.recents.push({ path: second, lastOpened: Date.now() - 1000 })
  state.windows[0].roots = [first, second]
  state.folders[second] = { ...state.folders[first], lastFile: null }
  state.settings = { ...state.settings, dailyNotes: true, dailyNoteFolder: 'Daily' }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Top')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, first, second].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test("the calendar button makes today's note in the vault that holds Daily, from its template, and opens it", async () => {
  await win.locator('.sidebar__daily').click()
  await expect(activeTab(win)).toHaveText(new RegExp(today))
  await expect(fileRow(win, today)).toBeVisible()
  expect((await readdir(path.join(second, 'Daily'))).sort()).toEqual(['.template.md', `${today}.md`])
  expect(await readFile(path.join(second, 'Daily', `${today}.md`), 'utf8')).toContain('## Top 3 today')
})

test("two more presses, one from File › Open Today's Daily Note, open the same note: still one file", async () => {
  await win.locator('.sidebar__daily').dblclick()
  await clickMenuItemQuietly(app, 'menu.file.daily-note')
  await expect(activeTab(win)).toHaveText(new RegExp(today))
  expect((await readdir(path.join(second, 'Daily'))).sort()).toEqual(['.template.md', `${today}.md`])
})

test('day folders on: the note made before the switch still opens; with that note gone, the day folder and the note are made', async () => {
  // The settings write a window makes (`state.setSettings`); every window hears it.
  await win.evaluate(async () => {
    const { state } = (window as unknown as { yaseenDocs: { state: { get(): Promise<{ settings: object }>; setSettings(s: object): Promise<void> } } }).yaseenDocs
    const { settings } = await state.get()
    await state.setSettings({ ...settings, dailyNoteDayFolder: true })
  })
  await win.locator('.sidebar__daily').click()
  await expect(activeTab(win)).toHaveText(new RegExp(today))
  expect((await readdir(path.join(second, 'Daily'))).sort()).toEqual(['.template.md', `${today}.md`])
  await rm(path.join(second, 'Daily', `${today}.md`))
  await expect(fileRow(win, today)).toHaveCount(0)
  await win.locator('.sidebar__daily').click()
  await expect(fileRow(win, today)).toBeVisible()
  expect((await readdir(path.join(second, 'Daily'))).sort()).toEqual(['.template.md', today])
  expect(await readFile(path.join(second, 'Daily', today, `${today}.md`), 'utf8')).toContain('## Top 3 today')
})
