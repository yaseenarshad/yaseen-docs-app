/**
 * The calendar view (YAZ-4540, YAZ-949): ViewsPane mounted with react-dom in jsdom, the clock held
 * at Thu 10 Dec 2026, `writeProperty` mocked. Cards go on the date part as written (S3), a move
 * writes the new day and keeps the time (D4), and the "No date" tray takes and gives cards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLDER_PAGES, type IndexRecord } from '@shared/types'
import { parseViews, serializeViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
// The real date rules, with `dateColumns` counted (YAZ-4544).
vi.mock('../calendar', async (load) => {
  const real = await load<typeof import('../calendar')>()
  return { ...real, dateColumns: vi.fn(real.dateColumns), bucketByDay: vi.fn(real.bucketByDay) }
})
import { bucketByDay, dateColumns } from '../calendar'
import viewsCss from '../views.css?inline'
import tableCss from '../../editor/table/table.css?inline'
import { setHeaderRowSetting } from '../../editor/table/timeFormatSetting'
import { DEFAULT_HEADER_ROW } from '@shared/types'
import { writeProperties, writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CALENDAR = `views:
  - type: calendar
    name: C
`

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  properties,
})

const RECORDS: IndexRecord[] = [
  rec('Bare', { due: '2026-12-03' }),
  rec('Late zone', { due: '2026-12-03T23:30Z' }),
  rec('Timed', { due: '2026-12-04 10:30' }),
  rec('Nothing', {}),
  rec('Locked', { due: '2026-12-05' }),
  ...['A', 'B', 'C', 'D', 'E'].map((n) => rec(`Busy ${n}`, { due: '2026-12-15' })),
]

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/Tasks" records={RECORDS} folder={testFolderHost()} onOpenFile={onOpenFile} {...props} />,
      ),
    )
  draw()
  return { el: container, onOpenFile, yaml: () => serializeViews(parsed) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 11, 10, 12, 0))
  write.mockReset()
  write.mockResolvedValue({ mtime: 1 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
})

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const day = (el: ParentNode, key: string) => q<HTMLElement>(el, `[data-day="${key}"]`)
const titlesIn = (el: ParentNode) => [...el.querySelectorAll('.view-cal__card-title')].map((t) => t.textContent)
function byText<T extends HTMLElement>(el: ParentNode, sel: string, text: string): T {
  const n = [...el.querySelectorAll<T>(sel)].find((e) => e.textContent === text)
  if (n === undefined) throw new Error(`missing ${sel} "${text}"`)
  return n
}
function cardOf(el: ParentNode, title: string): HTMLElement {
  const card = [...el.querySelectorAll<HTMLElement>('.view-cal__card')].find((c) => c.querySelector('.view-cal__card-title')?.textContent === title)
  if (card === undefined) throw new Error(`missing card ${title}`)
  return card
}
function click(el: Element, init: MouseEventInit = {}): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })))
  draw()
}
function fire(el: Element, type: string): void {
  act(() => void el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))
  draw()
}
function drag(card: Element, target: Element): void {
  fire(card, 'dragstart')
  fire(target, 'dragover')
  fire(target, 'drop')
}
async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}

describe('calendar grid (YAZ-4540 D11)', () => {
  it('shows the month of today, Sunday first (the default since the YAZ-3746 demo round 2), with today ringed (S7)', () => {
    const { el } = mount(CALENDAR)
    expect(q(el, '.view-cal__month').textContent).toBe('December 2026')
    expect([...el.querySelectorAll('.view-cal__weekday')].map((d) => d.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(el.querySelectorAll('.view-cal__day')[0].getAttribute('data-day')).toBe('2026-11-29')
    expect(el.querySelectorAll('.view-cal__day--today')).toHaveLength(1)
    expect(day(el, '2026-12-10').classList.contains('view-cal__day--today')).toBe(true)
    expect(day(el, '2026-12-10').getAttribute('aria-current')).toBe('date')
  })

  it('a card goes on the date part as written: a time zone does not move it (S3)', () => {
    const { el } = mount(CALENDAR)
    // Both stay on Dec 3; the timed one comes first, as in Week (YAZ-4558 D22, so the page window steps as the day shows).
    expect(titlesIn(day(el, '2026-12-03'))).toEqual(['Late zone', 'Bare'])
    expect(titlesIn(day(el, '2026-12-04'))).toEqual(['Timed'])
  })

  it('‹ and › walk the months, and Today comes back', () => {
    const { el } = mount(CALENDAR)
    click(q(el, '[aria-label="Next month"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('January 2027')
    click(q(el, '[aria-label="Previous month"]'))
    click(q(el, '[aria-label="Previous month"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('November 2026')
    click(q(el, '[aria-label="Today"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('December 2026')
  })

  it('a day shows 3 cards and "+N more", which shows the full day', () => {
    const { el } = mount(CALENDAR)
    const busy = day(el, '2026-12-15')
    expect(titlesIn(busy)).toEqual(['Busy A', 'Busy B', 'Busy C'])
    const more = q(busy, '.view-cal__more')
    expect(more.textContent).toBe('+2 more')
    // A narrow day hides the word (YAZ-4544): views.css hides this span, so the button reads "+2".
    expect(q(more, '.view-cal__more-word').textContent).toBe(' more')
    click(more)
    expect(titlesIn(day(el, '2026-12-15'))).toEqual(['Busy A', 'Busy B', 'Busy C', 'Busy D', 'Busy E'])
  })

  it('an impossible date such as 2026-02-30 sits in "No date" (YAZ-4635 P6)', () => {
    const { el } = mount(CALENDAR, { records: [...RECORDS, rec('Odd', { due: '2026-02-30' })] })
    expect(titlesIn(q(el, '.view-cal__tray'))).toEqual(['Nothing', 'Odd'])
  })

  it('a page with no date sits in the "No date" tray below the grid', () => {
    const { el } = mount(CALENDAR)
    expect(titlesIn(q(el, '.view-cal__tray'))).toEqual(['Nothing'])
  })

  it('with no date column, it says how to get one', () => {
    const { el } = mount(CALENDAR, { records: [rec('Plain', { status: 'idea' })] })
    expect(el.querySelector('.view-cal__grid')).toBeNull()
    expect(q(el, '.view-cal__hint').textContent).toContain('date')
  })
})

describe('calendar clicks (YAZ-4540 D11)', () => {
  it('a plain click opens a background tab, ⌥-click the right panel, Enter the current tab', () => {
    const openBackground = vi.fn()
    const openRight = vi.fn()
    const { el, onOpenFile } = mount(CALENDAR, { folder: testFolderHost({ openBackground, openRight }) })
    click(cardOf(el, 'Bare'))
    expect(openBackground).toHaveBeenCalledWith('/vault/Bare.md')
    click(cardOf(el, 'Timed'), { altKey: true })
    expect(openRight).toHaveBeenCalledWith('/vault/Timed.md')
    expect(onOpenFile).not.toHaveBeenCalled()
    act(() => void cardOf(el, 'Bare').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Bare.md')
  })
})

describe('calendar moves (YAZ-4540 D4)', () => {
  it('a drag to a day writes YYYY-MM-DD, keeps the time, and shows the move at once', async () => {
    const { el } = mount(CALENDAR)
    drag(cardOf(el, 'Timed'), day(el, '2026-12-09'))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Timed.md', 'due', '2026-12-09 10:30')
    expect(titlesIn(day(el, '2026-12-09'))).toEqual(['Timed'])
    expect(titlesIn(day(el, '2026-12-04'))).toEqual([])
    await flush()
  })

  it('a zoned value keeps its time and zone', () => {
    const { el } = mount(CALENDAR)
    drag(cardOf(el, 'Late zone'), day(el, '2026-12-20'))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Late zone.md', 'due', '2026-12-20T23:30Z')
  })

  it('a drop on its own day writes nothing', () => {
    const { el } = mount(CALENDAR)
    drag(cardOf(el, 'Bare'), day(el, '2026-12-03'))
    expect(write).not.toHaveBeenCalled()
  })

  it('a card dragged into the "No date" tray loses its date; one dragged out of it gets the day', () => {
    const { el } = mount(CALENDAR)
    drag(cardOf(el, 'Bare'), q(el, '.view-cal__tray'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'due', undefined)
    expect(titlesIn(q(el, '.view-cal__tray'))).toContain('Bare')
    drag(cardOf(el, 'Nothing'), day(el, '2026-12-22'))
    expect(write).toHaveBeenLastCalledWith('/vault/Nothing.md', 'due', '2026-12-22')
  })

  it('a failed write snaps the card back and flags it', async () => {
    write.mockRejectedValueOnce(new Error('disk full'))
    const { el } = mount(CALENDAR)
    drag(cardOf(el, 'Bare'), day(el, '2026-12-09'))
    await flush()
    expect(titlesIn(day(el, '2026-12-03'))).toContain('Bare')
    expect(cardOf(el, 'Bare').querySelector('[role="alert"]')?.textContent).toBe('Move failed')
  })

  it('a read-only page does not drag', () => {
    const { el } = mount(CALENDAR, { readOnly: new Set(['/vault/Locked.md']) })
    expect(cardOf(el, 'Locked').getAttribute('draggable')).toBeNull()
    expect(cardOf(el, 'Bare').getAttribute('draggable')).toBe('true')
    drag(cardOf(el, 'Locked'), day(el, '2026-12-09'))
    expect(write).not.toHaveBeenCalled()
  })
})

describe('calendar "+" on a day (YAZ-4540 S10) and "Show by"', () => {
  it('"+" on a day makes a new page with that date', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Untitled.md'))
    const { el, onOpenFile } = mount(CALENDAR, { folder: testFolderHost({ create }) })
    click(q(day(el, '2026-12-09'), '[aria-label="New page on 2026-12-09"]'))
    await flush()
    expect(create).toHaveBeenCalledExactlyOnceWith({ properties: { due: '2026-12-09' } }, undefined)
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Untitled.md')
  })

  it('"Show by" lists the date columns and saves the choice; it sits in the view settings, not on the toolbar (YAZ-3746 13AD)', () => {
    const records = [...RECORDS, rec('Started', { start: '2026-12-21', due: '2026-12-01' })]
    const { el, yaml } = mount(CALENDAR, { records })
    expect(el.querySelector('.view-toolbar [aria-label="Start date"]')).toBeNull()
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]')) // the View tab (YAZ-4607 D59)
    const select = q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="Start date"]')
    expect([...select.options].map((o) => o.value)).toEqual(['note.due', 'note.start'])
    act(() => {
      select.value = 'note.start'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    draw()
    expect(yaml()).toContain('dateProperty: note.start')
    expect(titlesIn(day(el, '2026-12-21'))).toEqual(['Started'])
  })

  it('Sort and group offers Sort only, and its badge counts no group level the calendar ignores', () => {
    const { el } = mount(`${CALENDAR}    sort:\n      - property: note.due\n        direction: ASC\n    groupBy:\n      property: note.due\n`)
    expect(q(el, '.view-toolbar [aria-label="Sort"] .view-toolbar__badge').textContent).toBe('1')
    click(q(el, '.view-toolbar [aria-label="Sort"]'))
    const pop = q(el, '.view-popover--sort')
    expect(pop.querySelector('[aria-label="Sort property"]')).not.toBeNull()
    expect([...pop.querySelectorAll('.view-menu__label')].map((l) => l.textContent)).not.toContain('Group by')
    expect(pop.querySelector('[aria-label="Group indent"], [aria-label^="Reorder group level"]')).toBeNull()
  })

  it('Properties has a "Dates" section (YAZ-4864) with the same "Show by"', () => {
    const { el } = mount(CALENDAR)
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]')) // the View tab (YAZ-4607 D59)
    const pop = q(el, '.view-popover--properties')
    expect([...pop.querySelectorAll('.view-menu__label')].map((l) => l.textContent)).toEqual(['Rows', 'Dates', 'Layout', 'Lines', 'Cross out'])
    expect(q<HTMLSelectElement>(pop, '[aria-label="Start date"]').value).toBe('note.due')
  })
})

describe('Back returns to the view tab it left (YAZ-4544, finding 24)', () => {
  const TWO = `views:
  - type: table
    name: Table
  - type: calendar
    name: Calendar
`
  const activeTab = (el: ParentNode) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent
  const remount = (props: Partial<ViewsPaneProps>) => {
    act(() => root?.unmount())
    container?.remove()
    return mount(TWO, props)
  }

  it('"+" on a calendar day opens the new page; the folder page that mounts again on that Back step shows the Calendar', async () => {
    const create = vi.fn(async () => '/vault/Tasks/Untitled.md')
    const { el, onOpenFile } = mount(TWO, { viewKey: 'step-1', folder: testFolderHost({ create }) })
    expect(activeTab(el)).toBe('Table')
    act(() => [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'Calendar')!.click())
    draw()
    await act(async () => q<HTMLButtonElement>(el, '[aria-label="New page on 2026-12-03"]').click())
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Tasks/Untitled.md')
    // The tab moves on to the page: this page unmounts. Back mounts it again under the same step.
    expect(activeTab(remount({ viewKey: 'step-1' }).el)).toBe('Calendar')
    // A new step (the folder opened again from the sidebar) starts on the saved start, as before.
    expect(activeTab(remount({ viewKey: 'step-2' }).el)).toBe('Table')
    // With no step (the right panel), nothing is remembered.
    expect(activeTab(remount({}).el)).toBe('Table')
  })
})

describe('the "No date" tray is bounded (YAZ-4544, finding 5)', () => {
  it('shows the first 20 cards and "+N more", which shows all of them', () => {
    const undated = Array.from({ length: 25 }, (_, i) => rec(`U${String(i).padStart(2, '0')}`, {}))
    const { el } = mount(CALENDAR, { records: [rec('Dated', { due: '2026-12-03' }), ...undated] })
    const tray = q<HTMLElement>(el, '[aria-label="No date"]')
    expect(q(tray, '.view-cal__tray-count').textContent).toBe('25')
    expect(titlesIn(tray)).toEqual(undated.slice(0, 20).map((r) => r.title))
    act(() => q<HTMLButtonElement>(tray, '.view-cal__more').click())
    expect(titlesIn(tray)).toHaveLength(25)
    expect(q(tray, '.view-cal__more').textContent).toBe('Show less')
    act(() => q<HTMLButtonElement>(tray, '.view-cal__more').click())
    expect(titlesIn(tray)).toHaveLength(20)
    expect(q(tray, '.view-cal__more').textContent).toBe('+5 more')
  })
})

describe('"Show by" works out the date columns once (YAZ-4544, finding 9)', () => {
  it('one dateColumns run for a render, with the calendar and "Show by" in Properties (off the toolbar since YAZ-3746 13AD)', () => {
    const { el } = mount(CALENDAR)
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]')) // the View tab (YAZ-4607 D59)
    expect(document.querySelectorAll('[aria-label="Start date"]')).toHaveLength(1)
    vi.mocked(dateColumns).mockClear()
    // New records (an index refetch): one run, not one for each "Show by" too.
    act(() => root?.render(<ViewsPane parsed={parseViews(CALENDAR)} onChange={vi.fn()} root="/vault" folderPath="/vault/Tasks" records={[...RECORDS]} folder={testFolderHost()} onOpenFile={vi.fn()} />))
    expect(document.querySelectorAll('[aria-label="Start date"]')).toHaveLength(1)
    expect(vi.mocked(dateColumns)).toHaveBeenCalledTimes(1)
  })
})

describe('calendar week view (YAZ-4558 D22)', () => {
  const WEEK = `${CALENDAR}    calendarScale: week\n`
  const scaleBtn = (el: ParentNode, name: string) => q<HTMLButtonElement>(el, `[aria-label="Calendar scale"] [data-scale="${name}"]`)
  const shownDays = (el: ParentNode) => [...el.querySelectorAll('.view-cal__day')].map((d) => d.getAttribute('data-day'))

  it('the Month / Week switch writes calendarScale: week; Month deletes it (absent = month)', () => {
    const { el, yaml } = mount(CALENDAR)
    expect(scaleBtn(el, 'month').getAttribute('aria-pressed')).toBe('true')
    expect(yaml()).not.toContain('calendarScale')
    click(scaleBtn(el, 'week'))
    expect(yaml()).toContain('calendarScale: week')
    expect(scaleBtn(el, 'week').getAttribute('aria-pressed')).toBe('true')
    expect(shownDays(el)).toEqual(['2026-12-06', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12'])
    click(scaleBtn(el, 'month'))
    expect(yaml()).not.toContain('calendarScale')
    expect(q(el, '.view-cal__month').textContent).toBe('December 2026')
    expect(shownDays(el)).toHaveLength(35)
  })

  it('reads calendarScale: week: Sunday to Saturday of today (the default week start), today ringed, the range as the title', () => {
    const { el } = mount(WEEK)
    expect(q(el, '.view-cal__month').textContent).toBe('Dec 6 – Dec 12, 2026')
    expect(q(el, '.view-cal__grid').getAttribute('aria-label')).toBe('Dec 6 – Dec 12, 2026')
    expect([...el.querySelectorAll('.view-cal__weekday')].map((d) => d.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(day(el, '2026-12-10').getAttribute('aria-current')).toBe('date')
    expect(el.querySelectorAll('.view-cal__day--other')).toHaveLength(0)
    expect(titlesIn(q(el, '.view-cal__tray'))).toEqual(['Nothing'])
  })

  it('‹ and › step one week, across a month and a year; Today comes back', () => {
    const { el } = mount(WEEK)
    click(q(el, '[aria-label="Previous week"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('Nov 29 – Dec 5, 2026')
    expect(shownDays(el)[0]).toBe('2026-11-29')
    // Late zone has a time (23:30Z), so it comes before Bare here; Month keeps the row order.
    expect(titlesIn(day(el, '2026-12-03'))).toEqual(['Late zone', 'Bare'])
    for (let i = 0; i < 4; i++) click(q(el, '[aria-label="Next week"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('Dec 27, 2026 – Jan 2, 2027')
    click(q(el, '[aria-label="Today"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('Dec 6 – Dec 12, 2026')
  })

  it('a day shows every card, no "+N more"; the timed ones first, in time order', () => {
    const records = [
      ...RECORDS,
      rec('Plain 1', { due: '2026-12-08' }),
      rec('Late', { due: '2026-12-08 15:00' }),
      rec('Plain 2', { due: '2026-12-08' }),
      rec('Early', { due: '2026-12-08 09:15' }),
    ]
    const { el } = mount(WEEK, { records })
    expect(titlesIn(day(el, '2026-12-08'))).toEqual(['Early', 'Late', 'Plain 1', 'Plain 2'])
    click(q(el, '[aria-label="Next week"]'))
    expect(titlesIn(day(el, '2026-12-15'))).toEqual(['Busy A', 'Busy B', 'Busy C', 'Busy D', 'Busy E'])
    expect(el.querySelector('.view-cal__grid .view-cal__more')).toBeNull()
  })

  it('a drag to a day writes it and keeps the time; "+" on a day makes a page with that date', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Untitled.md'))
    const { el } = mount(WEEK, { folder: testFolderHost({ create }) })
    click(q(el, '[aria-label="Previous week"]'))
    drag(cardOf(el, 'Timed'), day(el, '2026-12-01'))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Timed.md', 'due', '2026-12-01 10:30')
    expect(titlesIn(day(el, '2026-12-01'))).toEqual(['Timed'])
    await flush()
    click(q(day(el, '2026-12-02'), '[aria-label="New page on 2026-12-02"]'))
    await flush()
    expect(create).toHaveBeenCalledExactlyOnceWith({ properties: { due: '2026-12-02' } }, undefined)
  })

  it('a move in Week says "Moved to" with Undo, as in Month', async () => {
    const onNotice = vi.fn()
    const { el } = mount(WEEK, { folder: testFolderHost({ onNotice }) })
    click(q(el, '[aria-label="Previous week"]'))
    drag(cardOf(el, 'Bare'), day(el, '2026-12-01'))
    await flush()
    expect(onNotice).toHaveBeenCalledWith('Moved to Dec 1, 2026', 'info', 'undo', expect.objectContaining({ label: 'Undo' }))
  })
})

describe('calendar card titles: Clip or Wrap (YAZ-4558 D23)', () => {
  const LONG = 'A very long title that will not fit in one narrow calendar day'
  const records = [...RECORDS, rec(LONG, { due: '2026-12-09' })]
  /** Card titles is a segmented choice since the YAZ-3746 demo: Clip, Wrap. */
  const cardTitles = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.view-popover--properties [role="group"][aria-label="Card titles"] button')]
  const pressedTitles = (el: ParentNode) => cardTitles(el).find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent
  const choose = (el: ParentNode, text: string) => click(cardTitles(el).find((b) => b.textContent === text)!)

  it('Clip by default: one line, and the full title in a tooltip', () => {
    const { el } = mount(CALENDAR, { records })
    const card = cardOf(el, LONG)
    expect(card.classList.contains('view-cal__card--wrap')).toBe(false)
    expect(q(card, '.view-cal__card-title').getAttribute('title')).toBe(LONG)
  })

  it('Properties › Calendar "Card titles" writes cardTitles: wrap; Clip deletes it (absent = clip)', () => {
    const { el, yaml } = mount(CALENDAR, { records })
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
    expect(pressedTitles(el)).toBe('Clip')
    expect(cardTitles(el).map((b) => b.textContent)).toEqual(['Clip', 'Wrap'])
    choose(el, 'Wrap')
    expect(yaml()).toContain('cardTitles: wrap')
    expect(cardOf(el, LONG).classList.contains('view-cal__card--wrap')).toBe(true)
    choose(el, 'Clip')
    expect(yaml()).not.toContain('cardTitles')
    expect(cardOf(el, LONG).classList.contains('view-cal__card--wrap')).toBe(false)
  })

  it('Wrap applies in Month and in Week; a wrapped card needs no tooltip', () => {
    const { el } = mount(`${CALENDAR}    cardTitles: wrap\n`, { records })
    expect(cardOf(el, LONG).classList.contains('view-cal__card--wrap')).toBe(true)
    expect(q(cardOf(el, LONG), '.view-cal__card-title').getAttribute('title')).toBeNull()
    click(q(el, '[aria-label="Calendar scale"] [data-scale="week"]'))
    expect(cardOf(el, LONG).classList.contains('view-cal__card--wrap')).toBe(true)
  })
})

describe('hide weekends (YAZ-4595 S33)', () => {
  const HIDE = `${CALENDAR}    hideWeekends: true\n`
  const records = [...RECORDS, rec('Sunday', { due: '2026-12-06 09:00' })]
  const shownDays = (el: ParentNode) => [...el.querySelectorAll('.view-cal__day')].map((d) => d.getAttribute('data-day'))
  const weekdays = (el: ParentNode) => [...el.querySelectorAll('.view-cal__weekday')].map((d) => d.textContent)
  const mark = (el: ParentNode, title: string) => cardOf(el, title).querySelector('.view-cal__weekend')?.textContent ?? null
  const hideBox = (el: ParentNode) => q<HTMLInputElement>(el, '.view-popover--properties [aria-label="Hide weekends"]')
  /** A Monday week start (the default is Sunday since the YAZ-3746 demo round 2). */
  const mondayFirst = { folderPages: { ...DEFAULT_FOLDER_PAGES, weekStartsOn: 'monday' as const } }
  function toggle(box: HTMLInputElement): void {
    act(() => box.click())
    draw()
  }

  it('Month shows Monday to Friday only; a weekend page sits on the Friday before, marked Sat or Sun', () => {
    const { el } = mount(HIDE, { records })
    expect(weekdays(el)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(shownDays(el)).toHaveLength(25)
    expect(el.querySelector('[data-day="2026-12-05"]')).toBeNull()
    expect(el.querySelector('[data-day="2026-12-06"]')).toBeNull()
    expect(q(el, '.view-cal__grid').classList.contains('view-cal__grid--weekdays')).toBe(true)
    // Friday Dec 4: its own card first, then Saturday's, then Sunday's.
    expect(titlesIn(day(el, '2026-12-04'))).toEqual(['Timed', 'Locked', 'Sunday'])
    expect(mark(el, 'Locked')).toBe('Sat')
    expect(mark(el, 'Sunday')).toBe('Sun')
    expect(mark(el, 'Timed')).toBeNull()
  })

  it('a Sunday week start (YAZ-4585) still shows Monday to Friday, in Month and in Week', () => {
    const { el } = mount(HIDE, { records, folderPages: { ...DEFAULT_FOLDER_PAGES, weekStartsOn: 'sunday' } })
    expect(weekdays(el)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(el.querySelector('[data-day="2026-12-06"]')).toBeNull()
    expect(titlesIn(day(el, '2026-12-04'))).toEqual(['Timed', 'Locked', 'Sunday'])
    click(q(el, '[aria-label="Calendar scale"] [data-scale="week"]'))
    expect(weekdays(el)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  })

  it('Week shows Monday to Friday of the week (Monday first)', () => {
    const { el } = mount(`${HIDE}    calendarScale: week\n`, { records, ...mondayFirst })
    expect(weekdays(el)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(shownDays(el)).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'])
    click(q(el, '[aria-label="Previous week"]'))
    expect(titlesIn(day(el, '2026-12-04'))).toEqual(['Timed', 'Locked', 'Sunday'])
    expect(mark(el, 'Sunday')).toBe('Sun')
  })

  it('a weekend card dropped on its Friday keeps its date; dropped on another day it moves there and keeps its time', () => {
    const { el } = mount(HIDE, { records })
    drag(cardOf(el, 'Sunday'), day(el, '2026-12-04'))
    expect(write).not.toHaveBeenCalled()
    drag(cardOf(el, 'Sunday'), day(el, '2026-12-02'))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Sunday.md', 'due', '2026-12-02 09:00')
    expect(mark(el, 'Sunday')).toBeNull()
  })

  // One rule for the grid and the mini window's order (YAZ-4635 P3): a Saturday goes to the Friday before; a Sunday too, unless
  // that Friday is off the grid — then to the Monday after. Before, the first Sunday of a Sunday-first grid showed nowhere.
  describe('every weekend card lands on a shown weekday (YAZ-4635 P3)', () => {
    // November 2026 starts on a Sunday. Nov 8 is the Sunday of the week that holds the 10th.
    const november = [rec('First Sunday', { due: '2026-11-01' }), rec('Saturday', { due: '2026-11-07' }), rec('Sunday', { due: '2026-11-08 09:00' }), rec('Weekday', { due: '2026-11-09' })]
    beforeEach(() => vi.setSystemTime(new Date(2026, 10, 10, 12, 0)))
    const sunday = { ...DEFAULT_FOLDER_PAGES, weekStartsOn: 'sunday' as const }

    it('Month, Sunday first: the grid\'s first Sunday goes to the Monday after it, marked Sun; the other weekend cards to their Friday', () => {
      const { el } = mount(HIDE, { records: november, folderPages: sunday })
      expect(shownDays(el)[0]).toBe('2026-11-02')
      expect(titlesIn(day(el, '2026-11-02'))).toEqual(['First Sunday'])
      expect(mark(el, 'First Sunday')).toBe('Sun')
      expect(titlesIn(day(el, '2026-11-06'))).toEqual(['Saturday', 'Sunday'])
      expect(titlesIn(q(el, '.view-cal__tray'))).toEqual([])
      // A drop on its Monday is a drop on its own day: no write.
      drag(cardOf(el, 'First Sunday'), day(el, '2026-11-02'))
      expect(write).not.toHaveBeenCalled()
    })

    it('Month, Monday first: the same Sunday goes to the Friday before it, on the grid\'s first row', () => {
      const { el } = mount(HIDE, { records: november, ...mondayFirst })
      expect(titlesIn(day(el, '2026-10-30'))).toEqual(['First Sunday'])
      expect(mark(el, 'First Sunday')).toBe('Sun')
      expect(titlesIn(day(el, '2026-11-06'))).toEqual(['Saturday', 'Sunday'])
    })

    it('Week, Sunday first: the Sunday goes to Monday and the Saturday to Friday; Monday first, both to Friday', () => {
      const { el } = mount(`${HIDE}    calendarScale: week\n`, { records: november, folderPages: sunday })
      expect(shownDays(el)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
      expect(titlesIn(day(el, '2026-11-09'))).toEqual(['Weekday', 'Sunday'])
      expect(mark(el, 'Sunday')).toBe('Sun')
      // Nov 14 is a Saturday with no card; its Friday the 13th shows nothing.
      expect(titlesIn(day(el, '2026-11-13'))).toEqual([])
      act(() => root?.unmount())
      container?.remove()
      const monday = mount(`${HIDE}    calendarScale: week\n`, { records: november, ...mondayFirst })
      expect(titlesIn(day(monday.el, '2026-11-09'))).toEqual(['Weekday'])
      click(q(monday.el, '[aria-label="Previous week"]'))
      expect(titlesIn(day(monday.el, '2026-11-06'))).toEqual(['Saturday', 'Sunday'])
    })
  })

  it('off by default: the full week shows and no card wears a mark', () => {
    const { el } = mount(CALENDAR, { records })
    expect(weekdays(el)).toHaveLength(7)
    expect(titlesIn(day(el, '2026-12-05'))).toEqual(['Locked'])
    expect(el.querySelector('.view-cal__weekend')).toBeNull()
  })

  it('Properties › Calendar "Hide weekends" writes hideWeekends: true; off removes the key (the default is off)', () => {
    const { el, yaml } = mount(CALENDAR, { records })
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
    expect(hideBox(el).checked).toBe(false)
    toggle(hideBox(el))
    expect(yaml()).toContain('hideWeekends: true')
    expect(weekdays(el)).toHaveLength(5)
    toggle(hideBox(el))
    expect(yaml()).not.toContain('hideWeekends')
    expect(weekdays(el)).toHaveLength(7)
  })

  it('the Settings default hides them on a view with no key; the view turns it off with hideWeekends: false', () => {
    // Settings › Folder pages reaches the pane as its `folderPages` prop (YAZ-4585), live.
    const { el, yaml } = mount(CALENDAR, { records, folderPages: { ...DEFAULT_FOLDER_PAGES, hideWeekends: true } })
    expect(weekdays(el)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
    expect(hideBox(el).checked).toBe(true)
    toggle(hideBox(el))
    expect(yaml()).toContain('hideWeekends: false')
    expect(weekdays(el)).toHaveLength(7)
    // Back to the default: the key goes.
    toggle(hideBox(el))
    expect(yaml()).not.toContain('hideWeekends')
    expect(weekdays(el)).toHaveLength(5)
  })
})

describe('the shown columns on a card (YAZ-4857)', () => {
  const records = [...RECORDS, rec('Styled', { due: '2026-12-08 09:00', status: 'Done', priority: 2, owner: 'Sam' }), rec('Sparse', { due: '2026-12-08' })]
  const SHOWN = (cardStyle = '') => `views:
  - type: calendar
    name: C
    order:
      - file.name
      - note.due
      - note.status
      - note.priority
      - note.owner
${cardStyle === '' ? '' : `    cardStyle:\n${cardStyle}\n`}`
  const linesOf = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>('.view-board__line')]
  const propsOf = (card: HTMLElement) => [...card.querySelectorAll('.view-board__prop')].map((p) => p.textContent)
  const openColumns = (el: ParentNode) => {
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    const pop = q<HTMLElement>(el, '.view-popover--properties')
    const columnsTab = pop.querySelector<HTMLElement>('.view-menu__tab[data-tab="columns"]')
    if (columnsTab !== null) click(columnsTab)
    return q<HTMLElement>(el, '.view-popover--properties')
  }

  it('a calendar with no column choice shows the name alone, and the panel says "Shown · 1" (item 4)', () => {
    const { el } = mount(CALENDAR, { records })
    expect(linesOf(cardOf(el, 'Styled'))).toHaveLength(1)
    expect(cardOf(el, 'Styled').querySelector('.view-board__prop')).toBeNull()
    const pop = openColumns(el)
    expect(pop.textContent).toContain('Shown · 1')
  })

  it('a switched-on column shows on the cards: one write of the order, name first', () => {
    // Status is a column of the page, so the panel lists it with a switch (YAZ-4713 C4).
    const folder = testFolderHost({ settings: { columns: { status: { kind: 'text' } }, views: [], problems: [] } })
    const { el, yaml } = mount(CALENDAR, { records, folder })
    const pop = openColumns(el)
    expect(pop.textContent).toContain('Shown · 1')
    act(() => q<HTMLInputElement>(pop, 'input[aria-label="Show Status"]').click())
    draw()
    expect(yaml()).toContain('order:\n      - file.name\n      - note.status')
    expect(propsOf(cardOf(el, 'Styled'))).toEqual(['StatusDone'])
  })

  it('the shown columns are the board\'s lines: the date column is not drawn, and an empty value or line is left out (items 1–3)', () => {
    const { el } = mount(SHOWN(), { records })
    const styled = cardOf(el, 'Styled')
    // The name's line (time, title), then Status, Priority, Owner: no Due line, the card sits on that date.
    expect(linesOf(styled)).toHaveLength(4)
    expect(q(linesOf(styled)[0], '.view-cal__time').textContent).toBe('09:00')
    expect(propsOf(styled)).toEqual(['StatusDone', 'Priority2', 'OwnerSam'])
    // A card with none of them is the name's line alone.
    expect(linesOf(cardOf(el, 'Sparse'))).toHaveLength(1)
  })

  it('bold, underline, hide label and join work as on the board; a join onto the name sits on the name\'s line', () => {
    const style = '      note.status: { join: true, bold: true }\n      note.priority: { hideLabel: true, underline: true }\n      note.owner: { join: true }'
    const { el } = mount(SHOWN(style), { records })
    const lines = linesOf(cardOf(el, 'Styled'))
    expect(lines).toHaveLength(2)
    expect([...lines[0].children].map((k) => k.className.split(' ')[0])).toEqual(['view-cal__time', 'view-cal__card-title', 'view-board__dash', 'view-board__prop'])
    expect(q(lines[0], '.view-board__prop').classList.contains('view-board__prop--bold')).toBe(true)
    // Priority starts its own line with no label; Owner joins it.
    const second = [...lines[1].querySelectorAll('.view-board__prop')]
    expect(second[0].querySelector('.view-board__prop-name')).toBeNull()
    expect(second[0].classList.contains('view-board__prop--underline')).toBe(true)
    expect(second.map((p) => p.textContent)).toEqual(['2', 'OwnerSam'])
    expect(lines[1].querySelector('.view-board__dash')).not.toBeNull()
  })

  it('the name keeps its place in the order: a column before it is a line above it', () => {
    const { el } = mount(`views:\n  - type: calendar\n    name: C\n    order:\n      - note.status\n      - file.name\n`, { records })
    const lines = linesOf(cardOf(el, 'Styled'))
    expect(lines.map((l) => l.classList.contains('view-cal__card-head'))).toEqual([false, true])
  })

  it('an order with no name still draws the title first', () => {
    const { el } = mount(`views:\n  - type: calendar\n    name: C\n    order:\n      - note.status\n`, { records })
    const lines = linesOf(cardOf(el, 'Styled'))
    expect(lines.map((l) => l.classList.contains('view-cal__card-head'))).toEqual([true, false])
  })

  it('the column panel\'s card styling opens for a calendar view, and writes cardStyle', () => {
    const { el, yaml } = mount(SHOWN(), { records })
    const pop = openColumns(el)
    click(q(pop, '[aria-label="Open Status"]'))
    click(q(pop, '[aria-label="Bold Status on cards"]'))
    expect(yaml()).toContain("note.status:\n        bold: true")
    expect(q(cardOf(el, 'Styled'), '.view-board__prop').classList.contains('view-board__prop--bold')).toBe(true)
  })

  it('a failed move still flags the card under its name\'s line', async () => {
    write.mockRejectedValueOnce(new Error('disk full'))
    const { el } = mount(SHOWN(), { records })
    drag(cardOf(el, 'Styled'), day(el, '2026-12-09'))
    await flush()
    const card = cardOf(el, 'Styled')
    expect(card.querySelector('[role="alert"]')?.previousElementSibling?.classList.contains('view-cal__card-head')).toBe(true)
  })
})

describe('"Cross out when" (YAZ-4864)', () => {
  const records = [...RECORDS, rec('Done task', { due: '2026-12-08', done: true, status: 'Done' }), rec('Open task', { due: '2026-12-08', done: false, status: 'Doing' })]
  const CROSS = (cond: string) => `views:\n  - type: calendar\n    name: C\n    crossOut:\n      and:\n        - ${cond}\n`
  const crossed = (el: ParentNode) => [...el.querySelectorAll('.view-cal__card--crossed')].map((t) => t.querySelector('.view-cal__card-name')?.textContent)
  const openView = (el: ParentNode) => {
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
    return q<HTMLElement>(el, '.view-popover--properties [aria-label="Cross out when"]')
  }

  it('a card whose page matches has its name struck through; the others do not', () => {
    const { el } = mount(CROSS('note.done == true'), { records })
    expect(crossed(el)).toEqual(['Done task'])
    // The whole card is crossed out, its column lines too (YAZ-4864, demo request); a folder row's icon stays outside the name.
    expect(cardOf(el, 'Done task').closest('.view-cal__card')?.classList.contains('view-cal__card--crossed')).toBe(true)
    expect(q(cardOf(el, 'Done task'), '.view-cal__card-name').textContent).toBe('Done task')
  })

  it('"contains" and Any work as in the Filter menu', () => {
    const { el } = mount(`views:\n  - type: calendar\n    name: C\n    crossOut:\n      or:\n        - note.status.contains("Doi")\n        - file.name == "Bare"\n`, { records })
    expect(crossed(el).sort()).toEqual(['Bare', 'Open task'])
  })

  it('a broken condition crosses out nothing and says so in the foot line', () => {
    const { el } = mount(CROSS('note.done =='), { records })
    expect(crossed(el)).toEqual([])
    expect(el.textContent).toContain('views[0].crossOut')
  })

  it('the View tab has the Filter menu\'s rows; a new condition is "is checked" on the first checkbox column', () => {
    const { el, yaml } = mount(CALENDAR, { records })
    const section = openView(el)
    expect(section.textContent).toContain('No conditions. No card is crossed out.')
    click(byText(section, 'button', 'Add rule'))
    expect(yaml()).toContain('crossOut:\n      and:\n        - note.done == true')
    expect(crossed(el)).toEqual(['Done task'])
    expect(q<HTMLSelectElement>(section, '[aria-label="Operator"]').value).toBe('checked')
    click(q(section, '[aria-label="Remove rule"]'))
    expect(yaml()).not.toContain('crossOut')
    expect(crossed(el)).toEqual([])
  })

  it('with no checkbox column a new condition matches no card until it has a value', () => {
    const { el, yaml } = mount(CALENDAR)
    const section = openView(el)
    click(byText(section, 'button', 'Add rule'))
    expect(yaml()).toContain('- file.name == ""')
    expect(el.querySelectorAll('.view-cal__card--crossed')).toHaveLength(0)
  })

  it('the Filter menu keeps its own rows: a filter is not a cross-out', () => {
    const { el, yaml } = mount(CROSS('note.done == true'), { records })
    click(q(el, '.view-toolbar [aria-label="Filter"]'))
    expect(q(el, '.view-popover--filter').textContent).toContain('No filters')
    expect(yaml()).toContain('crossOut')
  })
})

describe('cards over several days (YAZ-4858)', () => {
  const writeMany = vi.mocked(writeProperties)
  beforeEach(() => {
    writeMany.mockReset()
    writeMany.mockResolvedValue({ mtime: 1 })
  })
  const SPAN = `views:\n  - type: calendar\n    name: C\n    endDateProperty: note.end\n`
  const records = [
    ...RECORDS,
    rec('Trip', { due: '2026-12-08 09:00', end: '2026-12-10' }),
    rec('Weekend', { due: '2026-12-11', end: '2026-12-14' }),
    rec('Ends only', { end: '2026-12-17' }),
    rec('One day', { due: '2026-12-22' }),
  ]
  const barsOf = (el: ParentNode, title: string) => [...el.querySelectorAll<HTMLElement>('.view-cal__bar')].filter((b) => b.querySelector('.view-cal__card-name')?.textContent === title)
  const mouse = (target: EventTarget, type: string, init: MouseEventInit = {}) => {
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })))
    draw()
  }
  /** An edge drag: the press on the edge, a move onto each day in turn (the hit test points at that day), then the release. */
  const stretch = (card: HTMLElement, edge: 'start' | 'end', ...to: HTMLElement[]) => {
    const at = vi.spyOn(document, 'elementFromPoint')
    mouse(q(card, `.view-cal__edge--${edge}`), 'mousedown')
    for (const target of to) {
      at.mockReturnValue(target)
      mouse(window, 'mousemove', { clientX: 1, clientY: 1 })
    }
    return {
      release: () => {
        mouse(window, 'mouseup')
        at.mockRestore()
      },
      escape: () => {
        act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
        draw()
        at.mockRestore()
      },
    }
  }

  it('a card that ends after its start is one bar over its days, in the week row, not in a day', () => {
    const { el } = mount(SPAN, { records })
    const [bar] = barsOf(el, 'Trip')
    expect(bar.dataset.barDays).toBe('2026-12-08 2026-12-09 2026-12-10')
    // Sunday first: Tuesday is the 3rd column; the bar's lane is the first row after the day heads.
    expect(bar.style.gridColumn).toBe('3 / span 3')
    expect(bar.style.gridRow).toBe('2')
    expect(titlesIn(day(el, '2026-12-08'))).toEqual([])
    expect(q(bar, '.view-cal__time').textContent).toBe('09:00')
  })

  it('at the week\'s edge the bar goes on in the next row, with cut ends that have no edge', () => {
    const { el } = mount(SPAN, { records })
    const pieces = barsOf(el, 'Weekend')
    expect(pieces.map((b) => b.dataset.barDays)).toEqual(['2026-12-11 2026-12-12', '2026-12-13 2026-12-14'])
    expect(pieces[0].classList.contains('view-cal__bar--cut-end')).toBe(true)
    expect(pieces[0].querySelector('.view-cal__edge--end')).toBeNull()
    expect(pieces[0].querySelector('.view-cal__edge--start')).not.toBeNull()
    expect(pieces[1].classList.contains('view-cal__bar--cut-start')).toBe(true)
    expect(pieces[1].querySelector('.view-cal__edge--start')).toBeNull()
  })

  it('a page with an end and no start goes on its end day (item 5); with no End date chosen, every card is on its start', () => {
    const { el } = mount(SPAN, { records })
    expect(titlesIn(day(el, '2026-12-17'))).toEqual(['Ends only'])
    act(() => root?.unmount())
    container?.remove()
    const plain = mount(CALENDAR, { records })
    expect(plain.el.querySelector('.view-cal__bar')).toBeNull()
    expect(titlesIn(day(plain.el, '2026-12-08'))).toEqual(['Trip'])
    expect(titlesIn(q(plain.el, '.view-cal__tray'))).toContain('Ends only')
  })

  it('Month: the bars on a day count in its 3 cards, and "+N more" counts the rest; Week shows them all', () => {
    const many = [...RECORDS, ...['W', 'X', 'Y', 'Z'].map((n) => rec(`Span ${n}`, { due: '2026-12-14', end: '2026-12-16' }))]
    const { el } = mount(SPAN, { records: many })
    // Four bars over Dec 14–16 in four lanes: Month shows three, so Dec 15 shows no one-day card and "+6 more" (5 cards, 1 bar).
    expect(el.querySelectorAll('.view-cal__bar')).toHaveLength(3)
    expect(titlesIn(day(el, '2026-12-15'))).toEqual([])
    expect(q(day(el, '2026-12-15'), '.view-cal__more').textContent).toBe('+6 more')
    click(q(day(el, '2026-12-15'), '.view-cal__more'))
    expect(el.querySelectorAll('.view-cal__bar')).toHaveLength(4)
    expect(titlesIn(day(el, '2026-12-15'))).toHaveLength(5)
    expect(q(day(el, '2026-12-15'), '.view-cal__more').textContent).toBe('Show less')
    // One bar on a day leaves room for two cards.
    act(() => root?.unmount())
    container?.remove()
    const one = mount(SPAN, { records: [...RECORDS, rec('Span', { due: '2026-12-14', end: '2026-12-16' })] })
    expect(titlesIn(day(one.el, '2026-12-15'))).toHaveLength(2)
    expect(q(day(one.el, '2026-12-15'), '.view-cal__more').textContent).toBe('+3 more')
    act(() => root?.unmount())
    container?.remove()
    const week = mount(`${SPAN}    calendarScale: week\n`, { records: many })
    click(q(week.el, '[aria-label="Next week"]'))
    expect(week.el.querySelectorAll('.view-cal__bar')).toHaveLength(4)
    expect(titlesIn(day(week.el, '2026-12-15'))).toHaveLength(5)
  })

  it('a drag of the whole bar moves both dates by the same days, in one write, each keeping its time', () => {
    const onNotice = vi.fn()
    const { el } = mount(SPAN, { records, folder: testFolderHost({ onNotice }) })
    // Taken on its first day (jsdom has no layout), dropped two days later.
    drag(barsOf(el, 'Trip')[0], day(el, '2026-12-10'))
    expect(writeMany).toHaveBeenCalledExactlyOnceWith('/vault/Trip.md', [
      { key: 'due', value: '2026-12-10 09:00', prevRaw: '2026-12-08 09:00' },
      { key: 'end', value: '2026-12-12', prevRaw: '2026-12-10' },
    ])
    expect(barsOf(el, 'Trip')[0].dataset.barDays).toBe('2026-12-10 2026-12-11 2026-12-12')
  })

  it('a drop on "No date" clears both dates; a one-day card with no end moves as before', () => {
    const { el } = mount(SPAN, { records })
    drag(barsOf(el, 'Trip')[0], q(el, '.view-cal__tray'))
    expect(writeMany).toHaveBeenCalledExactlyOnceWith('/vault/Trip.md', [
      { key: 'due', value: undefined, prevRaw: '2026-12-08 09:00' },
      { key: 'end', value: undefined, prevRaw: '2026-12-10' },
    ])
    drag(cardOf(el, 'One day'), day(el, '2026-12-23'))
    expect(write).toHaveBeenLastCalledWith('/vault/One day.md', 'due', '2026-12-23')
  })

  it('the right edge stretches a one-day card a day per step; the release writes once, with the move\'s toast', () => {
    const onNotice = vi.fn()
    const { el } = mount(SPAN, { records, folder: testFolderHost({ onNotice }) })
    const s = stretch(cardOf(el, 'One day'), 'end', day(el, '2026-12-23'), day(el, '2026-12-24'))
    // The card shows its new days while the pointer goes; nothing is written yet.
    expect(barsOf(el, 'One day')[0].dataset.barDays).toBe('2026-12-22 2026-12-23 2026-12-24')
    expect(write).not.toHaveBeenCalled()
    s.release()
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/One day.md', 'end', '2026-12-24')
  })

  it('the left edge moves the start and keeps its time; on a one-day card the old day becomes the end', () => {
    const { el } = mount(SPAN, { records })
    stretch(barsOf(el, 'Trip')[0], 'start', day(el, '2026-12-06')).release()
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Trip.md', 'due', '2026-12-06 09:00')
    stretch(cardOf(el, 'One day'), 'start', day(el, '2026-12-20')).release()
    expect(writeMany).toHaveBeenCalledExactlyOnceWith('/vault/One day.md', [
      { key: 'due', value: '2026-12-20', prevRaw: '2026-12-22' },
      { key: 'end', value: '2026-12-22', prevRaw: undefined },
    ])
  })

  it('the edges stop at each other: the end is never before the start', () => {
    const { el } = mount(SPAN, { records })
    stretch(barsOf(el, 'Trip')[0], 'end', day(el, '2026-12-05')).release()
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Trip.md', 'end', '2026-12-08')
  })

  it('Escape stops an edge drag and writes nothing; the press never starts the card\'s own drag', () => {
    const { el } = mount(SPAN, { records })
    const edge = q(cardOf(el, 'One day'), '.view-cal__edge--end')
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    const at = vi.spyOn(document, 'elementFromPoint').mockReturnValue(day(el, '2026-12-25'))
    act(() => void edge.dispatchEvent(press))
    expect(press.defaultPrevented).toBe(true)
    mouse(window, 'mousemove', { clientX: 1, clientY: 1 })
    expect(barsOf(el, 'One day')).toHaveLength(1)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    draw()
    at.mockRestore()
    mouse(window, 'mouseup')
    expect(write).not.toHaveBeenCalled()
    expect(writeMany).not.toHaveBeenCalled()
    expect(titlesIn(day(el, '2026-12-22'))).toEqual(['One day'])
  })

  it('a read-only page has no edges', () => {
    const { el } = mount(SPAN, { records, readOnly: new Set(['/vault/Trip.md']) })
    expect(barsOf(el, 'Trip')[0].querySelector('.view-cal__edge')).toBeNull()
    expect(cardOf(el, 'Bare').querySelector('.view-cal__edge')).not.toBeNull()
  })

  it('no End date column: an edge press shows the message, and "Choose End date" picks one; nothing is written before', () => {
    const withStart = [...records, rec('Started', { start: '2026-12-21' })]
    const { el, yaml } = mount(CALENDAR, { records: withStart })
    mouse(q(cardOf(el, 'Bare'), '.view-cal__edge--end'), 'mousedown')
    const ask = q<HTMLElement>(document, '.view-cal__end-ask')
    expect(ask.textContent).toContain('To stretch a card over days, choose an End date column.')
    expect(write).not.toHaveBeenCalled()
    click(byText(ask, 'button', 'Choose End date'))
    const select = q<HTMLSelectElement>(document, '.view-cal__end-ask [aria-label="End date"]')
    expect([...select.options].map((o) => o.value)).toEqual(['', 'note.end', 'note.start'])
    act(() => {
      select.value = 'note.start'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    draw()
    expect(yaml()).toContain('endDateProperty: note.start')
    expect(document.querySelector('.view-cal__end-ask')).toBeNull()
  })

  it('no other date column: "Add a date column" makes one only on that click, and Escape closes the message', () => {
    const setColumns = vi.fn()
    const { el } = mount(CALENDAR, { folder: testFolderHost({ setColumns }) })
    mouse(q(cardOf(el, 'Bare'), '.view-cal__edge--start'), 'mousedown')
    expect(q(document, '.view-cal__end-ask').textContent).not.toContain('Choose End date')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    draw()
    expect(document.querySelector('.view-cal__end-ask')).toBeNull()
    expect(setColumns).not.toHaveBeenCalled()
    mouse(q(cardOf(el, 'Bare'), '.view-cal__edge--start'), 'mousedown')
    click(byText(q(document, '.view-cal__end-ask'), 'button', 'Add a date column'))
    expect(setColumns).toHaveBeenCalledExactlyOnceWith({ 'End date': { kind: 'date' } }, [expect.objectContaining({ type: 'calendar', endDateProperty: 'note.End date' })])
    expect(write).not.toHaveBeenCalled()
  })

  it('the View tab: Start date, then End date with None first; a choice writes endDateProperty and None deletes it', () => {
    const withStart = [...records, rec('Started', { start: '2026-12-21' })]
    const { el, yaml } = mount(CALENDAR, { records: withStart })
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
    const end = q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="End date"]')
    expect([...end.options].map((o) => o.textContent)).toEqual(['None', 'End', 'Start'])
    const choose = (value: string) => {
      act(() => {
        end.value = value
        end.dispatchEvent(new Event('change', { bubbles: true }))
      })
      draw()
    }
    choose('note.end')
    expect(yaml()).toContain('endDateProperty: note.end')
    expect(barsOf(el, 'Trip')).toHaveLength(1)
    choose('')
    expect(yaml()).not.toContain('endDateProperty')
    expect(el.querySelector('.view-cal__bar')).toBeNull()
  })

  it('counts: a dragover buckets nothing again; an edge drag buckets once per day it reaches, not per mouse move', () => {
    // One host for every draw, as the app's: a new host each draw would be a new folder, and new rows.
    const { el } = mount(SPAN, { records, folder: testFolderHost() })
    const bucket = vi.mocked(bucketByDay)
    bucket.mockClear()
    fire(cardOf(el, 'One day'), 'dragstart')
    for (const key of ['2026-12-09', '2026-12-10', '2026-12-11']) fire(day(el, key), 'dragover')
    fire(cardOf(el, 'One day'), 'dragend')
    expect(bucket).not.toHaveBeenCalled()
    const at = vi.spyOn(document, 'elementFromPoint')
    mouse(q(cardOf(el, 'One day'), '.view-cal__edge--end'), 'mousedown')
    const start = bucket.mock.calls.length
    for (const key of ['2026-12-23', '2026-12-23', '2026-12-23', '2026-12-24', '2026-12-24']) {
      at.mockReturnValue(day(el, key))
      mouse(window, 'mousemove', { clientX: 1, clientY: 1 })
    }
    expect(bucket.mock.calls.length - start).toBe(2)
    mouse(window, 'mouseup')
    at.mockRestore()
  })

  it('hide weekends: a bar over Saturday and Sunday alone is a one-day card on the Friday, marked Sat', () => {
    const { el } = mount(`${SPAN}    hideWeekends: true\n`, { records: [...RECORDS, rec('Away', { due: '2026-12-12', end: '2026-12-13' })] })
    expect(el.querySelector('.view-cal__bar')).toBeNull()
    expect(titlesIn(day(el, '2026-12-11'))).toContain('Away')
    expect(cardOf(el, 'Away').querySelector('.view-cal__weekend')?.textContent).toBe('Sat')
  })
})

describe('the grid lines (YAZ-4878)', () => {
  const grid = (el: ParentNode) => q<HTMLElement>(el, '.view-cal__grid')
  const seg = (el: ParentNode, label: string) => el.querySelector<HTMLElement>(`.view-popover--properties [role="group"][aria-label="${label}"]`)
  const openView = (el: ParentNode) => {
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
  }

  it('1 px each, the default, sets nothing; a view`s own widths reach the grid, thicker and darker', () => {
    expect(grid(mount(CALENDAR).el).style.getPropertyValue('--cal-week-line')).toBe('')
    act(() => root?.unmount())
    container?.remove()
    const g = grid(mount(`${CALENDAR}    weekLine: 3\n    dayLine: 2\n`).el)
    expect(g.style.getPropertyValue('--cal-week-line')).toBe('3px')
    expect(g.style.getPropertyValue('--cal-day-line')).toBe('2px')
    expect(g.style.getPropertyValue('--cal-week-line-color')).not.toBe('')
  })

  it('a stored width out of 1–12 reads as 1 px', () => {
    expect(grid(mount(`${CALENDAR}    weekLine: 40\n    dayLine: 0\n`).el).style.getPropertyValue('--cal-week-line')).toBe('')
  })

  /** A line row's dropdown (the "Thickness ▾" or the colour dot) opened, then `text`'s item in it pressed. */
  const trigger = (el: ParentNode, label: string) => q<HTMLButtonElement>(el, `.view-popover--properties [aria-label="${label}"]`)
  // The dropdown is on the body (`portal`), not in the tab.
  const panel = (_el: ParentNode, label: string) => q<HTMLElement>(document.body, `.cal-line__panel[aria-label="${label}"]`)
  const pickIn = (el: ParentNode, label: string, text: string) => {
    if (trigger(el, label).getAttribute('aria-expanded') !== 'true') click(trigger(el, label))
    // A swatch has no text: its colour is its `aria-label`.
    click(panel(el, label).querySelector(`button[aria-label="${text}"]`) ?? byText(panel(el, label), 'button', text))
  }

  it('the View tab: "Between weeks" and "Between days" rows with a Thickness ▾; 3 px writes weekLine: 3; 1 px (Settings) removes it; Custom keeps its box inside the dropdown', () => {
    const { el, yaml } = mount(CALENDAR)
    openView(el)
    expect(seg(el, 'Lines between weeks')).toBeNull()
    expect(trigger(el, 'Between weeks thickness').textContent).toBe('1 px')
    expect(trigger(el, 'Between days thickness').textContent).toBe('1 px')
    pickIn(el, 'Between weeks thickness', '3 px')
    expect(yaml()).toContain('weekLine: 3')
    expect(trigger(el, 'Between weeks thickness').textContent).toBe('3 px')
    // The pick closed the dropdown; the ↺ marks the view's own value.
    expect(document.body.querySelector('.cal-line__panel')).toBeNull()
    expect(el.querySelector('.view-popover--properties [aria-label="Reset to Settings"]')).not.toBeNull()
    pickIn(el, 'Between weeks thickness', '1 px')
    expect(yaml()).not.toContain('weekLine')
    pickIn(el, 'Between days thickness', 'Custom…')
    expect(yaml()).toContain('dayLine: 5')
    expect(panel(el, 'Between days thickness').querySelector('[aria-label="Between days in pixels"]')).not.toBeNull()
    expect(trigger(el, 'Between days thickness').textContent).toBe('5 px')
  })

  // Yaseen: "is there a bug or just need to restar thte demo because i cant click this". The View tab's popover fits
  // itself with a `translate` (`constrainToViewport`), so a `position: fixed` child is placed in it and cut by its
  // scroll: the dropdown opened out of sight. It is a child of the body now, and its mousedowns never close the tab.
  it('the dropdown opens on the body, not inside the View tab (whose translate would place and cut it); a press in it keeps the tab open and picks', () => {
    const { el, yaml } = mount(CALENDAR)
    openView(el)
    click(trigger(el, 'Between weeks thickness'))
    const open = document.body.querySelector<HTMLElement>('.cal-line__panel[aria-label="Between weeks thickness"]')
    expect(open).not.toBeNull()
    expect(open!.closest('.view-popover--properties')).toBeNull()
    const item = byText<HTMLButtonElement>(open!, 'button', '2 px')
    act(() => void item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })))
    draw()
    expect(el.querySelector('.view-popover--properties')).not.toBeNull()
    click(item)
    expect(yaml()).toContain('weekLine: 2')
    expect(el.querySelector('.view-popover--properties')).not.toBeNull()
  })

  it('the colour dot: Blue writes weekLineColor: blue and the grid draws it; Strong adds the word; Gray, Medium (Settings) removes the key', () => {
    const { el, yaml } = mount(CALENDAR)
    openView(el)
    pickIn(el, 'Between weeks colour', 'Blue')
    expect(yaml()).toContain('weekLineColor: blue\n')
    expect(grid(el).style.getPropertyValue('--cal-week-line-color')).toContain('--table-fill-solid-blue')
    expect(grid(el).style.getPropertyValue('--cal-day-line-color')).toBe('')
    pickIn(el, 'Between weeks colour', 'Strong')
    expect(yaml()).toContain('weekLineColor: blue strong')
    expect(grid(el).style.getPropertyValue('--cal-week-line-color')).toContain('100%')
    pickIn(el, 'Between weeks colour', 'Gray')
    pickIn(el, 'Between weeks colour', 'Medium')
    expect(yaml()).not.toContain('weekLineColor')
  })

  // YAZ-4898: views.css's rules, read as text, against the real rows. The day-name row is a `.view-cal__week` too.
  const cssRules = [...viewsCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ selector: sel.trim(), body }))
  const weekLineRows = (el: ParentNode) => {
    const rules = cssRules.filter(({ body }) => body.includes('--cal-week-line,'))
    expect(rules.length).toBeGreaterThan(0)
    return [...el.querySelectorAll('.view-cal__week')].filter((row) => rules.some(({ selector }) => row.matches(selector)))
  }
  const dayRows = (el: ParentNode) => [...el.querySelectorAll('.view-cal__week--days')]

  it('YAZ-4898: Month: the week line is only between two day rows, never under the day names (that line stays 1 px)', () => {
    const { el } = mount(`${CALENDAR}    weekLine: 4\n`)
    const rows = dayRows(el)
    expect(rows.length).toBeGreaterThan(3)
    expect(weekLineRows(el)).toEqual(rows.slice(1))
    const under = cssRules.filter(({ selector, body }) => /border-top:/.test(body) && rows[0]!.matches(selector))
    expect(under.map(({ body }) => body.match(/border-top:([^;]+);/)![1]!.trim())).toEqual(['1px solid var(--border)'])
  })

  it('YAZ-4898: Week: "Lines between weeks" acts on no row (one day row, locked item 4 of YAZ-4878)', () => {
    const { el } = mount(`${CALENDAR}    calendarScale: week\n    weekLine: 4\n`)
    expect(dayRows(el)).toHaveLength(1)
    expect(weekLineRows(el)).toEqual([])
  })
})

describe("a card styled by hand (YAZ-4906): \"Card style ›\", the table's Header row panel", () => {
  const menuItem = (text: string) => byText<HTMLButtonElement>(document.body, '.ctx-menu__item', text)
  /** The card's style attributes (`cardStyleAttrs`); the hover's `data-hover-item` is not one. */
  const attrs = (el: ParentNode, title: string) => Object.fromEntries([...cardOf(el, title).attributes].filter((a) => /^data-(color|text|weight)/.test(a.name)).map((a) => [a.name, a.value]))
  const openStyle = (el: ParentNode, title: string) => {
    act(() => void cardOf(el, title).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })))
    draw()
    click(menuItem('Card style'))
  }
  const tab = (name: string) => click(byText(q(document.body, '.ctx-menu__parent [aria-label="Style part"]'), 'button', name))
  const written = () => vi.mocked(writeProperties).mock.calls.at(-1)
  beforeEach(() => vi.mocked(writeProperties).mockReset().mockResolvedValue({ mtime: 1 } as never))
  const undoOn = (card: Element, shift = false) => {
    act(() => void card.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: shift, bubbles: true, cancelable: true })))
    draw()
  }

  it('Fill: Blue writes `color: blue` and the card wears it at once; Light adds the word; Off removes it. The panel stays open', async () => {
    const { el } = mount(CALENDAR)
    expect(attrs(el, 'Bare')).toEqual({})
    openStyle(el, 'Bare')
    expect(byText(document.body, '.fill-target__opt', 'Off').getAttribute('aria-pressed')).toBe('true')
    click(menuItem('Blue'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'color', 'blue')
    expect(attrs(el, 'Bare')).toEqual({ 'data-color': 'blue', 'data-color-strength': 'medium' })
    expect(menuItem('Blue').dataset.hint).toBe('✓')
    click(byText(document.body, '.fill-target__opt', 'Light'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'color', 'blue light')
    await flush()
    click(byText(document.body, '.fill-target__opt', 'Off'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'color', undefined)
    expect(document.body.querySelector('.ctx-menu')).not.toBeNull()
  })

  it('Text › Red writes `text_color: red`, Full removes it; Style › Bold writes `weight: bold`; Plain removes the three in ONE write', async () => {
    const { el } = mount(CALENDAR)
    openStyle(el, 'Bare')
    tab('Text')
    expect(menuItem('Full').dataset.hint).toBe('✓')
    click(menuItem('Red'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'text_color', 'red')
    expect(attrs(el, 'Bare')).toEqual({ 'data-text': 'red' })
    await flush()
    click(menuItem('Full'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'text_color', undefined)
    tab('Style')
    click(menuItem('Bold'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'weight', 'bold')
    expect(attrs(el, 'Bare')).toEqual({ 'data-weight': 'bold' })
    tab('Fill')
    click(menuItem('Green'))
    await flush()
    click(menuItem('Plain, like any card'))
    expect(written()![0]).toBe('/vault/Bare.md')
    // `prevRaw` is what the card shows (YAZ-4834 P3): the undo writes Green and Bold back.
    expect(written()![1]).toEqual([{ key: 'color', value: undefined, prevRaw: 'green' }, { key: 'weight', value: undefined, prevRaw: 'bold' }])
    expect(attrs(el, 'Bare')).toEqual({})
  })

  it('YAZ-4834 P3: two picks of the fill before the index echoes the first: the undo of the second writes the first back, not nothing', async () => {
    const { el } = mount(CALENDAR)
    openStyle(el, 'Bare')
    click(menuItem('Green'))
    click(byText(document.body, '.fill-target__opt', 'Strong'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'color', 'green strong')
    undoOn(cardOf(el, 'Bare'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'color', 'green')
    expect(attrs(el, 'Bare')).toEqual({ 'data-color': 'green', 'data-color-strength': 'medium' })
  })

  it('⌘Z on a card writes the value the page had back, one step per pick; ⇧⌘Z the pick again', async () => {
    const { el } = mount(CALENDAR)
    openStyle(el, 'Bare')
    click(menuItem('Green'))
    await flush()
    tab('Style')
    click(menuItem('Bold'))
    await flush()
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'weight', 'bold')
    undoOn(cardOf(el, 'Bare'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'weight', undefined)
    undoOn(cardOf(el, 'Bare'))
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'color', undefined)
    undoOn(cardOf(el, 'Bare'), true)
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'color', 'green')
  })

  it('a stored style the app reads dresses the card; a crossed-out card keeps it; a value it cannot read gives none; a read-only page has no Card style item', () => {
    const records = [rec('Tinted', { due: '2026-12-03', color: 'Purple strong', text_color: 'White', weight: 'Bold' }), rec('Odd', { due: '2026-12-03', color: 'turquoise', text_color: 'neon', weight: 'heavy' }), rec('Sealed', { due: '2026-12-04', color: 'red' })]
    const { el } = mount(`${CALENDAR}    crossOut:\n      and:\n        - note.weight == "Bold"\n`, { records, readOnly: new Set(['/vault/Sealed.md']) })
    expect(attrs(el, 'Tinted')).toEqual({ 'data-color': 'purple', 'data-color-strength': 'strong', 'data-text': 'white', 'data-weight': 'bold' })
    expect(cardOf(el, 'Tinted').classList.contains('view-cal__card--crossed')).toBe(true)
    expect(attrs(el, 'Odd')).toEqual({})
    act(() => void cardOf(el, 'Sealed').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })))
    draw()
    expect([...document.body.querySelectorAll('.ctx-menu__item')].map((b) => b.textContent)).not.toContain('Card style')
  })
})

describe('the day names\' header row (YAZ-4864 round 3): the Table view\'s header row look, in the View tab and on a right-click', () => {
  const dayRow = (el: ParentNode) => q<HTMLElement>(el, '.view-cal__grid .view-cal__week')
  const openView = (el: ParentNode) => {
    click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
  }
  const panelItem = (text: string) => byText<HTMLButtonElement>(q(document.body, '.view-style__panel, .ctx-menu__parent .ctx-menu'), 'button', text)

  it('the View tab\'s "Header row [Aa ▾]" opens the style panel on the body; Fill › Blue writes headerRow.color and the day names take it; the ↺ hands it back', () => {
    const { el, yaml } = mount(CALENDAR)
    openView(el)
    expect(dayRow(el).dataset.tableHeaderColor).toBe('gray')
    click(q(el, '.view-popover--properties [aria-label="Header row style"]'))
    const panel = q<HTMLElement>(document.body, '.view-style__panel')
    expect(panel.closest('.view-popover--properties')).toBeNull()
    expect([...panel.querySelectorAll('.fill-target:not(.fill-target--sub) button')].map((b) => b.textContent)).toEqual(['Fill', 'Text', 'Style'])
    click(panelItem('Blue'))
    expect(yaml()).toMatch(/headerRow:\n\s+color: blue/)
    expect(dayRow(el).dataset.tableHeaderColor).toBe('blue')
    expect(panelItem('Blue').dataset.hint).toBe('✓')
    click(byText(panel, 'button', 'Strong'))
    expect(yaml()).toContain('strength: strong')
    expect(dayRow(el).dataset.tableHeaderStrength).toBe('strong')
    // Escape in the panel closes the panel alone (its keydown stops before the tab's window listener).
    act(() => void panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    draw()
    expect(document.body.querySelector('.view-style__panel')).toBeNull()
    click(q(el, '.view-popover--properties [aria-label="Reset to Settings"]'))
    expect(yaml()).not.toContain('headerRow')
  })

  it('a right-click on the day names shows "Header row ›" with the same panel; Text › White writes headerRow.text; Plain sets Off, Regular, Full', () => {
    const { el, yaml } = mount(CALENDAR)
    act(() => void dayRow(el).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })))
    draw()
    const items = () => [...document.body.querySelectorAll('.ctx-menu__item')].map((b) => b.textContent)
    expect(items()).toContain('Header row')
    click(byText(document.body, '.ctx-menu__item', 'Header row'))
    click(byText(q(document.body, '.ctx-menu__parent [aria-label="Style part"]'), 'button', 'Text'))
    click(panelItem('White'))
    expect(yaml()).toMatch(/headerRow:\n\s+text: white/)
    expect(dayRow(el).dataset.tableHeaderText).toBe('white')
    click(panelItem('Plain, like any row'))
    expect(yaml()).toContain('strength: off')
    expect(yaml()).toContain('weight: regular')
    expect(yaml()).toContain('text: full')
  })

  /** The row's look as the folder table wears it: `data-table-header-*` (`headerRowAttrs`), which `table.css` reads. */
  const headAttrs = (el: ParentNode) => Object.fromEntries([...dayRow(el).attributes].filter((a) => a.name.startsWith('data-table-header-')).map((a) => [a.name.slice('data-table-header-'.length), a.value]))

  it('a stored header row reads the same as the folder table\'s: Red, Strong, Regular, Center; a view without one keeps the look of before', () => {
    const { el } = mount(`${CALENDAR}    headerRow:\n      color: red\n      strength: strong\n      weight: regular\n      align: center\n`)
    expect(headAttrs(el)).toEqual({ color: 'red', strength: 'strong', weight: 'regular', text: 'muted', align: 'center' })
    act(() => root?.unmount())
    container?.remove()
    expect(headAttrs(mount(CALENDAR).el)).toEqual({ color: 'gray', strength: 'light', weight: 'bold', text: 'muted', align: 'follow' })
  })

  // YAZ-4834 P1: inline variables set nothing for Gray, Bold, Muted, Full and Follow, so the day names took Settings'
  // Blue (on `.app`) over the view's own Gray. The attributes make the view's Gray unset the hue, as a table's does.
  it('YAZ-4834 P1: with Settings › Tables › Header row Blue, Strong and Regular, a calendar whose own header row is Gray and Bold says so in its attributes, and table.css unsets the hue for its row', () => {
    setHeaderRowSetting({ ...DEFAULT_HEADER_ROW, color: 'blue', strength: 'strong', weight: 'regular' })
    try {
      const { el } = mount(`${CALENDAR}    headerRow:\n      color: gray\n      weight: bold\n`)
      expect(headAttrs(el)).toEqual({ color: 'gray', strength: 'strong', weight: 'bold', text: 'muted', align: 'follow' })
    } finally {
      setHeaderRowSetting(DEFAULT_HEADER_ROW)
    }
    // The day-name row and the "Aa" chip are in the lists of table.css's header rules: their own part wins over `.app`'s.
    const rules = [...tableCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ selector: sel.trim(), body }))
    const ruleOf = (part: string, value: string) => rules.find(({ selector }) => selector.includes('.view-cal__week') && selector.includes('.view-style__chip') && selector.endsWith(`[data-table-header-${part}='${value}']`))
    expect(ruleOf('color', 'gray')?.body).toContain('--table-header-hue: initial')
    expect(ruleOf('weight', 'bold')?.body).toContain('--table-header-weight: initial')
    expect(ruleOf('text', 'muted')?.body).toContain('--table-header-ink: initial')
    expect(ruleOf('align', 'follow')?.body).toContain('--table-header-align: initial')
    expect(ruleOf('color', 'blue')?.body).toContain('--table-header-hue: var(--table-fill-solid-blue)')
  })
})
