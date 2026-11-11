/**
 * THE BOARD WINDOW (YAZ-4824) in jsdom: the pan/zoom math, every gesture and state, the writes and the host's updates.
 * The picture source is a stand-in (`boardPictures.ts` has its own tests): a 1000 × 500 board at the origin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type WatchEvent } from '@shared/types'
import type { EmbedOptions } from '@shared/embedOptions'
import { storage } from '../../lib/storage'
import type { BoardPicture } from './boardPictures'
import type { BoardWindowHandle, BoardWindowHost } from './types'

const pictures = vi.hoisted(() => ({
  listeners: [] as Array<{ path: string | null; fn: (ev: WatchEvent) => void }>,
  picture: null as unknown as BoardPicture,
}))

vi.mock('./boardPictures', () => ({
  loadPicture: vi.fn(async () => pictures.picture),
  currentKey: vi.fn(() => pictures.picture.key),
  peekPicture: vi.fn(() => pictures.picture),
  watchBoard: vi.fn((_root: string, path: string | null, _name: string, fn: (ev: WatchEvent) => void) => {
    const entry = { path, fn }
    pictures.listeners.push(entry)
    return () => pictures.listeners.splice(pictures.listeners.indexOf(entry), 1)
  }),
}))

import { currentKey, loadPicture } from './boardPictures'
import { clampZoom, fitView, mountBoardWindow, panBy, resizeBy, sharedCounts, zoomAt } from './boardWindow'

/** One fake IntersectionObserver per mount round: the test says which window is near. */
const observers: FakeObserver[] = []
class FakeObserver {
  targets = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
}
function setNear(dom: Element, on: boolean): void {
  const io = observers[observers.length - 1]
  io.callback([{ target: dom, isIntersecting: on } as IntersectionObserverEntry], io as unknown as IntersectionObserver)
}

const BOARD: BoardPicture = { key: 'k1', url: 'blob:board', bounds: { x: 0, y: 0, width: 1000, height: 500 }, pages: [], page: null, frames: [], bytes: 10 }
const opts = (over: Partial<EmbedOptions> = {}): EmbedOptions => ({ width: 400, height: 200, view: null, locked: false, page: null, rest: [], ...over })

let mounted: BoardWindowHandle[] = []
function mount(over: Partial<BoardWindowHost> = {}, near = true) {
  const onOptions = vi.fn()
  const onOpen = vi.fn()
  const onSelect = vi.fn()
  const win = mountBoardWindow({
    ref: { root: '/v', path: 'Board.excalidraw', kind: 'drawing', name: 'Board', vault: null },
    options: opts(),
    editable: true,
    columnWidth: () => 700,
    onOptions,
    onOpen,
    onSelect,
    ...over,
  })
  document.body.appendChild(win.dom)
  mounted.push(win)
  if (near) setNear(win.dom, true)
  return { win, onOptions, onOpen, onSelect }
}

/** The picture's promise, then the frame that paints it. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20)
}

/** The transform's translate and scale, as numbers. */
function transformOf(win: BoardWindowHandle): { tx: number; ty: number; zoom: number } {
  const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(win.dom.querySelector('img')!.style.transform)!
  return { tx: Number(m[1]), ty: Number(m[2]), zoom: Number(m[3]) }
}

function wheel(win: BoardWindowHandle, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, ...init })
  win.dom.dispatchEvent(ev)
  return ev
}

const mouse = (target: EventTarget, type: string, x: number, y: number, init: MouseEventInit = {}) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  vi.spyOn(storage, 'getSettings').mockReturnValue({ ...DEFAULT_SETTINGS, embedRestSeconds: 30 })
  pictures.picture = BOARD
  vi.mocked(loadPicture).mockClear()
})

afterEach(() => {
  mounted.forEach((w) => w.destroy())
  mounted.forEach((w) => w.dom.remove())
  mounted = []
  document.querySelectorAll('.board-window-overlay').forEach((o) => o.remove())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the pan and zoom math', () => {
  it('a zoom at a point keeps the board point under it; the limits hold', () => {
    const view = { x: 100, y: 50, zoom: 2 }
    const next = zoomAt(view, 120, 80, 1.5)
    // The board point under (120, 80) before and after.
    expect(view.x + 120 / view.zoom).toBeCloseTo(next.x + 120 / next.zoom, 10)
    expect(view.y + 80 / view.zoom).toBeCloseTo(next.y + 80 / next.zoom, 10)
    expect(next.zoom).toBe(3)
    expect(zoomAt(view, 0, 0, 1000).zoom).toBe(30)
    expect(zoomAt(view, 0, 0, 0.0001).zoom).toBe(0.1)
    expect(clampZoom(0.01)).toBe(0.1)
  })

  it('a fit shows the whole board with 10 px around, centred; a pan moves by the screen distance over the zoom', () => {
    const view = fitView({ x: 0, y: 0, width: 1000, height: 500 }, 400, 200)
    expect(view.zoom).toBeCloseTo(0.36, 10) // min(380/1000, 180/500)
    // The board's centre is the window's centre.
    expect(view.x + 200 / view.zoom).toBeCloseTo(500, 8)
    expect(view.y + 100 / view.zoom).toBeCloseTo(250, 8)
    expect(panBy({ x: 0, y: 0, zoom: 2 }, 10, -20)).toEqual({ x: 5, y: -10, zoom: 2 })
  })

  it('a resize is free in width and height; Shift on a corner keeps the shape; the limits hold', () => {
    expect(resizeBy({ width: 400, height: 200 }, 'se', 50, 20, false, 700)).toEqual({ width: 450, height: 220 })
    expect(resizeBy({ width: 400, height: 200 }, 'se', 100, 0, true, 700)).toEqual({ width: 500, height: 250 })
    expect(resizeBy({ width: 400, height: 200 }, 'nw', 100, 0, true, 700)).toEqual({ width: 300, height: 150 })
    expect(resizeBy({ width: 400, height: 200 }, 'e', 900, 0, false, 700)).toEqual({ width: 700, height: 200 })
    expect(resizeBy({ width: 400, height: 200 }, 'sw', 900, -900, false, 700)).toEqual({ width: 120, height: 80 })
  })
})

describe('the window', () => {
  it('shows the picture fitted, moved by a transform; no view written until a gesture', async () => {
    const { win, onOptions } = mount()
    await settle()
    expect(win.dom.classList.contains('board-window--ready')).toBe(true)
    expect(win.dom.style.width).toBe('400px')
    expect(win.dom.querySelector('img')!.getAttribute('src')).toBe('blob:board')
    expect(transformOf(win).zoom).toBeCloseTo(0.36, 6)
    expect(onOptions).not.toHaveBeenCalled()
  })

  it('a window off screen asks no picture; it asks when it comes near', async () => {
    const { win } = mount({}, false)
    await settle()
    expect(loadPicture).not.toHaveBeenCalled()
    expect(win.dom.classList.contains('board-window--loading')).toBe(true)
    setNear(win.dom, true)
    await settle()
    expect(loadPicture).toHaveBeenCalledTimes(1)
  })

  it('the wheel pans; 800 ms after the last wheel, ONE write of the rounded view', async () => {
    const { win, onOptions } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(true)
    wheel(win, { deltaX: 10.4, deltaY: 30 })
    await settle()
    expect(transformOf(win)).toEqual({ tx: -10.4, ty: -60, zoom: 1 })
    vi.advanceTimersByTime(700)
    expect(onOptions).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onOptions).toHaveBeenCalledTimes(1)
    expect(onOptions.mock.calls[0][0]).toMatchObject({ width: 400, height: 200, view: { x: 10, y: 60, zoom: 1 } })
  })

  it('⌘ or ctrl + wheel (a pinch) zooms at the pointer; the board point under it stays', async () => {
    const { win, onOptions } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    wheel(win, { deltaY: -10, ctrlKey: true, clientX: 100, clientY: 50 })
    vi.advanceTimersByTime(800)
    const view = onOptions.mock.calls[0][0].view
    expect(view.zoom).toBeCloseTo(Math.exp(0.1), 2)
    // Board point (100, 50) stays at window point (100, 50), within the write's rounding.
    expect(Math.abs((100 - view.x) * view.zoom - 100)).toBeLessThan(1)
  })

  it('the scroll guard: for 300 ms after a page scroll the wheel goes to the page', async () => {
    const { win } = mount()
    await settle()
    document.dispatchEvent(new Event('scroll'))
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(false)
    vi.advanceTimersByTime(301)
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(true)
  })

  it('Resting: after the setting`s time the wheel goes to the page; a click wakes it; Never never rests', async () => {
    vi.mocked(storage.getSettings).mockReturnValue({ ...DEFAULT_SETTINGS, embedRestSeconds: 10 })
    const { win, onOptions } = mount()
    await settle()
    vi.advanceTimersByTime(10_000)
    expect(win.dom.classList.contains('board-window--resting')).toBe(true)
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(false)
    mouse(win.dom.querySelector('.board-window__stage')!, 'mousedown', 5, 5)
    mouse(document, 'mouseup', 5, 5)
    expect(win.dom.classList.contains('board-window--resting')).toBe(false)
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(true)
    // Resting is never written.
    vi.advanceTimersByTime(800)
    expect(onOptions.mock.calls.every(([o]) => !('resting' in o))).toBe(true)

    vi.mocked(storage.getSettings).mockReturnValue({ ...DEFAULT_SETTINGS, embedRestSeconds: 0 })
    const never = mount().win
    await settle()
    vi.advanceTimersByTime(3_600_000)
    expect(never.dom.classList.contains('board-window--resting')).toBe(false)
  })

  it('Locked: the lock button writes `locked`, and nothing moves it until it is unlocked', async () => {
    const { win, onOptions } = mount()
    await settle()
    const lock = win.dom.querySelector<HTMLButtonElement>('.board-window__lock')!
    lock.click()
    expect(onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ locked: true }))
    expect(lock.getAttribute('aria-label')).toBe('Unlock view')
    expect(lock.querySelector('svg')).not.toBeNull()
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(false)
    const before = transformOf(win)
    mouse(win.dom.querySelector('.board-window__stage')!, 'mousedown', 5, 5)
    mouse(document, 'mousemove', 60, 60)
    mouse(document, 'mouseup', 60, 60)
    await settle()
    expect(transformOf(win)).toEqual(before)
    expect(win.menuRows().find((r) => r.label === 'Unlock view')).toBeDefined()
    lock.click()
    expect(onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ locked: false }))
  })

  it('a drag pans; a click without a move selects the embed', async () => {
    const { win, onOptions, onSelect } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    const stage = win.dom.querySelector('.board-window__stage')!
    mouse(stage, 'mousedown', 100, 100)
    mouse(document, 'mousemove', 80, 70)
    mouse(document, 'mouseup', 80, 70)
    vi.advanceTimersByTime(800)
    expect(onOptions).toHaveBeenCalledWith(expect.objectContaining({ view: { x: 20, y: 30, zoom: 1 } }))
    expect(onSelect).not.toHaveBeenCalled()
    mouse(stage, 'mousedown', 10, 10)
    mouse(document, 'mouseup', 11, 10)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(win.dom.classList.contains('is-selected')).toBe(true)
  })

  it('a resize with and without Shift: one write on mouseup; the view stays; Escape mid-drag cancels', async () => {
    const view = { x: 5, y: 6, zoom: 0.5 }
    const { win, onOptions } = mount({ options: opts({ view }) })
    await settle()
    win.setSelected(true)
    const se = win.dom.querySelector('[data-handle="se"]')!
    mouse(se, 'mousedown', 0, 0)
    mouse(document, 'mousemove', 50, 20)
    mouse(document, 'mousemove', 60, 30)
    expect(onOptions).not.toHaveBeenCalled()
    mouse(document, 'mouseup', 60, 30)
    expect(onOptions).toHaveBeenCalledTimes(1)
    expect(onOptions.mock.calls[0][0]).toMatchObject({ width: 460, height: 230, view })

    mouse(se, 'mousedown', 0, 0)
    mouse(document, 'mousemove', 92, 0, { shiftKey: true })
    mouse(document, 'mouseup', 92, 0, { shiftKey: true })
    expect(onOptions.mock.calls[1][0]).toMatchObject({ width: 552, height: 276 })

    mouse(se, 'mousedown', 0, 0)
    mouse(document, 'mousemove', 40, 40)
    expect(win.dom.style.width).toBe('592px')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(win.dom.style.width).toBe('552px')
    mouse(document, 'mouseup', 40, 40)
    expect(onOptions).toHaveBeenCalledTimes(2)
  })

  it('the write threshold: a move of 4 px or less writes nothing', async () => {
    const { win, onOptions } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    wheel(win, { deltaY: 3 })
    vi.advanceTimersByTime(800)
    expect(onOptions).not.toHaveBeenCalled()
    wheel(win, { deltaY: 3 }) // 6 px from what the text holds
    vi.advanceTimersByTime(800)
    expect(onOptions).toHaveBeenCalledTimes(1)
  })

  it('item 17: an update of the options while a gesture runs waits; our write supersedes it; with no write it applies after', async () => {
    const { win, onOptions } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    wheel(win, { deltaY: 40 })
    win.update({ options: opts({ width: 300, view: { x: 500, y: 500, zoom: 2 } }) })
    expect(win.dom.style.width).toBe('400px')
    vi.advanceTimersByTime(800)
    expect(onOptions).toHaveBeenCalledWith(expect.objectContaining({ width: 400, view: { x: 0, y: 40, zoom: 1 } }))
    expect(win.dom.style.width).toBe('400px')
    // The host's echo of our write changes nothing.
    win.update({ options: onOptions.mock.calls[0][0] })
    expect(win.dom.style.width).toBe('400px')
    // A tiny move writes nothing: the update that came meanwhile applies once the wait ends.
    wheel(win, { deltaY: 1 })
    win.update({ options: opts({ width: 300, view: { x: 0, y: 40, zoom: 1 } }) })
    expect(win.dom.style.width).toBe('400px')
    vi.advanceTimersByTime(800)
    expect(onOptions).toHaveBeenCalledTimes(1)
    expect(win.dom.style.width).toBe('300px')
  })

  it('read-only (item 24): pan, zoom and the lock work in memory; nothing is written; no handles', async () => {
    const { win, onOptions } = mount({ editable: false })
    await settle()
    expect(win.dom.classList.contains('board-window--readonly')).toBe(true)
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(true)
    wheel(win, { deltaY: -10, metaKey: true })
    win.dom.querySelector<HTMLButtonElement>('.board-window__lock')!.click()
    expect(win.dom.classList.contains('board-window--locked')).toBe(true)
    win.setSelected(true)
    mouse(win.dom.querySelector('[data-handle="se"]')!, 'mousedown', 0, 0)
    mouse(document, 'mousemove', 50, 50)
    mouse(document, 'mouseup', 50, 50)
    vi.advanceTimersByTime(2000)
    expect(onOptions).not.toHaveBeenCalled()
    expect(win.dom.style.width).toBe('400px')
  })

  it('keys while selected: ⌘+ ⌘− ⌘0 Shift+1 act and stop; not selected, ⌘+ stays the note`s; Escape deselects (item 20)', async () => {
    const { win, onOptions } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    const key = (init: KeyboardEventInit) => {
      const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      win.dom.dispatchEvent(ev)
      return ev
    }
    expect(key({ key: '=', metaKey: true }).defaultPrevented).toBe(false)
    win.setSelected(true)
    expect(key({ key: '=', metaKey: true }).defaultPrevented).toBe(true)
    vi.advanceTimersByTime(800)
    expect(onOptions.mock.calls[0][0].view.zoom).toBe(1.1)
    key({ key: '0', metaKey: true })
    vi.advanceTimersByTime(800)
    expect(onOptions.mock.calls[1][0].view.zoom).toBe(1)
    key({ key: '!', code: 'Digit1', shiftKey: true })
    // A fit writes no view: the text says "fit".
    expect(onOptions.mock.calls[2][0].view).toBeNull()
    expect(key({ key: 'a' }).defaultPrevented).toBe(false)
    const esc = key({ key: 'Escape' })
    expect(esc.defaultPrevented).toBe(true)
    expect(win.dom.classList.contains('is-selected')).toBe(false)
  })

  it('double-click opens in this tab, ⌘ double-click a background tab; the name pill and the zoom % do the same (items 6, 7)', async () => {
    const { win, onOpen, onOptions } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    const stage = win.dom.querySelector('.board-window__stage')!
    mouse(stage, 'dblclick', 0, 0)
    mouse(stage, 'dblclick', 0, 0, { metaKey: true })
    expect(onOpen.mock.calls).toEqual([['thisTab'], ['backgroundTab']])
    const pill = win.dom.querySelector<HTMLButtonElement>('.board-window__pill')!
    expect(pill.textContent).toBe('Board')
    pill.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    expect(onOpen).toHaveBeenLastCalledWith('backgroundTab')
    const zoom = win.dom.querySelector<HTMLButtonElement>('.board-window__zoom')!
    expect(zoom.textContent).toBe('100%')
    zoom.click()
    expect(onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ view: null }))
  })

  it('missing (item 22): no path, or a failed load, says "Missing …" at the same size; the file`s return brings it back', async () => {
    const { win } = mount({ ref: { root: '/v', path: null, kind: 'diagram', name: 'Cloud', vault: null } })
    await settle()
    expect(win.dom.textContent).toContain('Missing diagram: Cloud')
    expect(win.dom.style.height).toBe('200px')
    // The file comes back under its name.
    pictures.listeners.find((l) => l.path === null)!.fn({ type: 'add', path: '/v/Cloud.drawio', mtime: 5 })
    await vi.advanceTimersByTimeAsync(300)
    await settle()
    expect(win.dom.classList.contains('board-window--ready')).toBe(true)

    vi.mocked(loadPicture).mockResolvedValueOnce(null)
    const gone = mount().win
    await settle()
    expect(gone.dom.textContent).toContain('Missing drawing: Board')
  })

  it('D5: a change of the file refreshes only a window near the screen, 300 ms after the last change; the other when it comes near', async () => {
    const a = mount().win
    const b = mount({}, false).win
    await settle()
    expect(loadPicture).toHaveBeenCalledTimes(1)
    for (const l of [...pictures.listeners]) l.fn({ type: 'change', path: '/v/Board.excalidraw', mtime: 9 })
    await vi.advanceTimersByTimeAsync(200)
    for (const l of [...pictures.listeners]) l.fn({ type: 'change', path: '/v/Board.excalidraw', mtime: 10 })
    await vi.advanceTimersByTimeAsync(200)
    expect(loadPicture).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(150)
    expect(loadPicture).toHaveBeenCalledTimes(2) // a only
    setNear(b.dom, true)
    await settle()
    expect(loadPicture).toHaveBeenCalledTimes(3)
    expect(a.dom.classList.contains('board-window--ready') && b.dom.classList.contains('board-window--ready')).toBe(true)
  })

  it('item 13: a theme flip gives a new key, and the window swaps its picture; the same key asks nothing', async () => {
    const { win } = mount()
    await settle()
    expect(loadPicture).toHaveBeenCalledTimes(1)
    document.documentElement.dataset.theme = 'light'
    await settle()
    expect(loadPicture).toHaveBeenCalledTimes(1)
    pictures.picture = { ...BOARD, key: 'k-dark', url: 'blob:dark' }
    document.documentElement.dataset.theme = 'dark'
    await settle()
    expect(loadPicture).toHaveBeenCalledTimes(2)
    expect(win.dom.querySelector('img')!.getAttribute('src')).toBe('blob:dark')
    delete document.documentElement.dataset.theme
    vi.mocked(currentKey).mockClear()
  })

  it('a new embed (no options): the column`s width, the height from the board`s shape, 160 to 480; nothing written', async () => {
    const { win, onOptions } = mount({ options: null })
    await settle()
    expect(win.dom.style.width).toBe('700px')
    expect(win.dom.style.height).toBe('350px') // 700 × 500/1000
    expect(onOptions).not.toHaveBeenCalled()
  })

  it('menu rows: Fit, Lock, Page ▸ with the current page checked (a page write resets the view), View full size', async () => {
    pictures.picture = { ...BOARD, pages: [{ id: 'p0', name: 'Overview' }, { id: 'p1', name: 'Detail' }], page: 'p0' }
    const { win, onOptions } = mount({ ref: { root: '/v', path: 'C.drawio', kind: 'diagram', name: 'C', vault: 'Other' }, options: opts({ page: 'gone', view: { x: 1, y: 2, zoom: 1 } }) })
    await settle()
    const rows = win.menuRows()
    expect(rows.map((r) => r.label)).toEqual(['Fit diagram to frame', 'Lock view', 'Page', 'View full size'])
    expect(rows[2].children!.map((c) => [c.label, c.checked])).toEqual([
      ['Overview', true],
      ['Detail', false],
    ])
    rows[2].children![1].run()
    expect(onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 'p1', view: null }))
    expect(win.dom.querySelector('.board-window__vault')!.textContent).toBe('(Other)')
  })

  it('Frame ▸ fits the view to that frame (item 1)', async () => {
    pictures.picture = { ...BOARD, frames: [{ id: 'f', name: 'Top', x: 100, y: 100, width: 380, height: 180 }] }
    const { win, onOptions } = mount()
    await settle()
    const frame = win.menuRows().find((r) => r.label === 'Frame')!
    frame.children![0].run()
    expect(onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ view: { x: 90, y: 90, zoom: 1 } })) // the frame, with the fit`s 10 px around
  })

  it('View full size (item 4): a second window over the note at the same view; Esc closes it and focus comes back', async () => {
    const { win } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    win.setSelected(true)
    win.menuRows().find((r) => r.label === 'View full size')!.run()
    await settle()
    const overlay = document.querySelector('.board-window-overlay')!
    const inner = overlay.querySelector<HTMLElement>('.board-window--full')!
    expect(inner.querySelector('img')!.getAttribute('src')).toBe('blob:board')
    expect(inner.classList.contains('board-window--readonly')).toBe(true)
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.querySelector('.board-window-overlay')).toBeNull()
    expect(document.activeElement).toBe(win.dom)
  })

  it('fold (D13): the arrow shows when foldable; folded, the picture goes and the pill line shows; its arrow calls onFold', async () => {
    const onFold = vi.fn()
    const { win } = mount({ onFold })
    await settle()
    win.setFoldable(true)
    expect(win.dom.classList.contains('board-window--foldable')).toBe(true)
    win.setFolded(true)
    expect(win.dom.querySelector('img')).toBeNull()
    expect(win.dom.textContent).toBe('Board')
    win.dom.querySelector<HTMLButtonElement>('.board-window__unfold')!.click()
    expect(onFold).toHaveBeenCalledTimes(1)
    win.setFolded(false)
    await settle()
    expect(win.dom.querySelector('img')!.getAttribute('src')).toBe('blob:board')
  })

  it('destroy ends every timer and listener; the shared observer goes with the last window', async () => {
    const a = mount().win
    const b = mount().win
    await settle()
    expect(sharedCounts()).toEqual({ windows: 2, observer: true })
    a.destroy()
    b.destroy()
    expect(sharedCounts()).toEqual({ windows: 0, observer: false })
    expect(pictures.listeners).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
