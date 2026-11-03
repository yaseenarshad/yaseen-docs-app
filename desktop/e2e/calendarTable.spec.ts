/**
 * Calendar tables (YAZ-4158: YAZ-4162, YAZ-4163, YAZ-4164; D2, D7, D11 on the working log YAZ-4159) against the REAL
 * app, the user flow: Daily notes on, today's note made from the folder's template; in it "/Calendar table" + Enter
 * inserts the day's table (the Calendar day setting, 5:00 am to 10:00 pm by default, D19; the default time format
 * `h:mm a`; `calendar 30m`; column A in the middle, YAZ-4166), a plan typed in a row saves with the table; the row
 * that holds the current time shows the marker; another note in front, then the daily-note button opens today's note
 * at now: the caret in the now row's first empty cell.
 * The run is the person's choice (it opens a window): `npm run e2e:only -- calendarTable`.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CALENDAR_DAY, DEFAULT_TIME_FORMAT, formatTime } from '../../shared/timeFormat'
import { activeTab, appWindow, editorOf, fileRow, launchApp, nextFrame, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const p2 = (n: number) => String(n).padStart(2, '0')
/** Today's name in the default style, `YYYY-MM-DD`, on this Mac's day. */
const today = (() => {
  const now = new Date()
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
})()
const todayPath = () => path.join(vault, 'Daily', `${today}.md`)
/** The default Calendar day's times, each 30 minutes, in the default time format: `5:00 am` … `10:00 pm` (YAZ-4163 demo). */
const DAY_TIMES: string[] = []
for (let t = DEFAULT_CALENDAR_DAY.start; t <= DEFAULT_CALENDAR_DAY.end; t += 30) DAY_TIMES.push(formatTime(DEFAULT_TIME_FORMAT, t))
const FIRST = DAY_TIMES[0]!
const LAST = DAY_TIMES.at(-1)!
/** The day's window: from its first row to the end of its last slot (10:30 pm by default). */
const SKIP = `the current time is outside ${FIRST}–${formatTime(DEFAULT_TIME_FORMAT, DEFAULT_CALENDAR_DAY.end + 30)}: no row holds it`
/** The row the current time is in, in the default time format, or null outside the day's window. */
const nowRowTime = (): string | null => {
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (minutes < DEFAULT_CALENDAR_DAY.start || minutes >= DEFAULT_CALENDAR_DAY.end + 30) return null
  return formatTime(DEFAULT_TIME_FORMAT, Math.floor(minutes / 30) * 30)
}
const slashMenu = (w: Page) => w.locator('.milkdown-slash-menu[data-show="true"]')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'calendar-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'calendar-vault-'))
  await writeFile(path.join(vault, 'Other.md'), 'Another note\n')
  await mkdir(path.join(vault, 'Daily'))
  await writeFile(path.join(vault, 'Daily', '.template.md'), '## Today\n\nPlan\n')
  const state = seededState(vault, path.join(vault, 'Other.md'))
  // "The button opens" is "The note at now" by default (D11).
  state.settings = { ...state.settings, dailyNotes: true, dailyNoteFolder: 'Daily' }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(fileRow(win, 'Other')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('"/Calendar table" + Enter in today\'s note inserts the day\'s table, and a plan typed in it saves', async () => {
  await win.locator('.sidebar__daily').click()
  await expect(activeTab(win)).toHaveText(new RegExp(today))
  await editorOf(win).locator('p', { hasText: /^Plan$/ }).click()
  await win.keyboard.press('End')
  await win.keyboard.press('Enter')
  await nextFrame(win)
  await win.keyboard.type('/calendar')
  await expect(slashMenu(win)).toBeVisible()
  await expect(slashMenu(win).locator('.menu-group li').first()).toHaveText('Calendar table')
  await win.keyboard.press('Enter')
  await expect(slashMenu(win)).toHaveCount(0)
  const table = editorOf(win).locator('.milkdown-table-block')
  // The header row and one row per time: 36 rows, 5:00 am to 10:00 pm by default.
  await expect(table.locator('tr')).toHaveCount(DAY_TIMES.length + 1)
  await expect(table.locator('tr').nth(1).locator('td').first()).toHaveText(FIRST)
  await expect(table.locator('tr').last().locator('td').first()).toHaveText(LAST)
  // A plan in the first row: click its Plan cell and type.
  await table.locator('tr').nth(1).locator('td').nth(1).click()
  await win.keyboard.type('Wake and stretch')
  // Column A's body cells are Middle (YAZ-4166): `valign A2:A36 middle` comes first.
  const comment = `<!-- table: valign A2:A${DAY_TIMES.length + 1} middle, height compact, freeze 1 row 1 col, calendar 30m -->`
  await expect.poll(() => readFile(todayPath(), 'utf8'), { timeout: 10_000 }).toMatch(new RegExp(`\\| ${FIRST} +\\| Wake and stretch +\\|[^]*${comment}`))
  await shoot(win, 'calendar-01-inserted')
})

test('the row that holds the current time shows the marker', async () => {
  const time = nowRowTime()
  test.skip(time === null, SKIP)
  const nowRow = editorOf(win).locator('tr.table-now-row')
  await expect(nowRow).toHaveCount(1)
  await expect(nowRow.locator('td').first()).toHaveText(time!)
  // The line's place in the row, 0–1 down its slot.
  const at = Number(await nowRow.evaluate((row) => (row as HTMLElement).style.getPropertyValue('--table-now')))
  expect(at).toBeGreaterThanOrEqual(0)
  expect(at).toBeLessThan(1)
  await shoot(win, 'calendar-02-marker')
})

test('from another note, the daily-note button opens today\'s note at now: the caret in the now row\'s first empty cell', async () => {
  const time = nowRowTime()
  test.skip(time === null, SKIP)
  await fileRow(win, 'Other').click()
  await expect(activeTab(win)).toHaveText(/Other/)
  await win.locator('.sidebar__daily').click()
  await expect(activeTab(win)).toHaveText(new RegExp(today))
  await expect
    .poll(() =>
      win.evaluate(() => {
        const node = document.getSelection()?.anchorNode ?? null
        const cell = (node instanceof Element ? node : node?.parentElement)?.closest('td')
        const row = cell?.closest('tr')
        return row === null || row === undefined || cell === null || cell === undefined ? null : { now: row.classList.contains('table-now-row'), col: (cell as HTMLTableCellElement).cellIndex }
      }),
    )
    .toEqual({ now: true, col: 1 })
  await expect(editorOf(win).locator('tr.table-now-row')).toBeInViewport()
  await shoot(win, 'calendar-03-daily-at-now')
})
