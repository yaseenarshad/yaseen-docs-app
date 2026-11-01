/**
 * Settings › Memory (YAZ-3737 D9, D10): a table from main's report (YAZ-3945) with its headers, full window names and
 * "Growing" only for a window that grew (YAZ-3933); an ⓘ on each kind of row (YAZ-3932); a window row that opens its
 * tab rows, awake first (YAZ-3934), each with its title, state, last seen and last change and an empty Memory cell
 * (YAZ-3946); the refresh that stops with the page; and the two settings below. The bridge is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, MEMORY_SAMPLE_MS, type MemoryReport, type MemoryTabRow } from '@shared/types'
import { api } from '../api'
import { SettingsDialog } from './SettingsDialog'
import { agoText } from './memorySection'
import settingsCss from './settings.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MB = 1024 * 1024
const MIN = 60_000
/** The page's clock in these tests: Oct 31, 2026, noon. */
const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const tab = (path: string, over: Partial<MemoryTabRow> = {}): MemoryTabRow => ({ path, title: null, state: 'awake', lastSeen: null, sleepsAt: null, changed: null, ...over })
const REPORT: MemoryReport = {
  windows: [
    {
      id: 'w1',
      title: 'App Memory Bloat Fix demo, a long window name',
      open: '4 notes, 1 drawing',
      bytes: 800 * MB,
      jsHeapBytes: 100 * MB,
      grew: true,
      tabs: [
        tab('/v/00-start-here-mem-1.md', { title: '00 START HERE', state: 'shown', changed: NOW - 5 * MIN }),
        tab('/v/ideas.md', { title: 'Ideas', state: 'asleep', lastSeen: NOW - 2 * 60 * MIN, changed: new Date(2026, 9, 20, 9, 0).getTime() }),
        tab('/v/plan.md', { title: 'Plan', lastSeen: NOW - 18 * MIN, sleepsAt: NOW + 11.5 * MIN, changed: new Date(2026, 9, 30, 8, 0).getTime() }),
        tab('/v/draft.md', { title: 'Draft', state: 'unsaved', lastSeen: NOW - 2 * MIN, changed: NOW - 20_000 }),
        tab('/v/never.md', { title: 'Kept awake' }), // "Never": no timer
        tab('/v/later.md', { title: 'Later', state: 'unloaded', changed: NOW - 3 * MIN }), // not opened since the window started
        tab('/v/board.excalidraw', { title: 'Board', state: 'asleep', lastSeen: NOW - 30 * MIN }), // a failed stat: no Changed
      ],
    },
    // A window that did not answer the tabs ask: its stored tabs, a display name kept, no facts.
    { id: 'w2', title: 'Research', open: '2 notes', bytes: 400 * MB, jsHeapBytes: null, grew: false, tabs: [tab('/v/r-notes.md', { state: null }), tab('/v/s.md', { title: 'Sources', state: null, changed: NOW - 3 * MIN })] },
    { id: 'w3', title: 'Welcome', open: '', bytes: 100 * MB, jsHeapBytes: null, grew: false, tabs: [] },
  ],
  core: { bytes: 300 * MB, main: 200 * MB, gpu: 60 * MB, utility: 40 * MB, other: 0 },
  helpers: { bytes: 500 * MB, count: 2 },
}

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    memory: { report: vi.fn(async () => REPORT) },
    // Settings opens on General (YAZ-3276 D7), whose Settings folder row asks main where the settings are.
    state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
  },
}))

const report = vi.mocked(api.memory.report)
let root: Root | null = null
let el: HTMLElement
const onChange = vi.fn()

beforeEach(() => {
  report.mockClear()
  onChange.mockReset()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
  vi.useRealTimers()
})

async function mountMemory() {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange }} onClose={vi.fn()} />))
  expect(report).not.toHaveBeenCalled() // nothing runs before the page shows
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Memory')?.click())
  await act(async () => await Promise.resolve())
}
const row = (key: string) => el.querySelector<HTMLTableRowElement>(`[data-memory-row="${key}"] .memory__row`)!
const cells = (tr: HTMLTableRowElement) => [...tr.cells].map((c) => c.textContent)
const tabRows = (key: string) => [...el.querySelectorAll<HTMLTableRowElement>(`[data-memory-row="${key}"] .memory__tab`)]

describe('Settings › Memory (YAZ-3737 D9)', () => {
  it('YAZ-3945: a table with headers; a row for each window with its full name, then App core and Code helpers; "Growing" only for the window that grew; the hover text; no ⓘ by the title', async () => {
    await mountMemory()
    expect([...el.querySelectorAll('.memory__table thead th')].map((th) => (th.querySelector('.memory__th-text') ?? th).textContent)).toEqual(['Tab', 'State', 'Last seen', 'Changed', 'RAM'])
    // YAZ-3977: the line under the title says the work is automatic.
    expect(el.querySelector('.settings-section__note')!.textContent).toBe('The app frees memory by itself. A tab that you do not use goes to sleep. A window that gets too big reloads. You do not need to do anything here.')
    expect([...el.querySelectorAll<HTMLElement>('[data-memory-row]')].map((r) => r.dataset.memoryRow)).toEqual(['w1', 'w2', 'w3', 'core', 'helpers'])
    // The name runs across Tab to Last seen (YAZ-3958); Changed is empty; the size and the bar sit under Memory.
    expect([...row('w1').cells].map((c) => c.colSpan)).toEqual([3, 1, 1])
    expect(cells(row('w1'))[2]).toBe('800.0 MB')
    expect(row('w1').querySelector('.memory__name')!.textContent).toBe('App Memory Bloat Fix demo, a long window name')
    expect(row('w1').querySelector<HTMLElement>('.memory__name')!.title).toBe('App Memory Bloat Fix demo, a long window name\n4 notes, 1 drawing')
    expect(row('w2').querySelector('.memory__grew')).toBeNull()
    expect(row('core').querySelector('.memory__name')!.textContent).toBe('App core')
    expect(row('helpers').querySelector('.memory__size')!.textContent).toBe('500.0 MB')
    expect([...el.querySelectorAll<HTMLElement>('.memory__grew')].map((g) => [g.textContent, g.title])).toEqual([['Growing', 'Grew more than 150 MB or 20 % in the last hour.']])
    expect(el.querySelector('.settings-pane')!.textContent).not.toContain('▲')
    // The biggest row fills its bar.
    expect(row('w1').querySelector<HTMLElement>('.storage__fill')!.style.width).toBe('100%')
    expect(row('w2').querySelector<HTMLElement>('.storage__fill')!.style.width).toBe('50%')
    expect(row('w1').cells[2].title).toBe('JS heap 100.0 MB · Other 700.0 MB')
    expect(row('w2').cells[2].title).toBe('')
    expect(row('core').cells[2].title).toBe('Main 200.0 MB · GPU 60.0 MB · Utility 40.0 MB · Other 0 B')
    expect(row('helpers').cells[2].title).toBe('2 helpers')
    expect(el.querySelector('.memory__table')!.parentElement!.textContent).not.toContain('Total')
    // YAZ-3932 round 2: the ⓘ left the title.
    expect(el.querySelector('.settings-section__title ~ .memory__info, .settings-section__head')).toBeNull()
  })

  it('YAZ-3932: each kind of row has its ⓘ with its own line, shown on hover and on keyboard focus; a click on it does not open the row', async () => {
    await mountMemory()
    const tipOf = (key: string) => {
      const info = row(key).querySelector<HTMLButtonElement>('.memory__info-btn')!
      return { info, tip: document.getElementById(info.getAttribute('aria-describedby')!)! }
    }
    expect(['w1', 'w2', 'w3', 'core', 'helpers'].map((key) => tipOf(key).tip.textContent)).toEqual([
      'This is one window. The bar shows the memory it uses now: the biggest row fills its bar. If it has tabs, click it to see them. An asleep tab uses almost no memory. "Growing": it grew more than 150 MB or 20 % in the last hour. You do not need to do anything.',
      'This is one window. The bar shows the memory it uses now: the biggest row fills its bar. If it has tabs, click it to see them. An asleep tab uses almost no memory. "Growing": it grew more than 150 MB or 20 % in the last hour. You do not need to do anything.',
      'This is one window. The bar shows the memory it uses now: the biggest row fills its bar. If it has tabs, click it to see them. An asleep tab uses almost no memory. "Growing": it grew more than 150 MB or 20 % in the last hour. You do not need to do anything.',
      'The parts of the app that all windows share: Main (it controls the app), GPU (it draws the screen), Utility (small helpers) and Other (small system parts, for example DevTools). Closing tabs does not make this smaller.',
      'These run only while a code tab is open and awake. They stop 2 minutes after the last one closes or sleeps.',
    ])
    const { info, tip } = tipOf('core')
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect(tip.hidden).toBe(true)
    act(() => void info.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
    expect(tip.hidden).toBe(false)
    act(() => void info.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(tip.hidden).toBe(true)
    act(() => info.focus())
    expect(tip.hidden).toBe(false)
    act(() => info.blur())
    expect(tip.hidden).toBe(true)
    act(() => tipOf('w1').info.click())
    expect(tabRows('w1')).toEqual([])
    // YAZ-3958: the State header's ⓘ lists each state, one per line; the window name stops before Changed.
    const stateInfo = document.querySelector<HTMLButtonElement>('th .memory__info-btn[aria-label="What each state means"]')!
    const stateTip = document.getElementById(stateInfo.getAttribute('aria-describedby')!)!
    act(() => stateInfo.focus())
    expect(stateTip.hidden).toBe(false)
    expect(stateTip.textContent!.split('\n').map((line) => line.split(':')[0])).toEqual(['In view', 'Awake · sleeps in N min', 'Awake · not saved yet', 'Asleep', 'Not loaded', 'Awake', 'Empty'])
    expect(row('w1').querySelector<HTMLTableCellElement>('.memory__head')!.colSpan).toBe(3)
    // YAZ-3988: Last seen, Changed and RAM each have an ⓘ; the RAM one says why a tab has no number and names the hover's parts.
    // YAZ-4024 nit: each has its own name for a screen reader.
    const columnTips = ['Last seen', 'Changed', 'RAM'].map((name) => document.querySelector<HTMLButtonElement>(`th .memory__info-btn[aria-label="What ${name} means"]`)!).map((b) => document.getElementById(b.getAttribute('aria-describedby')!)!.textContent)
    expect(columnTips).toEqual([
      'The last time this tab was on your screen. Empty for the tab in view (you see it now) and for a tab that is not loaded.',
      'The last time the file was saved to disk: by you, by Sync or by another app.',
      'The memory the window uses now. All tabs in a window share this memory, so a tab has no number of its own. Hover on a size to see its parts. JS heap is the memory of your notes and tabs. Other is the rest of the window: the screen, images and drawings.',
    ])
    expect(row('w1').querySelector<HTMLElement>('.memory__name')!.title).toBe('App Memory Bloat Fix demo, a long window name\n4 notes, 1 drawing')
  })

  it('YAZ-3934, YAZ-3946: a click on a window row opens its tab rows, awake first: title, state, last seen, changed, and an empty Memory cell; it follows the next report; a click closes it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(NOW)
    await mountMemory()
    const toggle = row('w1').querySelector<HTMLButtonElement>('.memory__toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => row('w1').click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(row('w1').querySelector('.memory__arrow')!.textContent).toBe('▾')
    // The tab bar's titles, not file names; strip order inside each group.
    expect(tabRows('w1').map(cells)).toEqual([
      ['00 START HERE', 'In view', '', '5 min ago', ''],
      ['Plan', 'Awake · sleeps in 12 min', '18 min ago', 'Yesterday', ''],
      ['Draft', 'Awake · not saved yet', '2 min ago', 'now', ''],
      ['Kept awake', 'Awake', '', '', ''],
      ['Ideas', 'Asleep', '2 h ago', 'Oct 20', ''],
      ['Later', 'Not loaded', '', '3 min ago', ''], // YAZ-3958: idle as an asleep tab, so below and dimmed
      ['Board', 'Asleep', '30 min ago', '', ''],
    ])
    expect(tabRows('w1').map((tr) => tr.classList.contains('memory__tab--asleep'))).toEqual([false, false, false, false, true, true, true])
    expect(tabRows('w1')[4].querySelector<HTMLElement>('[aria-label="asleep"]')!.title).toBe('Asleep: it uses almost no memory.')
    expect(tabRows('w1').every((tr) => tr.cells[4].childElementCount === 0)).toBe(true) // no size for a tab
    expect(tabRows('w2')).toEqual([]) // only the row clicked opens
    // A window that did not answer: its stored tabs, the file name or display name, no facts.
    act(() => row('w2').querySelector<HTMLButtonElement>('.memory__toggle')!.click())
    expect(tabRows('w2').map(cells)).toEqual([
      ['r-notes', '', '', '', ''],
      ['Sources', '', '', '3 min ago', ''],
    ])
    // The next report, a minute on: Ideas woke, Plan's countdown went on.
    report.mockResolvedValue({ ...REPORT, windows: [{ ...REPORT.windows[0], tabs: REPORT.windows[0].tabs.map((t) => (t.path === '/v/ideas.md' ? { ...t, state: 'awake' as const } : t)) }, ...REPORT.windows.slice(1)] })
    vi.setSystemTime(NOW + MIN - MEMORY_SAMPLE_MS) // the 30 s refresh moves the clock on too
    await act(async () => void vi.advanceTimersByTime(MEMORY_SAMPLE_MS))
    expect(tabRows('w1').map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent])).toEqual([
      ['00 START HERE', 'In view'],
      ['Ideas', 'Awake'],
      ['Plan', 'Awake · sleeps in 11 min'],
      ['Draft', 'Awake · not saved yet'],
      ['Kept awake', 'Awake'],
      ['Later', 'Not loaded'],
      ['Board', 'Asleep'],
    ])
    act(() => row('w1').click())
    expect(tabRows('w1')).toEqual([])
    // A window with no tab, App core and Code helpers do not open.
    expect(['w3', 'core', 'helpers'].map((key) => row(key).querySelector('button.memory__toggle'))).toEqual([null, null, null])
    report.mockResolvedValue(REPORT)
  })

  it('YAZ-3946: the times say "now", "N min ago", "N h ago" under a day, "Yesterday", then the date, the year only when it is not this year', () => {
    expect(agoText(NOW - 59_000, NOW)).toBe('now')
    expect(agoText(NOW + 5_000, NOW)).toBe('now') // a clock a little ahead
    expect(agoText(NOW - 6 * MIN, NOW)).toBe('6 min ago')
    expect(agoText(NOW - 2 * 60 * MIN, NOW)).toBe('2 h ago')
    expect(agoText(NOW - 23 * 60 * MIN, NOW)).toBe('23 h ago')
    expect(agoText(new Date(2026, 9, 30, 6, 0).getTime(), NOW)).toBe('Yesterday')
    expect(agoText(new Date(2026, 9, 20, 9, 0).getTime(), NOW)).toBe('Oct 20')
    expect(agoText(new Date(2025, 11, 24, 9, 0).getTime(), NOW)).toBe('Dec 24, 2025')
  })

  it('no Code helpers row while none runs; the page asks again each 30 s and stops when it closes', async () => {
    vi.useFakeTimers()
    report.mockResolvedValue({ ...REPORT, helpers: null })
    await mountMemory()
    expect(el.querySelector('[data-memory-row="helpers"]')).toBeNull()
    expect(report).toHaveBeenCalledTimes(1)
    await act(async () => void vi.advanceTimersByTime(MEMORY_SAMPLE_MS))
    expect(report).toHaveBeenCalledTimes(2)
    act(() => root?.unmount())
    root = null
    vi.advanceTimersByTime(3 * MEMORY_SAMPLE_MS)
    expect(report).toHaveBeenCalledTimes(2)
    report.mockResolvedValue(REPORT)
  })

  it('D10: the two settings below the rows: sleep after 30 min and reload On by default; a choice writes its field', async () => {
    await mountMemory()
    expect([...el.querySelectorAll<HTMLElement>('[data-setting]')].map((r) => r.dataset.setting)).toEqual(['memoryWindows', 'tabSleepAfter', 'memoryReload'])
    const buttons = (id: string) => [...el.querySelectorAll<HTMLButtonElement>(`[data-setting="${id}"] button`)]
    expect(buttons('tabSleepAfter').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['15 min', 'false'],
      ['30 min', 'true'],
      ['1 h', 'false'],
      ['2 h', 'false'],
      ['Never', 'false'],
    ])
    act(() => buttons('tabSleepAfter')[4].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tabSleepAfter: 'never' })
    expect(buttons('memoryReload').find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent).toBe('On')
    act(() => buttons('memoryReload')[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, memoryReload: false })
  })

  it('YAZ-4024: the State ⓘ gives the true reason for a plain "Awake" and says what an empty cell means', async () => {
    await mountMemory()
    const info = document.querySelector<HTMLButtonElement>('th .memory__info-btn[aria-label="What each state means"]')!
    const lines = document.getElementById(info.getAttribute('aria-describedby')!)!.textContent!.split('\n')
    expect(lines.find((l) => l.startsWith('Awake:'))).toBe('Awake: it uses memory and has no sleep time now. For example, Sleep is set to Never, or the tab board is open.')
    expect(lines.find((l) => l.startsWith('Asleep:'))).toBe('Asleep: it uses almost no memory. A click on its tab wakes it.')
    expect(lines.find((l) => l.startsWith('Not loaded:'))).toBe('Not loaded: you have not opened it since its window opened or reloaded. It uses almost no memory.')
    expect(lines.at(-1)).toBe('Empty: its window did not answer in time. The page asks again in 30 seconds.')
  })

  it('YAZ-4022, YAZ-4025: a cut header, tab name or time has a hover with all of it; the ⓘ is beside the header text, never in it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(NOW)
    await mountMemory()
    for (const th of [...el.querySelectorAll('.memory__table thead th')].slice(1)) {
      const text = th.querySelector<HTMLElement>('.memory__th-text')!
      expect(text.title).toBe(text.textContent)
      expect(text.nextElementSibling!.classList.contains('memory__info')).toBe(true)
    }
    act(() => row('w1').click())
    for (const tr of tabRows('w1')) {
      const [name, , seen, changed] = [...tr.cells]
      expect(name.title).toBe(name.textContent)
      expect(seen.title === '' ? seen.textContent : seen.title).toMatch(seen.textContent === '' ? /^$/ : /\d{4}/)
      expect(changed.title === '' ? changed.textContent : changed.title).toMatch(changed.textContent === '' ? /^$/ : /\d{4}/)
    }
    vi.useRealTimers()
  })

  it('YAZ-4022, YAZ-4023: the rules keep the page from scrolling sideways: the header ⓘ lines hang from the header row and are as wide as the table at most; a narrow table drops the bars', () => {
    const css = settingsCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
    expect(rule('.memory__table thead tr')).toMatch(/position:\s*relative;/)
    expect(css).not.toMatch(/\.memory__(?:state|info)-head\s*\{[^}]*position/)
    expect(rule('.memory__state-head .memory__tip')).toMatch(/width:\s*min\(340px, calc\(100% - 12px\)\);/)
    expect(rule('.memory__info-head .memory__tip')).toMatch(/width:\s*min\(260px, calc\(100% - 12px\)\);/)
    expect(rule('.memory__th-text')).toMatch(/overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;/)
    expect(rule('.memory__wrap')).toMatch(/container:\s*memory \/ inline-size;/)
    expect(css).toMatch(/@container memory \(max-width: 480px\)\s*\{[\s\S]*\.memory__bar\s*\{\s*display:\s*none;/)
  })
})
