/**
 * Calendar bars follow the view's sort (YAZ-5603) against the REAL app: a folder's Calendar view sorted by Order, with
 * two bars over the same first shown day where the shorter one has the lower Order (the "Sarmad" case). In Month, Week
 * and Rolling, with "Fold long days" On and Off and "Card titles: Wrap": the bar that sorts first sits above; no two
 * bars, and no bar and card, share a spot. With the sort taken away the longer bar is on top again (start, then length).
 * The run is the person's choice (it opens a window): `npm run e2e:only -- calendarBarOrder`.
 * `BAR_ORDER_FOLDER=<folder>` runs the overlap checks on a COPY of that folder (never the folder itself), and
 * `BAR_ORDER_SHOTS=<dir>` keeps a screenshot of each view there.
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
const real = process.env.BAR_ORDER_FOLDER

const p2 = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
/** This week's Sunday at noon: the pages land in today's week, where Month, Week and Rolling all open. */
const sunday = (() => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
})()
const on = (days: number) => key(new Date(sunday.getTime() + days * 86_400_000))

/** Made-up pages: [title, order, start, end?]. "Long trip" starts before the week, as Sarmad did. */
const PAGES: Array<[string, number, string, string?]> = [
  ['Long trip', 9, on(-2), on(3)],
  ['Short meeting', 1, on(0), on(1)],
  ['Conference', 3, on(1), on(3)],
  ['Workshop', 5, on(4), on(5)],
  ['Dentist', 2, on(0)],
  ['Lunch with Sam', 4, on(1)],
  ['Gym', 6, on(4)],
]

const FOLDER_HEAD = `---
title: Trips and plans
folder_settings:
  columns:
    Start Date:
      kind: date
    End Date:
      kind: date
    order:
      kind: number
  views:
    - type: calendar
      name: Calendar
      dateProperty: note.Start Date
      endDateProperty: note.End Date
      cardTitles: wrap
      sort:
        - property: note.order
          direction: ASC
---
Made-up pages for the calendar bar order checks.
`

async function buildFixture(): Promise<string> {
  const dir = path.join(vault, 'Trips and plans')
  await mkdir(dir)
  await writeFile(path.join(dir, '.folder.md'), FOLDER_HEAD)
  await Promise.all(
    PAGES.map(([title, order, start, end]) =>
      writeFile(path.join(dir, `${title}.md`), `---\nStart Date: ${start}\n${end === undefined ? '' : `End Date: ${end}\n`}order: ${order}\n---\n`),
    ),
  )
  return dir
}

/** The calendar view's settings in `.folder.md`: these keys set (or removed when undefined), the rest kept. A `sort:` block goes with its key. */
async function setCalendar(next: { calendarScale?: string; foldDays?: boolean; sort?: boolean }): Promise<void> {
  const file = path.join(folder, '.folder.md')
  let lines = (await readFile(file, 'utf8')).split('\n')
  const at = lines.findIndex((l) => /^\s*- type: calendar\s*$/.test(l))
  const indent = /^(\s*)-/.exec(lines[at]!)![1]!.length + 2
  let end = at + 1
  while (end < lines.length && (lines[end]!.match(/^(\s*)/)![1]!.length >= indent || lines[end]!.trim() === '') && lines[end] !== '---') end++
  let body = lines.slice(at + 1, end)
  const own = (l: string, k: string) => new RegExp(`^\\s{${indent}}${k}:`).test(l)
  for (const k of Object.keys(next).filter((k) => k !== 'sort')) body = body.filter((l) => !own(l, k))
  if (next.sort === false) {
    const s = body.findIndex((l) => own(l, 'sort'))
    if (s !== -1) {
      let e = s + 1
      while (e < body.length && body[e]!.match(/^(\s*)/)![1]!.length > indent) e++
      body.splice(s, e - s)
    }
  }
  const added = Object.entries(next)
    .filter(([k, v]) => k !== 'sort' && v !== undefined)
    .map(([k, v]) => `${' '.repeat(indent)}${k}: ${String(v)}`)
  lines = [...lines.slice(0, at + 1), ...added, ...body, ...lines.slice(end)]
  await writeFile(file, lines.join('\n'))
}

/** Each bar piece's title and box, and any two boxes (bars, cards, "+N more") in a week row that meet. */
const measure = (w: Page) =>
  w.evaluate(() => {
    const grid = document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .view-cal__grid')!
    const name = (el: Element) => (el.querySelector('.view-cal__card-name')?.textContent ?? el.textContent ?? '').slice(0, 40)
    const meet = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
    const overlaps: string[] = []
    const rows: Array<Array<{ title: string; top: number; left: number; right: number }>> = []
    for (const row of Array.from(grid.querySelectorAll('.view-cal__week--days'))) {
      const bars = Array.from(row.querySelectorAll(':scope > .view-cal__bar'))
      const others = Array.from(row.querySelectorAll('.view-cal__day .view-cal__card, .view-cal__day .view-cal__more'))
      rows.push(bars.map((bar) => ({ title: name(bar), ...(({ top, left, right }) => ({ top, left, right }))(bar.getBoundingClientRect()) })))
      for (const bar of bars) for (const other of [...others, ...bars.filter((x) => x !== bar)]) if (meet(bar.getBoundingClientRect(), other.getBoundingClientRect())) overlaps.push(`${name(other)} on ${name(bar)}`)
    }
    return { rows, overlaps: [...new Set(overlaps)] }
  })

/** In the row where both show, whether `upper`'s piece is above `lower`'s. */
const above = (rows: Awaited<ReturnType<typeof measure>>['rows'], upper: string, lower: string): boolean | null => {
  for (const row of rows) {
    const a = row.find((b) => b.title.startsWith(upper))
    const b = row.find((x) => x.title.startsWith(lower))
    if (a !== undefined && b !== undefined && a.left < b.right && b.left < a.right) return a.top < b.top
  }
  return null
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'barorder-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'barorder-vault-'))
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

const settle = async () => {
  await contents(win).locator('.view-cal__today').click()
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}
const shoot = async (name: string) => {
  const shots = process.env.BAR_ORDER_SHOTS
  if (shots === undefined) return
  await mkdir(shots, { recursive: true })
  await win.screenshot({ path: path.join(shots, `${name}.png`) })
}

for (const scale of ['month', 'week', 'rolling'] as const)
  for (const fold of [true, false])
    test(`${scale}, fold ${fold ? 'On' : 'Off'}: the bar that sorts first is on top, and nothing overlaps`, async () => {
      const grid = contents(win).locator('.view-cal__grid')
      await setCalendar({ calendarScale: scale, foldDays: fold ? undefined : false })
      await expect(grid).toHaveClass(scale === 'month' ? /^view-cal__grid(?! view-cal__grid--(week|rolling))/ : new RegExp(`view-cal__grid--${scale}`))
      await settle()
      const m = await measure(win)
      await shoot(`${scale}-fold-${fold ? 'on' : 'off'}`)
      expect(m.rows.flat().length).toBeGreaterThan(0)
      expect.soft(m.overlaps, 'a bar on a bar or a card').toEqual([])
      if (real === undefined) {
        expect.soft(above(m.rows, 'Short meeting', 'Long trip'), 'Short meeting (Order 1) above Long trip (Order 9)').toBe(true)
        expect.soft(above(m.rows, 'Conference', 'Long trip'), 'Conference (Order 3) above Long trip (Order 9)').toBe(true)
      }
    })

test('no sort: start, then length, as before', async () => {
  test.skip(real !== undefined, 'the made-up folder only')
  await setCalendar({ calendarScale: 'month', foldDays: undefined, sort: false })
  await expect(contents(win).locator('.view-cal__grid')).not.toHaveClass(/view-cal__grid--(week|rolling)/)
  await expect.poll(async () => above((await measure(win)).rows, 'Long trip', 'Short meeting')).toBe(true)
  await settle()
  const m = await measure(win)
  await shoot('month-no-sort')
  expect(m.overlaps).toEqual([])
})
