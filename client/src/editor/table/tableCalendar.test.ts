/**
 * Calendar tables (YAZ-4162, YAZ-4159 D1 / D2 / D9 / D14): the `calendar` part, the time reading, the now row,
 * the past rows and the minute tick, on real editors (`createCrepe`). The tick is a metadata-only transaction: it
 * changes no document, adds no undo step, keeps redo and never reaches `markdownUpdated` (the save path).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { redoDepth, undo as undoCommand, undoDepth } from '@milkdown/kit/prose/history'
import { DOMParser, DOMSerializer, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Autosave } from '../../lib/autosave'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { formatTableComment, parseTableComment, plainTable } from './tableComment'
import { calendarTick, readTime } from './tableCalendar'
import { cellPos } from './tableTestKit'
import tableCss from './table.css?inline'

afterEach(async () => {
  await unmountAll()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** `h:mm am` of minutes from midnight (any day). */
const clock = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** A calendar table: a header row, then one row per time (a time may be any text), then its comment. */
const calendar = (times: string[], part = 'calendar 30m', plan: (i: number) => string = () => ' '): string =>
  ['| Time | Plan |', '| --- | --- |', ...times.map((t, i) => `| ${t} | ${plan(i)} |`)].join('\n') + `\n\n<!-- table: ${part} -->\n`

/** 4:00 am to 11:30 pm, each 30 minutes: 40 rows, row 1 is 4:00 am. */
const DAY = Array.from({ length: 40 }, (_, i) => clock(240 + 30 * i))

const rowsOf = (view: EditorView) => [...view.dom.querySelectorAll<HTMLTableRowElement>('tbody[data-content-dom] > tr')]
const nowRows = (view: EditorView) => rowsOf(view).flatMap((row, i) => (row.classList.contains('table-now-row') ? [{ i, now: row.style.getPropertyValue('--table-now') }] : []))
const pastRows = (view: EditorView) => rowsOf(view).flatMap((row, i) => (row.classList.contains('table-past-row') ? [i] : []))

/** Mount at a wall-clock time today: only `Date` is fake, so the editor's own timers run. */
async function mountAt(hours: number, minutes: number, markdown: string, options: Parameters<typeof mount>[1] = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 2, hours, minutes, 0))
  return mount(markdown, options)
}

const firstTable = (doc: ProseNode): { node: ProseNode; pos: number } => {
  let out: { node: ProseNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (out === null && node.type.name === 'table') out = { node, pos }
    return out === null
  })
  return out!
}

describe('the calendar part (D1)', () => {
  it.each(['15m', '30m', '60m'])('`calendar %s` round-trips in the comment, after the known parts', (slot) => {
    const comment = `<!-- table: stripes, freeze 1 row, calendar ${slot} -->`
    const parsed = parseTableComment(comment)
    expect(parsed?.calendar).toBe(Number(slot.slice(0, -1)))
    expect(formatTableComment(parsed!)).toBe(comment)
    expect(formatTableComment({ ...plainTable(), calendar: 30 })).toBe('<!-- table: calendar 30m -->')
  })

  it('`calendar 45m` is a value the reader does not know: dropped', () => {
    expect(parseTableComment('<!-- table: calendar 45m, stripes -->')).toEqual({ ...plainTable(), stripes: true })
    expect(parseTableComment('<!-- table: calendar 45m -->')).toBeNull()
  })

  it('a calendar table loads into the `calendar` attribute and saves the same bytes; a copy in the app keeps it', async () => {
    const note = calendar(['9:00 am', '9:30 am'])
    const { crepe, view } = await mount(note)
    expect(firstTable(view.state.doc).node.attrs.calendar).toBe(30)
    const out = getMarkdownForSave(crepe)
    expect(out).toMatch(/\|\n\n<!-- table: calendar 30m -->\n$/)
    expect(getMarkdownForSave((await mount(out)).crepe)).toBe(out)
    const { schema } = view.state
    const holder = document.createElement('div')
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeNode(firstTable(view.state.doc).node))
    expect(firstTable(DOMParser.fromSchema(schema).parse(holder)).node.attrs.calendar).toBe(30)
  })
})

describe('readTime', () => {
  it.each<[string, number]>([
    ['9:00 am', 540], ['9:00am', 540], ['9am', 540], ['9:00 AM', 540], ['09:00', 540], ['21:30', 1290],
    ['12:00 am', 0], ['12:30 pm', 750], ['11:59 pm', 1439], [' 7:05 pm ', 1145], ['0:00', 0],
    // No colon with am / pm (the YAZ-4163 demo): `930am`, `1130 pm`, `1205am`.
    ['930am', 570], ['1130 pm', 1410], ['1205am', 5], ['900AM', 540],
  ])('%s is %i', (text, minutes) => {
    expect(readTime(text)).toBe(minutes)
  })

  it.each(['25:00', '9:60', '13pm', 'abc', '', '9', '0:30 am', '9:5', 'Time', '930', '0930', '1200', '960am', '1300pm'])('%s is no time', (text) => {
    expect(readTime(text)).toBeNull()
  })
})

describe('the now row and the past rows (D2, D14)', () => {
  it('at 11:40 the 11:30 am row holds now, a third down; the rows before it are past', async () => {
    const { view } = await mountAt(11, 40, calendar(DAY))
    // Row 0 is the header row; 4:00 am is row 1, 11:30 am row 16.
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.333' }])
    expect(pastRows(view)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  })

  it('before the first row: no now row and no past row', async () => {
    const { view } = await mountAt(3, 10, calendar(DAY))
    expect(nowRows(view)).toEqual([])
    expect(pastRows(view)).toEqual([])
  })

  it('after the last slot: no now row, every row is past', async () => {
    const { view } = await mountAt(23, 59, calendar(['9:00 pm', '10:00 pm'], 'calendar 60m'))
    expect(nowRows(view)).toEqual([])
    expect(pastRows(view)).toEqual([1, 2])
  })

  it('a time earlier than the row above is on the next day: at 00:10 the 12:00 am row holds now', async () => {
    const { view } = await mountAt(0, 10, calendar(['10:30 pm', '11:00 pm', '11:30 pm', '12:00 am', '12:30 am']))
    expect(nowRows(view)).toEqual([{ i: 4, now: '0.333' }])
    expect(pastRows(view)).toEqual([1, 2, 3])
  })

  it('the last row is one slot long; a two-line row works (the fraction is of the slot, not of the pixels)', async () => {
    const { view } = await mountAt(9, 45, calendar(['9:00 am', '9:30 am'], 'calendar 30m', (i) => (i === 1 ? '~~Mochi~~<br>Treadmill walk' : ' ')))
    expect(nowRows(view)).toEqual([{ i: 2, now: '0.5' }])
  })

  it('a row with no time gets no slot; the rows around it still work; the header is never a slot', async () => {
    const { view } = await mountAt(10, 15, calendar(['9:00 am', 'Lunch?', '10:00 am', '11:00 am']))
    expect(nowRows(view)).toEqual([{ i: 3, now: '0.25' }])
    expect(pastRows(view)).toEqual([1, 2])
  })

  it('a table with `calendar` but no readable time, and a table with times but no `calendar`, show no marker', async () => {
    const { view } = await mountAt(10, 15, `${calendar(['Wake', 'Gym'])}\n${calendar(['9:00 am', '10:00 am']).replace('\n\n<!-- table: calendar 30m -->', '')}`)
    expect(nowRows(view)).toEqual([])
    expect(pastRows(view)).toEqual([])
  })

  it('a read-only note shows the marker', async () => {
    const { crepe, view } = await mountAt(11, 40, calendar(DAY))
    crepe.setReadonly(true)
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.333' }])
  })
})

describe('the minute tick (D2)', () => {
  it('moves the marker with a metadata-only transaction: no document change, no undo step, redo kept', async () => {
    const { view } = await mountAt(11, 40, calendar(DAY))
    // An edit, then its undo: one redo step to keep.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 3, 1) + 2)))
    view.dispatch(view.state.tr.insertText('x'))
    const undo = undoDepth(view.state)
    undoCommand(view.state, view.dispatch)
    const [undoBefore, redoBefore] = [undoDepth(view.state), redoDepth(view.state)]
    expect(redoBefore).toBe(1)
    const doc = view.state.doc
    let changed: boolean | null = null
    const dispatch = view.dispatch.bind(view)
    vi.spyOn(view, 'dispatch').mockImplementation((tr) => {
      changed = tr.docChanged
      dispatch(tr)
    })
    calendarTick(view, 11 * 60 + 50)
    expect(changed).toBe(false)
    expect(view.state.doc).toBe(doc)
    expect([undoDepth(view.state), redoDepth(view.state)]).toEqual([undoBefore, redoBefore])
    expect(undo).toBeGreaterThan(undoBefore)
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.667' }])
    expect(pastRows(view)).toHaveLength(15)
  })

  it('never reaches markdownUpdated or Autosave: no save, no new mtime', async () => {
    const updates: string[] = []
    const save = vi.fn(async () => ({ mtime: 2 }))
    let autosave: Autosave | null = null
    const { crepe, view } = await mountAt(11, 40, calendar(DAY), { onMarkdownUpdated: (md) => void (updates.push(md), autosave?.update(md)) })
    // Crepe's own start-up update (~200 ms after create) carries the loaded document; let it pass.
    await new Promise((resolve) => setTimeout(resolve, 400))
    updates.length = 0
    autosave = new Autosave({ content: getMarkdownForSave(crepe), mtime: 1, delayMs: 20, save, onStatus: () => {}, onConflict: () => {} })
    calendarTick(view, 12 * 60 + 5)
    calendarTick(view, 12 * 60 + 6)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(updates).toEqual([])
    expect(autosave.dirty).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(nowRows(view)).toEqual([{ i: 17, now: '0.2' }])
  })
})

describe('the clock: one timer per editor, on the minute (D2, D9)', () => {
  /** Fake timers that move with real time, so the editor's own debounces still run. */
  const fakeClock = (hours: number, minutes: number, seconds = 0) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 2, hours, minutes, seconds))
  }

  it('a note editor with a calendar table moves the marker on the next minute', async () => {
    fakeClock(11, 40, 30)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.333' }])
    await vi.advanceTimersByTimeAsync(31_000)
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.367' }])
  })

  it('the hover preview card (no clock) starts no timer: the marker stays', async () => {
    fakeClock(11, 40, 30)
    const { view } = await mount(calendar(DAY))
    await vi.advanceTimersByTimeAsync(61_000)
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.333' }])
  })

  it('a note with no calendar table starts no timer; a table that becomes one starts it', async () => {
    fakeClock(11, 40, 30)
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const { view } = await mount(calendar(DAY).replace('calendar 30m', 'stripes'), { calendarClock: true })
    // The clock's own timer: its callback is the clock's `#fire`.
    const minuteTimers = () => timers.mock.calls.filter(([fn]) => fn.name === '#fire').length
    expect(minuteTimers()).toBe(0)
    const { pos, node } = firstTable(view.state.doc)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, calendar: 30 }))
    expect(minuteTimers()).toBe(1)
    await vi.advanceTimersByTimeAsync(31_000)
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.367' }])
  })

  it('a hidden window skips the tick; showing the window ticks at once', async () => {
    fakeClock(11, 40, 30)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.333' }])
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.367' }])
  })

  it('an editor that is not on the screen skips the tick; coming back on the screen ticks at once', async () => {
    fakeClock(11, 40, 30)
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observers.push(cb)
      }
      observe() {}
      disconnect() {}
    })
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    observers.forEach((cb) => cb([{ isIntersecting: false }]))
    await vi.advanceTimersByTimeAsync(61_000)
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.333' }])
    observers.forEach((cb) => cb([{ isIntersecting: true }]))
    expect(nowRows(view)).toEqual([{ i: 16, now: '0.367' }])
    vi.unstubAllGlobals()
  })

  it('watches the chips again only when a calendar table changes: not on Enter in a paragraph or a change of a plain table (YAZ-4176)', async () => {
    let observed = 0
    vi.stubGlobal('IntersectionObserver', class {
      observe() {
        observed++
      }
      disconnect() {}
    })
    const { view } = await mount(`Text\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n${calendar(DAY)}`, { calendarClock: true })
    const before = observed
    // Enter in the paragraph: a split, so not typing only.
    view.dispatch(view.state.tr.split(3))
    const plain = firstTable(view.state.doc)
    view.dispatch(view.state.tr.setNodeMarkup(plain.pos, undefined, { ...plain.node.attrs, stripes: true }))
    expect(observed).toBe(before)
    let cal: { node: ProseNode; pos: number } | null = null
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table' && node.attrs.calendar > 0) cal = { node, pos }
      return node.type.name !== 'table'
    })
    view.dispatch(view.state.tr.setNodeMarkup(cal!.pos, undefined, { ...cal!.node.attrs, stripes: true }))
    expect(observed).toBeGreaterThan(before)
    vi.unstubAllGlobals()
  })

  it('destroy clears the timer', async () => {
    fakeClock(11, 40, 30)
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    const { crepe } = await mount(calendar(DAY), { calendarClock: true })
    const before = cleared.mock.calls.length
    await crepe.destroy()
    expect(cleared.mock.calls.length).toBeGreaterThan(before)
    await vi.advanceTimersByTimeAsync(61_000)
  })
})

describe('the marker in table.css (D2, D6, D14)', () => {
  const rules = [...tableCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
  const calendarRules = rules.filter(({ selector }) => /table-(now|past)-row/.test(selector))

  it('no rule of the now row or the past rows sets a position, so a frozen cell stays sticky', () => {
    expect(calendarRules.length).toBeGreaterThan(5)
    for (const { selector, body } of calendarRules) expect(body, selector).not.toMatch(/(^|[;\s])position\s*:/)
  })

  it('the look follows `data-table-now`: the line by default, none of it for the tint; past rows grey for `text` and `shade` of `data-table-dim-past`, shaded for `shade` only', () => {
    expect(calendarRules.find(({ selector }) => selector.startsWith("[data-table-now='tint']"))?.body).toMatch(/--table-now-line:\s*none/)
    const past = calendarRules.filter(({ selector }) => selector.includes('table-past-row'))
    const grey = past.find(({ body }) => body.trim() === 'color: var(--fg-muted);')
    expect(grey?.selector).toMatch(/^:is\(\[data-table-dim-past='text'\], \[data-table-dim-past='shade'\]\)/)
    const shade = past.find(({ body }) => body.includes('--table-past:'))
    expect(shade?.selector).toMatch(/^\[data-table-dim-past='shade'\]/)
    // Both cell rules paint the shade as a layer, under the band and over a fill.
    const paint = rules.filter(({ body }) => /background-image:\s*var\(--table-band, none\)/.test(body))
    expect(paint.length).toBe(2)
    for (const { body } of paint) expect(body).toMatch(/var\(--table-band, none\), var\(--table-past, none\)/)
  })
})
