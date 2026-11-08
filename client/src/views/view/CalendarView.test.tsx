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
  return { ...real, dateColumns: vi.fn(real.dateColumns) }
})
import { dateColumns } from '../calendar'
import { writeProperty } from '../writeProperty'

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
  it('shows the month of today, Monday first, with today ringed (S7)', () => {
    const { el } = mount(CALENDAR)
    expect(q(el, '.view-cal__month').textContent).toBe('December 2026')
    expect([...el.querySelectorAll('.view-cal__weekday')].map((d) => d.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(el.querySelectorAll('.view-cal__day')[0].getAttribute('data-day')).toBe('2026-11-30')
    expect(el.querySelectorAll('.view-cal__day--today')).toHaveLength(1)
    expect(day(el, '2026-12-10').classList.contains('view-cal__day--today')).toBe(true)
    expect(day(el, '2026-12-10').getAttribute('aria-current')).toBe('date')
  })

  it('a card goes on the date part as written: a time zone does not move it (S3)', () => {
    const { el } = mount(CALENDAR)
    // Both stay on Dec 3; the timed one comes first, as in Week (YAZ-4558 D22, so the note window steps as the day shows).
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

  it('a note with no date sits in the "No date" tray below the grid', () => {
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

  it('a read-only note does not drag', () => {
    const { el } = mount(CALENDAR, { readOnly: new Set(['/vault/Locked.md']) })
    expect(cardOf(el, 'Locked').getAttribute('draggable')).toBeNull()
    expect(cardOf(el, 'Bare').getAttribute('draggable')).toBe('true')
    drag(cardOf(el, 'Locked'), day(el, '2026-12-09'))
    expect(write).not.toHaveBeenCalled()
  })
})

describe('calendar "+" on a day (YAZ-4540 S10) and "Show by"', () => {
  it('"+" on a day makes a new note with that date', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Untitled.md'))
    const { el, onOpenFile } = mount(CALENDAR, { folder: testFolderHost({ create }) })
    click(q(day(el, '2026-12-09'), '[aria-label="New note on 2026-12-09"]'))
    await flush()
    expect(create).toHaveBeenCalledExactlyOnceWith({ properties: { due: '2026-12-09' } }, undefined)
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Untitled.md')
  })

  it('"Show by" on the toolbar lists the date columns and saves the choice', () => {
    const records = [...RECORDS, rec('Started', { start: '2026-12-21', due: '2026-12-01' })]
    const { el, yaml } = mount(CALENDAR, { records })
    const select = q<HTMLSelectElement>(el, '.view-toolbar [aria-label="Show by"]')
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

  it('Properties has a "Calendar" section with the same "Show by"', () => {
    const { el } = mount(CALENDAR)
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]')) // the View tab (YAZ-4607 D59)
    const pop = q(el, '.view-popover--properties')
    expect([...pop.querySelectorAll('.view-menu__label')].map((l) => l.textContent)).toContain('Calendar')
    expect(q<HTMLSelectElement>(pop, '[aria-label="Show by"]').value).toBe('note.due')
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

  it('"+" on a calendar day opens the new note; the folder page that mounts again on that Back step shows the Calendar', async () => {
    const create = vi.fn(async () => '/vault/Tasks/Untitled.md')
    const { el, onOpenFile } = mount(TWO, { viewKey: 'step-1', folder: testFolderHost({ create }) })
    expect(activeTab(el)).toBe('Table')
    act(() => [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'Calendar')!.click())
    draw()
    await act(async () => q<HTMLButtonElement>(el, '[aria-label="New note on 2026-12-03"]').click())
    expect(onOpenFile).toHaveBeenCalledWith('/vault/Tasks/Untitled.md')
    // The tab moves on to the note: this page unmounts. Back mounts it again under the same step.
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
  it('one dateColumns run for a render, with "Show by" on the toolbar and in Properties', () => {
    const { el } = mount(CALENDAR)
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]')) // the View tab (YAZ-4607 D59)
    expect(document.querySelectorAll('[aria-label="Show by"]')).toHaveLength(2)
    vi.mocked(dateColumns).mockClear()
    // New records (an index refetch): one run, not one for each "Show by" too.
    act(() => root?.render(<ViewsPane parsed={parseViews(CALENDAR)} onChange={vi.fn()} root="/vault" folderPath="/vault/Tasks" records={[...RECORDS]} folder={testFolderHost()} onOpenFile={vi.fn()} />))
    expect(document.querySelectorAll('[aria-label="Show by"]')).toHaveLength(2)
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
    expect(shownDays(el)).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'])
    click(scaleBtn(el, 'month'))
    expect(yaml()).not.toContain('calendarScale')
    expect(q(el, '.view-cal__month').textContent).toBe('December 2026')
    expect(shownDays(el)).toHaveLength(35)
  })

  it('reads calendarScale: week: Monday to Sunday of today, today ringed, the range as the title', () => {
    const { el } = mount(WEEK)
    expect(q(el, '.view-cal__month').textContent).toBe('Dec 7 – Dec 13, 2026')
    expect(q(el, '.view-cal__grid').getAttribute('aria-label')).toBe('Dec 7 – Dec 13, 2026')
    expect([...el.querySelectorAll('.view-cal__weekday')].map((d) => d.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(day(el, '2026-12-10').getAttribute('aria-current')).toBe('date')
    expect(el.querySelectorAll('.view-cal__day--other')).toHaveLength(0)
    expect(titlesIn(q(el, '.view-cal__tray'))).toEqual(['Nothing'])
  })

  it('‹ and › step one week, across a month and a year; Today comes back', () => {
    const { el } = mount(WEEK)
    click(q(el, '[aria-label="Previous week"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('Nov 30 – Dec 6, 2026')
    expect(shownDays(el)[0]).toBe('2026-11-30')
    // Late zone has a time (23:30Z), so it comes before Bare here; Month keeps the row order.
    expect(titlesIn(day(el, '2026-12-03'))).toEqual(['Late zone', 'Bare'])
    for (let i = 0; i < 4; i++) click(q(el, '[aria-label="Next week"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('Dec 28, 2026 – Jan 3, 2027')
    click(q(el, '[aria-label="Today"]'))
    expect(q(el, '.view-cal__month').textContent).toBe('Dec 7 – Dec 13, 2026')
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

  it('a drag to a day writes it and keeps the time; "+" on a day makes a note with that date', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Untitled.md'))
    const { el } = mount(WEEK, { folder: testFolderHost({ create }) })
    click(q(el, '[aria-label="Previous week"]'))
    drag(cardOf(el, 'Timed'), day(el, '2026-12-01'))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Timed.md', 'due', '2026-12-01 10:30')
    expect(titlesIn(day(el, '2026-12-01'))).toEqual(['Timed'])
    await flush()
    click(q(day(el, '2026-12-02'), '[aria-label="New note on 2026-12-02"]'))
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
  const cardTitles = (el: ParentNode) => q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="Card titles"]')
  function choose(select: HTMLSelectElement, value: string) {
    act(() => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    draw()
  }

  it('Clip by default: one line, and the full title in a tooltip', () => {
    const { el } = mount(CALENDAR, { records })
    const card = cardOf(el, LONG)
    expect(card.classList.contains('view-cal__card--wrap')).toBe(false)
    expect(q(card, '.view-cal__card-title').getAttribute('title')).toBe(LONG)
  })

  it('Properties › Calendar "Card titles" writes cardTitles: wrap; Clip deletes it (absent = clip)', () => {
    const { el, yaml } = mount(CALENDAR, { records })
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
    click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
    expect(cardTitles(el).value).toBe('clip')
    expect([...cardTitles(el).options].map((o) => o.textContent)).toEqual(['Clip …', 'Wrap'])
    choose(cardTitles(el), 'wrap')
    expect(yaml()).toContain('cardTitles: wrap')
    expect(cardOf(el, LONG).classList.contains('view-cal__card--wrap')).toBe(true)
    choose(cardTitles(el), 'clip')
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
  function toggle(box: HTMLInputElement): void {
    act(() => box.click())
    draw()
  }

  it('Month shows Monday to Friday only; a weekend note sits on the Friday before, marked Sat or Sun', () => {
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

  it('Week shows Monday to Friday of the week', () => {
    const { el } = mount(`${HIDE}    calendarScale: week\n`, { records })
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
      const { el } = mount(HIDE, { records: november })
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
      const monday = mount(`${HIDE}    calendarScale: week\n`, { records: november })
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
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
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
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
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
