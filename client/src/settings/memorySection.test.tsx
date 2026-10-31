/**
 * Settings › Memory (YAZ-3737 D9, D10): the rows from main's report, ▲ only for a window that grew, a click that
 * brings a window to the front (and does nothing on App core or Code helpers), the refresh that stops with the
 * page, and the two settings below. The bridge is mocked.
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
    { id: 'w1', title: 'Writing', open: '2 notes, 1 drawing', bytes: 800 * MB, jsHeapBytes: 100 * MB, grew: true },
    { id: 'w2', title: 'Research', open: '1 note', bytes: 400 * MB, jsHeapBytes: null, grew: false },
  ],
  core: { bytes: 300 * MB, main: 200 * MB, gpu: 60 * MB, utility: 40 * MB, other: 0 },
  helpers: { bytes: 500 * MB, count: 2 },
}

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    memory: { report: vi.fn(async () => REPORT) },
    window: { showWindow: vi.fn(async () => undefined) },
    // Settings opens on General (YAZ-3276 D7), whose Settings folder row asks main where the settings are.
    state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
  },
}))

const report = vi.mocked(api.memory.report)
const showWindow = vi.mocked(api.window.showWindow)
let root: Root | null = null
let el: HTMLElement
const onChange = vi.fn()

beforeEach(() => {
  report.mockClear()
  showWindow.mockClear()
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
  it('rows from the report: windows, App core, Code helpers; ▲ only for the window that grew; the hover text; no total line', async () => {
    await mountMemory()
    expect([...el.querySelectorAll<HTMLElement>('[data-memory-row]')].map((r) => r.dataset.memoryRow)).toEqual(['w1', 'w2', 'core', 'helpers'])
    expect(cells('w1')).toEqual(['Writing', '2 notes, 1 drawing', '', '800.0 MB', '▲'])
    expect(cells('w2')).toEqual(['Research', '1 note', '', '400.0 MB', ''])
    expect(cells('core')).toEqual(['App core', '', '', '300.0 MB', ''])
    expect(cells('helpers')).toEqual(['Code helpers', '', '', '500.0 MB', ''])
    expect(el.querySelectorAll('.memory__grew[title]')).toHaveLength(1)
    // The biggest row fills its bar.
    expect(row('w1').querySelector<HTMLElement>('.storage__fill')!.style.width).toBe('100%')
    expect(row('w2').querySelector<HTMLElement>('.storage__fill')!.style.width).toBe('50%')
    expect(row('w1').title).toBe('JS heap 100.0 MB · Other 700.0 MB')
    expect(row('w2').title).toBe('')
    expect(row('core').title).toBe('Main 200.0 MB · GPU 60.0 MB · Utility 40.0 MB · Other 0 B')
    expect(row('helpers').title).toBe('2 helpers')
    expect(el.querySelector('.memory__rows')!.parentElement!.textContent).not.toContain('Total')
  })

  it('a click on a window row brings that window to the front; App core and Code helpers do nothing', async () => {
    await mountMemory()
    act(() => row('w2').click())
    expect(showWindow).toHaveBeenCalledExactlyOnceWith('w2')
    act(() => row('core').click())
    act(() => row('helpers').click())
    expect(showWindow).toHaveBeenCalledTimes(1)
    expect([row('core').tagName, row('helpers').tagName]).toEqual(['DIV', 'DIV'])
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
