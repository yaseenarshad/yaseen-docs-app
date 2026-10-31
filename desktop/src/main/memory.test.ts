/** The memory meter (YAZ-3737 D1): what a window counts, its history, "grew" and the code helpers. */
import { describe, expect, it, vi } from 'vitest'
import { MEMORY_SAMPLE_MS } from '@shared/types'
import { GREW_SPAN_MS, HISTORY, createMemoryMeter, grewSince, helperRss, openText, type MemoryHost, type MeterProcess } from './memory'

const MB = 1024 * 1024

interface FakeWindow {
  id: string
  pids: number[]
  popup?: true
  tabs?: string[]
  name?: string
  isDestroyed(): boolean
  getTitle(): string
  webContents: { getOSProcessId(): number; mainFrame: { framesInSubtree: { osProcessId: number }[] } }
}

/** A window whose renderer is `pids[0]` and whose frames run in all of `pids` (the main frame is in its own subtree). */
const win = (id: string, pids: number[], more: Partial<FakeWindow> = {}): FakeWindow => ({
  id,
  pids,
  isDestroyed: () => false,
  getTitle: () => `title ${id}`,
  webContents: { getOSProcessId: () => pids[0], mainFrame: { framesInSubtree: pids.map((osProcessId) => ({ osProcessId })) } },
  ...more,
})
const proc = (pid: number, type: string, mb: number): MeterProcess => ({ pid, type, memory: { workingSetSize: mb * 1024 } })

function setup(windows: FakeWindow[], metrics: MeterProcess[], helpers: number[] = []) {
  let t = 0
  const host: MemoryHost<FakeWindow> = {
    metrics: () => metrics,
    windows: () => windows,
    isPreview: (w) => w.popup === true,
    entryOf: (w) => ({ id: w.id, tabs: w.tabs ?? [], ...(w.name === undefined ? {} : { name: w.name }) }),
    jsHeap: async (w) => (w.id === 'a' ? 40 * MB : null),
    helperPids: () => helpers,
    rss: vi.fn(async (pids: readonly number[]) => pids.length * 300 * MB),
  }
  const meter = createMemoryMeter(host, () => t)
  return { meter, host, tick: (ms: number) => (t += ms), metrics }
}

describe('memory meter', () => {
  it('a window counts its renderer and its frame processes; preview popups and shared processes count once; the rest is App core', async () => {
    const a = win('a', [10, 11], { tabs: ['/v/a.md', '/v/b.md', '/v/c.excalidraw', '/v/d.drawio'], name: 'Writing' })
    const b = win('b', [20, 11]) // 11 already counted for `a`
    const popup = win('popup', [10], { popup: true })
    const { meter } = setup([a, popup, b], [proc(1, 'Browser', 200), proc(2, 'GPU', 100), proc(3, 'Utility', 30), proc(10, 'Tab', 300), proc(11, 'Tab', 150), proc(20, 'Tab', 500), proc(30, 'Tab', 50)])
    const report = await meter.report()
    expect(report.windows).toEqual([
      { id: 'b', title: 'title b', open: '', bytes: 500 * MB, jsHeapBytes: null, grew: false },
      { id: 'a', title: 'Writing', open: '2 notes, 1 drawing, 1 diagram', bytes: 450 * MB, jsHeapBytes: 40 * MB, grew: false },
    ])
    expect(report.core).toEqual({ bytes: 380 * MB, main: 200 * MB, gpu: 100 * MB, utility: 30 * MB, other: 50 * MB })
    expect(report.helpers).toBeNull()
  })

  it('keeps 240 samples per window, 30 s apart, and drops them when the window closes', () => {
    const { meter, tick } = setup([win('a', [10])], [proc(10, 'Tab', 100)])
    for (let i = 0; i < HISTORY + 5; i++) {
      meter.sample()
      tick(MEMORY_SAMPLE_MS)
    }
    const ring = meter.history('a')
    expect(ring).toHaveLength(HISTORY)
    expect(ring[0].t).toBe(5 * MEMORY_SAMPLE_MS)
    meter.forget('a')
    expect(meter.history('a')).toEqual([])
  })

  it('grew (▲): more than 150 MB or 20 % over the newest sample at least 1 h old; never in the first hour', async () => {
    const ring = [{ t: 0, bytes: 1000 * MB }]
    expect(grewSince(ring, 1151 * MB, GREW_SPAN_MS)).toBe(true) // +151 MB, +15 %
    expect(grewSince(ring, 1149 * MB, GREW_SPAN_MS)).toBe(false)
    expect(grewSince([{ t: 0, bytes: 500 * MB }], 601 * MB, GREW_SPAN_MS)).toBe(true) // +101 MB, +20.2 %
    expect(grewSince(ring, 5000 * MB, GREW_SPAN_MS - 1)).toBe(false) // not 1 h old yet

    // Through the report: the window grows from 300 MB to 700 MB over an hour.
    const { meter, tick, metrics } = setup([win('a', [10])], [proc(10, 'Tab', 300)])
    meter.sample()
    tick(GREW_SPAN_MS / 2)
    metrics[0] = proc(10, 'Tab', 700)
    expect((await meter.report()).windows[0].grew).toBe(false)
    tick(GREW_SPAN_MS / 2)
    expect((await meter.report()).windows[0].grew).toBe(true)
  })

  it('Code helpers: one row from ps while a helper runs, none without', async () => {
    const { meter, host } = setup([], [], [41, -1, 42])
    expect((await meter.report()).helpers).toEqual({ bytes: 600 * MB, count: 2 })
    expect(host.rss).toHaveBeenCalledExactlyOnceWith([41, 42])
    const none = setup([], [])
    expect((await none.meter.report()).helpers).toBeNull()
    expect(none.host.rss).not.toHaveBeenCalled()
  })

  it('helperRss reads ps: this process counts, a PID that is gone counts 0', async () => {
    expect(await helperRss([process.pid])).toBeGreaterThan(10 * MB)
    expect(await helperRss([99_998_765])).toBe(0)
  })

  it('openText names what a window has open', () => {
    expect(openText(['/v/a.pdf', '/v/b.png', '/v/c.ts', '/v/d.ts', '/v/e.unknownext'])).toBe('1 PDF, 1 image, 2 text files, 1 other file')
    expect(openText([])).toBe('')
  })
})
