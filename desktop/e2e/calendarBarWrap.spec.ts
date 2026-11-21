/**
 * Calendar bars wrap with "Card titles: Wrap" (YAZ-5600) against the REAL app: a folder's Calendar view with an End date
 * column, bars (pages with a start and an end) whose titles do not fit on one line, a bar that crosses a week's edge, and
 * a one-day-wide piece. In Month, Week and Rolling, with "Fold long days" On and Off, the boxes are measured in the
 * window: with Wrap a long bar is taller than one line; no one-day card or "+N more" sits on a bar; no card or bar
 * leaves its week row. With Clip a bar stays one line and its title ends in "…".
 * Each view's settings are written to the folder's `.folder.md` on disk; the open view follows the file.
 * The run is the person's choice (it opens a window): `npm run e2e:only -- calendarBarWrap`.
 * `BAR_WRAP_FOLDER=<folder>` runs the same checks on a COPY of that folder (never the folder itself), and
 * `BAR_WRAP_SHOTS=<dir>` keeps a screenshot of each view there.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, contents, launchApp, openFolder, seededState } from './helpers'

let userData: string
let vault: string
let folder: string
let app: ElectronApplication
let win: Page

const p2 = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
/** This week's Monday, so the pages land around today: Month and Rolling both open on today. */
const monday = (() => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
})()
const on = (days: number) => key(new Date(monday.getTime() + days * 86_400_000))

/** Made-up pages: [title, start, end?]. Saturday to Monday leaves a one-day-wide piece whichever day starts the week. */
const PAGES: Array<[string, string, string?]> = [
  ['Team offsite in the mountains, with the long drive there and back', on(1), on(3)],
  ['Conference week, talks, workshops and the dinner on the last night', on(3), on(9)],
  ['Weekend trip to the coast with the whole family', on(5), on(7)],
  ['Spring planning sprint for the new launch, part two', on(8), on(10)],
  ['Dentist', on(1)],
  ['Call the bank about the card fees and the new account', on(1)],
  ['Read chapter four of the book club pick', on(2)],
  ['Lunch with Sam', on(2)],
  ['Pick up the dry cleaning on the way home', on(2)],
  ['Gym, legs', on(4)],
  ['Write the changelog for release 2.4, short and clear', on(8)],
  ['Water the plants', on(9)],
]

const FOLDER_HEAD = `---
title: Trips and plans
folder_settings:
  columns:
    Start Date:
      kind: date
    End Date:
      kind: date
  views:
    - type: calendar
      name: Calendar
      dateProperty: note.Start Date
      endDateProperty: note.End Date
---
Made-up pages for the calendar bar checks.
`

async function buildFixture(): Promise<string> {
  const dir = path.join(vault, 'Trips and plans')
  await mkdir(dir)
  await writeFile(path.join(dir, '.folder.md'), FOLDER_HEAD)
  await Promise.all(
    PAGES.map(([title, start, end]) =>
      writeFile(path.join(dir, `${title}.md`), `---\nStart Date: ${start}\n${end === undefined ? '' : `End Date: ${end}\n`}---\n`),
    ),
  )
  return dir
}

/** The calendar view's settings in `.folder.md`: these keys set (or removed when undefined), the rest kept. */
async function setCalendar(next: { calendarScale?: string; foldDays?: boolean; cardTitles?: string }): Promise<void> {
  const file = path.join(folder, '.folder.md')
  const lines = (await readFile(file, 'utf8')).split('\n')
  const at = lines.findIndex((l) => /^\s*- type: calendar\s*$/.test(l))
  const indent = /^(\s*)-/.exec(lines[at]!)![1]!.length + 2
  let end = at + 1
  while (end < lines.length && (lines[end]!.match(/^(\s*)/)![1]!.length >= indent || lines[end]!.trim() === '') && lines[end] !== '---') end++
  const keys = Object.keys(next)
  const kept = lines.slice(at + 1, end).filter((l) => !keys.some((k) => new RegExp(`^\\s{${indent}}${k}:`).test(l)))
  const added = Object.entries(next)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${' '.repeat(indent)}${k}: ${String(v)}`)
  await writeFile(file, [...lines.slice(0, at + 1), ...added, ...kept, ...lines.slice(end)].join('\n'))
}

interface Measure {
  bars: Array<{ title: string; height: number; clipped: boolean }>
  overlaps: string[]
  spills: string[]
  line: number
}

/** The boxes in the window: each bar's height and clip, any card on a bar in its row, any box outside its week row. */
const measure = (w: Page): Promise<Measure> =>
  w.evaluate(() => {
    const grid = document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .view-cal__grid')!
    const name = (el: Element) => (el.querySelector('.view-cal__card-name')?.textContent ?? el.textContent ?? '').slice(0, 40)
    const meet = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
    const overlaps: string[] = []
    const spills: string[] = []
    const bars: Measure['bars'] = []
    let line = 0
    for (const row of Array.from(grid.querySelectorAll('.view-cal__week--days'))) {
      const box = row.getBoundingClientRect()
      const rowBars = Array.from(row.querySelectorAll(':scope > .view-cal__bar'))
      const others = Array.from(row.querySelectorAll('.view-cal__day .view-cal__card, .view-cal__day .view-cal__more'))
      for (const bar of rowBars) {
        const b = bar.getBoundingClientRect()
        // The box that cuts the title: a read-only page's name text, else the title.
        const text = (bar.querySelector('.view-read-only-name__text') ?? bar.querySelector('.view-cal__card-title')!) as HTMLElement
        bars.push({ title: name(bar), height: b.height, clipped: text.scrollWidth > text.clientWidth + 1 })
        line = Math.max(line, parseFloat(getComputedStyle(bar).lineHeight))
        for (const other of [...others, ...rowBars.filter((x) => x !== bar)]) if (meet(b, other.getBoundingClientRect())) overlaps.push(`${name(other)} on ${name(bar)}`)
      }
      for (const el of [...rowBars, ...others]) {
        const b = el.getBoundingClientRect()
        if (b.top < box.top - 0.5 || b.bottom > box.bottom + 0.5) spills.push(name(el))
      }
    }
    return { bars, overlaps: [...new Set(overlaps)], spills, line }
  })

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'barwrap-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'barwrap-vault-'))
  const real = process.env.BAR_WRAP_FOLDER
  if (real === undefined) folder = await buildFixture()
  else {
    // A copy, never the folder itself; the vault's `.yaseendocs` comes with it when it has one.
    folder = path.join(vault, path.basename(real))
    await cp(real, folder, { recursive: true })
    await cp(path.join(path.dirname(real), '.yaseendocs'), path.join(vault, '.yaseendocs'), { recursive: true }).catch(() => undefined)
  }
  const state = seededState(vault, null)
  state.windows[0]!.bounds = { x: 40, y: 40, width: 1500, height: 1000 }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await openFolder(win, folder)
  await expect(contents(win).locator('.view-cal__grid')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

const SCALES = ['month', 'week', 'rolling'] as const

for (const scale of SCALES)
  for (const fold of [true, false])
    test(`${scale}, fold ${fold ? 'On' : 'Off'}: Wrap wraps the bars and nothing overlaps or leaves its week; Clip keeps one line`, async () => {
      const grid = contents(win).locator('.view-cal__grid')
      for (const titles of ['wrap', 'clip'] as const) {
        await setCalendar({ calendarScale: scale, foldDays: fold ? undefined : false, cardTitles: titles === 'wrap' ? 'wrap' : undefined })
        await expect(grid).toHaveClass(scale === 'month' ? /^view-cal__grid(?! view-cal__grid--(week|rolling))/ : new RegExp(`view-cal__grid--${scale}`))
        if (titles === 'wrap') await expect(contents(win).locator('.view-cal__card--wrap').first()).toBeVisible()
        else await expect(contents(win).locator('.view-cal__card--wrap')).toHaveCount(0)
        // Today's week at the top, as a jump puts it (Rolling keeps weeks above it).
        await contents(win).locator('.view-cal__today').click()
        await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        const m = await measure(win)
        const shots = process.env.BAR_WRAP_SHOTS
        if (shots !== undefined && scale !== 'week') {
          await mkdir(shots, { recursive: true })
          await win.screenshot({ path: path.join(shots, `${scale}-fold-${fold ? 'on' : 'off'}-${titles}.png`) })
        }
        expect(m.bars.length).toBeGreaterThan(0)
        expect.soft(m.overlaps, `${titles}: a card on a bar`).toEqual([])
        expect.soft(m.spills, `${titles}: a box outside its week row`).toEqual([])
        if (titles === 'wrap') {
          // A title that does not fit one line wraps: no bar is cut, and the long ones are taller than one line.
          expect.soft(m.bars.filter((b) => b.clipped).map((b) => b.title), 'wrap: a bar still cut').toEqual([])
          if (process.env.BAR_WRAP_FOLDER === undefined) expect.soft(Math.max(...m.bars.map((b) => b.height))).toBeGreaterThan(2 * m.line)
        } else {
          for (const b of m.bars) expect.soft(b.height, `clip: ${b.title} is one line`).toBeLessThan(2 * m.line)
          if (process.env.BAR_WRAP_FOLDER === undefined) expect.soft(m.bars.some((b) => b.clipped), 'clip: a long bar ends in "…"').toBe(true)
        }
      }
    })
