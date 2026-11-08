/**
 * The calendar view (YAZ-4540, YAZ-949): ViewsPane mounted with react-dom in jsdom, the clock held
 * at Thu 10 Dec 2026, `writeProperty` mocked. Cards go on the date part as written (S3), a move
 * writes the new day and keeps the time (D4), and the "No date" tray takes and gives cards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { parseViews, serializeViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
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
    expect(titlesIn(day(el, '2026-12-03'))).toEqual(['Bare', 'Late zone'])
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
    click(more)
    expect(titlesIn(day(el, '2026-12-15'))).toEqual(['Busy A', 'Busy B', 'Busy C', 'Busy D', 'Busy E'])
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
    const pop = q(el, '.view-popover--properties')
    expect([...pop.querySelectorAll('.view-menu__label')].map((l) => l.textContent)).toContain('Calendar')
    expect(q<HTMLSelectElement>(pop, '[aria-label="Show by"]').value).toBe('note.due')
  })
})
