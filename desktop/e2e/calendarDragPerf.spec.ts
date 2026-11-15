/**
 * A card drag on a big Rolling page (YAZ-5604 item 5) against the REAL app: about 450 cards in Rolling's weeks, "Fold
 * long days" Off (every card drawn), Wrap. A card's drag goes over 30 days in turn; each new day under the pointer is
 * timed from its dragover to the drop highlight drawn and the layout done. The median must fit in one frame (16 ms).
 * The run is the person's choice (it opens a window): `npm run e2e:only -- calendarDragPerf`.
 * `CAL_PERF_FOLDER=<folder>` adds the made-up pages to a COPY of that folder (never the folder itself).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, contents, launchApp, openFolder, seededState } from './helpers'

let userData: string
let vault: string
let folder: string
let app: ElectronApplication
let win: Page

const CARDS = 450
const p2 = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const start = (() => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
})()
const on = (days: number) => key(new Date(start.getTime() + days * 86_400_000))

const FOLDER_HEAD = `---
title: Calendar perf
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
      cardTitles: wrap
      calendarScale: rolling
      foldDays: false
---
Made-up pages for the calendar drag timing.
`

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'calperf-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'calperf-vault-'))
  const real = process.env.CAL_PERF_FOLDER
  if (real === undefined) {
    folder = path.join(vault, 'Calendar perf')
    await mkdir(folder)
    await writeFile(path.join(folder, '.folder.md'), FOLDER_HEAD)
  } else {
    // A copy, never the folder itself; the vault's `.yaseendocs` comes with it.
    folder = path.join(vault, path.basename(real))
    await cp(real, folder, { recursive: true })
    await cp(path.join(path.dirname(real), '.yaseendocs'), path.join(vault, '.yaseendocs'), { recursive: true }).catch(() => undefined)
  }
  // Made-up pages over Rolling's first 12 weeks, about 5 a day; every 40th is a bar over 3 days.
  await Promise.all(
    Array.from({ length: CARDS }, (_, i) => {
      const day = i % 84
      const end = i % 40 === 0 ? `End Date: ${on(day + 2)}\n` : ''
      return writeFile(path.join(folder, `Perf item ${i}.md`), `---\nStart Date: ${on(day)}\n${end}---\n`)
    }),
  )
  const state = seededState(vault, null)
  state.windows[0]!.bounds = { x: 40, y: 40, width: 1500, height: 1000 }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await openFolder(win, folder)
  await expect(contents(win).locator('.view-cal__grid--rolling')).toBeVisible()
})

test.afterAll(async () => {
  // The drag made up in the page leaves the window slow to close: it is closed, or its process ended, after 5 s.
  await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))])
  app?.process().kill()
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test(`Rolling with ${CARDS} cards: each new day under a dragged card is drawn in one frame`, async () => {
  test.setTimeout(120_000)
  await contents(win).locator('.view-cal__today').click()
  await expect.poll(() => contents(win).locator('.view-cal__grid .view-cal__card').count()).toBeGreaterThan(CARDS * 0.8)
  const result = await win.evaluate(async () => {
    const root = document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .view-cal')!
    // A task after React's own (its scheduler posts messages): the work of the dragover is done by then.
    const after = () =>
      new Promise<void>((r) => {
        const ch = new MessageChannel()
        ch.port1.onmessage = () => r()
        ch.port2.postMessage(0)
      })
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    const cards = root.querySelectorAll('.view-cal__grid .view-cal__day .view-cal__card').length
    const dt = new DataTransfer()
    const card = root.querySelector<HTMLElement>('.view-cal__grid .view-cal__day .view-cal__card')!
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await frame()
    // Days in the middle of the window, away from Rolling's edge scroll.
    const all = Array.from(root.querySelectorAll<HTMLElement>('.view-cal__grid [data-day]'))
    // A row of the middle in view, as a person drags on what they see.
    all[Math.floor(all.length / 2)]!.scrollIntoView({ block: 'center' })
    await frame()
    const inView = all.filter((d) => {
      const b = d.getBoundingClientRect()
      return b.top > 200 && b.top < window.innerHeight - 200
    })
    const days = (inView.length >= 20 ? inView : all.slice(7)).slice(0, 30)
    const times: number[] = []
    let missed = 0
    for (const day of days) {
      const box = day.getBoundingClientRect()
      const t0 = performance.now()
      day.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }))
      for (let i = 0; i < 500 && !day.classList.contains('view-cal__day--drop'); i++) await after()
      if (!day.classList.contains('view-cal__day--drop')) {
        missed++
        continue
      }
      // The style and layout the new highlight needs, as the frame would do them.
      void document.body.getBoundingClientRect()
      void day.offsetHeight
      times.push(performance.now() - t0)
      await frame()
    }
    document.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    const sorted = [...times].sort((a, b) => a - b)
    return { missed, cards, all: all.length, inView: inView.length, days: times.length, median: sorted[Math.floor(sorted.length / 2)] ?? NaN, p90: sorted[Math.floor(sorted.length * 0.9)] ?? NaN, max: sorted[sorted.length - 1] ?? NaN, times }
  })
  console.log(`calendarDragPerf: ${result.cards} cards in days (${result.all} days drawn, ${result.inView} in view), ${result.days} days timed (${result.missed} skipped: the card's own day), median ${result.median.toFixed(1)} ms, p90 ${result.p90.toFixed(1)} ms, max ${result.max.toFixed(1)} ms`)
  expect(result.days).toBeGreaterThanOrEqual(20)
  expect(result.median).toBeLessThan(16)
})
