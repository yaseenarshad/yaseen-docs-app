/**
 * Settings › Memory (YAZ-3737 D9, D10): the rows from main's report, "Growing" only for a window that grew (YAZ-3933),
 * the ⓘ (YAZ-3932), a window row that opens its tab list, awake first (YAZ-3934), the refresh that stops with the page,
 * and the two settings below. The bridge is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, MEMORY_SAMPLE_MS, type MemoryReport } from '@shared/types'
import { api } from '../api'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MB = 1024 * 1024
const REPORT: MemoryReport = {
  windows: [
    {
      id: 'w1',
      title: 'Writing',
      open: '2 notes, 1 drawing',
      bytes: 800 * MB,
      jsHeapBytes: 100 * MB,
      grew: true,
      tabs: [
        { path: '/v/Ideas.md', asleep: true },
        { path: '/v/Plan.md', asleep: false },
        { path: '/v/Board.excalidraw', asleep: true },
        { path: '/v/Plan.md', name: 'Plan copy', asleep: false },
      ],
    },
    { id: 'w2', title: 'Research', open: '1 note', bytes: 400 * MB, jsHeapBytes: null, grew: false, tabs: [{ path: '/v/r.md', asleep: false }] },
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
const row = (key: string) => el.querySelector<HTMLElement>(`[data-memory-row="${key}"] .memory__row`)!
const cells = (key: string) => [...row(key).children].map((c) => c.textContent)

describe('Settings › Memory (YAZ-3737 D9)', () => {
  it('rows from the report: windows, App core, Code helpers; "Growing" only for the window that grew, no ▲ anywhere; the hover text; no total line', async () => {
    await mountMemory()
    expect([...el.querySelectorAll<HTMLElement>('[data-memory-row]')].map((r) => r.dataset.memoryRow)).toEqual(['w1', 'w2', 'w3', 'core', 'helpers'])
    expect(cells('w1')).toEqual(['▸', 'Writing', '2 notes, 1 drawing', '', '800.0 MB', 'Growing'])
    expect(cells('w2')).toEqual(['▸', 'Research', '1 note', '', '400.0 MB', ''])
    expect(cells('core')).toEqual(['', 'App core', '', '', '300.0 MB', ''])
    expect(cells('helpers')).toEqual(['', 'Code helpers', '', '', '500.0 MB', ''])
    expect([...el.querySelectorAll<HTMLElement>('.memory__grew[title]')].map((g) => g.title)).toEqual(['Grew more than 150 MB or 20 % in the last hour.'])
    expect(el.querySelector('.settings-pane')!.textContent).not.toContain('▲')
    // The biggest row fills its bar.
    expect(row('w1').querySelector<HTMLElement>('.storage__fill')!.style.width).toBe('100%')
    expect(row('w2').querySelector<HTMLElement>('.storage__fill')!.style.width).toBe('50%')
    expect(row('w1').title).toBe('JS heap 100.0 MB · Other 700.0 MB')
    expect(row('w2').title).toBe('')
    expect(row('core').title).toBe('Main 200.0 MB · GPU 60.0 MB · Utility 40.0 MB · Other 0 B')
    expect(row('helpers').title).toBe('2 helpers')
    expect(el.querySelector('.memory__rows')!.parentElement!.textContent).not.toContain('Total')
  })

  it('YAZ-3932: the ⓘ next to the title shows its five lines on hover and on keyboard focus, and hides again', async () => {
    await mountMemory()
    const head = el.querySelector<HTMLElement>('.settings-section__head')!
    expect(head.querySelector('.settings-section__title')!.textContent).toBe('Memory')
    const info = head.querySelector<HTMLButtonElement>('.memory__info-btn')!
    const tip = document.getElementById(info.getAttribute('aria-describedby')!)!
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect([...tip.children].map((line) => line.textContent)).toEqual([
      'Each row is one open window. The bar shows the memory it uses now.',
      'App core: the parts of the app that all windows share.',
      'Code helpers: they run only while code files are open.',
      'Growing: the window grew more than 150 MB or 20 % in the last hour.',
      'A sleeping tab (zzz) uses almost no memory. The app cannot measure one note: all the tabs of a window share its memory.',
    ])
    expect(tip.hidden).toBe(true)
    act(() => void info.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
    expect(tip.hidden).toBe(false)
    act(() => void info.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(tip.hidden).toBe(true)
    act(() => info.focus())
    expect(tip.hidden).toBe(false)
    act(() => info.blur())
    expect(tip.hidden).toBe(true)
  })

  it('YAZ-3934: a click on a window row opens its tab list, awake tabs first, the sleeping ones with the zzz; it follows the next report; a click closes it; App core, Code helpers and a window with no tab do not open', async () => {
    vi.useFakeTimers()
    await mountMemory()
    const tabs = (key: string) => [...el.querySelectorAll<HTMLElement>(`[data-memory-row="${key}"] .memory__tab`)].map((t) => [t.textContent, t.classList.contains('memory__tab--asleep'), t.querySelector('[aria-label="asleep"]') !== null])
    expect(tabs('w1')).toEqual([])
    expect(row('w1').getAttribute('aria-expanded')).toBe('false')
    act(() => row('w1').click())
    expect(row('w1').getAttribute('aria-expanded')).toBe('true')
    expect(cells('w1')[0]).toBe('▾')
    // Strip order inside each group; a display name wins over the file name; no size on a tab.
    expect(tabs('w1')).toEqual([
      ['Plan', false, false],
      ['Plan copy', false, false],
      ['Ideas', true, true],
      ['Board', true, true],
    ])
    expect(el.querySelector<HTMLElement>('.memory__asleep')!.title).toBe('Asleep: it uses almost no memory.')
    expect(tabs('w2')).toEqual([]) // only the row clicked opens
    // The next report: Ideas woke. The open list follows it.
    report.mockResolvedValue({ ...REPORT, windows: [{ ...REPORT.windows[0], tabs: REPORT.windows[0].tabs.map((t) => ({ ...t, asleep: t.path.endsWith('.excalidraw') })) }, ...REPORT.windows.slice(1)] })
    await act(async () => void vi.advanceTimersByTime(MEMORY_SAMPLE_MS))
    expect(tabs('w1').map(([name, asleep]) => [name, asleep])).toEqual([
      ['Ideas', false],
      ['Plan', false],
      ['Plan copy', false],
      ['Board', true],
    ])
    act(() => row('w1').click())
    expect(tabs('w1')).toEqual([])
    expect([row('w3').tagName, row('core').tagName, row('helpers').tagName]).toEqual(['DIV', 'DIV', 'DIV'])
    report.mockResolvedValue(REPORT)
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
})
