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
  dropPicturesExcept: vi.fn(),
  watchBoard: vi.fn((_root: string, path: string | null, _name: string, fn: (ev: WatchEvent) => void) => {
    const entry = { path, fn }
    pictures.listeners.push(entry)
    return () => pictures.listeners.splice(pictures.listeners.indexOf(entry), 1)
  }),
}))

import { currentKey, dropPicturesExcept, loadPicture, peekPicture } from './boardPictures'
import { clampZoom, fitView, mountBoardWindow, panBy, resizeBy, sharedCounts, sweepPictures, WRITE_DELAY_MS, zoomAt } from './boardWindow'

/** One fake IntersectionObserver per mount round: the test says which window is near. */
const observers: FakeObserver[] = []
class FakeObserver {
  targets = new Set<Element>()
  disconnected = false
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
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
    this.disconnected = true
  }
}
function setNear(dom: Element, on: boolean): void {
  const io = observers.find((o) => o.targets.has(dom))!
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
    // Locked first (YAZ-2571 round 7); a click unlocks it for this view.
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(false)
    win.dom.querySelector<HTMLButtonElement>('.board-window__lock')!.click()
    expect(win.dom.classList.contains('board-window--locked')).toBe(false)
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(true)
    wheel(win, { deltaY: -10, metaKey: true })
    win.setSelected(true)
    mouse(win.dom.querySelector('[data-handle="se"]')!, 'mousedown', 0, 0)
    mouse(document, 'mousemove', 50, 50)
    mouse(document, 'mouseup', 50, 50)
    vi.advanceTimersByTime(2000)
    expect(onOptions).not.toHaveBeenCalled()
    expect(win.dom.style.width).toBe('400px')
  })

  it('a new embed (`|locked`, no size, YAZ-2571 round 7) starts locked at the column`s width; one click unlocks and writes', async () => {
    const { win, onOptions } = mount({ options: { width: null, height: null, view: null, locked: true, page: null, rest: [] } })
    await settle()
    expect(win.dom.classList.contains('board-window--locked')).toBe(true)
    expect(win.dom.style.width).toBe('700px')
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(onOptions).not.toHaveBeenCalled()
    win.dom.querySelector<HTMLButtonElement>('.board-window__lock')!.click()
    expect(win.dom.classList.contains('board-window--locked')).toBe(false)
    expect(onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ width: 700, locked: false }))
  })

  it('an old embed with no options stays unlocked (YAZ-2571 round 7), and showing it writes nothing', async () => {
    const { win, onOptions } = mount({ options: null })
    await settle()
    expect(win.dom.classList.contains('board-window--locked')).toBe(false)
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(true)
    const saved = mount({ options: opts() }).win
    await settle()
    expect(saved.dom.classList.contains('board-window--locked')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(onOptions).toHaveBeenCalledTimes(1) // the wheel's own view write, nothing for the mount
  })

  it('read only and Explore (YAZ-2571 round 7): every embed shows locked, whatever the page saved; an unlock is this view`s only, never written', async () => {
    const { win, onOptions } = mount({ editable: false, options: opts({ locked: false }) })
    await settle()
    const lock = win.dom.querySelector<HTMLButtonElement>('.board-window__lock')!
    expect(win.dom.classList.contains('board-window--locked')).toBe(true)
    expect(lock.getAttribute('aria-label')).toBe('Unlock view')
    lock.click()
    expect(win.dom.classList.contains('board-window--locked')).toBe(false)
    expect(wheel(win, { deltaY: 30 }).defaultPrevented).toBe(true)
    // The page's text changes meanwhile (an outside edit): the view keeps its own lock.
    win.update({ options: opts({ width: 500, locked: true }) })
    vi.advanceTimersByTime(2000)
    expect(win.dom.style.width).toBe('500px')
    expect(win.dom.classList.contains('board-window--locked')).toBe(false)
    expect(onOptions).not.toHaveBeenCalled()
  })

  it('a page that turns read only locks its windows; editable again, the saved lock comes back and nothing is written', async () => {
    const open = mount({ options: opts({ locked: false }) })
    const shut = mount({ options: opts({ locked: true }) })
    await settle()
    for (const { win } of [open, shut]) {
      win.update({ editable: false })
      expect(win.dom.classList.contains('board-window--locked')).toBe(true)
      win.dom.querySelector<HTMLButtonElement>('.board-window__lock')!.click()
      expect(win.dom.classList.contains('board-window--locked')).toBe(false)
      win.update({ editable: true })
    }
    expect(open.win.dom.classList.contains('board-window--locked')).toBe(false)
    expect(shut.win.dom.classList.contains('board-window--locked')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(open.onOptions).not.toHaveBeenCalled()
    expect(shut.onOptions).not.toHaveBeenCalled()
  })

  it('YAZ-4942: a pan in a read-only page is never written, also when the page turns editable before its 800 ms write; a later write keeps the saved view', async () => {
    const saved = { x: 0, y: 0, zoom: 1 }
    const { win, onOptions } = mount({ editable: false, options: opts({ view: saved }) })
    await settle()
    const lock = () => win.dom.querySelector<HTMLButtonElement>('.board-window__lock')!
    lock().click() // this view's own unlock: never written
    expect(wheel(win, { deltaX: 120, deltaY: 300 }).defaultPrevented).toBe(true)
    // The page turns editable while the pan's write still waits.
    vi.advanceTimersByTime(WRITE_DELAY_MS - 100)
    win.update({ editable: true })
    vi.advanceTimersByTime(WRITE_DELAY_MS * 3)
    win.flush()
    expect(onOptions).not.toHaveBeenCalled()
    // A write the editable page makes later (the lock) carries the saved view, not the read-only pan.
    lock().click()
    expect(onOptions).toHaveBeenCalledTimes(1)
    expect(onOptions).toHaveBeenLastCalledWith(expect.objectContaining({ locked: true, view: saved }))
    // A pan made while editable is written, as before.
    lock().click()
    wheel(win, { deltaY: 300 })
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    expect(onOptions).toHaveBeenCalledTimes(3)
    expect(onOptions.mock.calls[2][0].view).not.toEqual(saved)
  })

  it('View full size of a read-only embed is not locked: it is there to look around in', async () => {
    const { win } = mount({ editable: false })
    await settle()
    win.menuRows().find((r) => r.label === 'View full size')!.run()
    await settle()
    const inner = document.querySelector<HTMLElement>('.board-window-overlay .board-window--full')!
    expect(inner.classList.contains('board-window--locked')).toBe(false)
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })

  it('keys while selected: ⌘+ ⌘− ⌘0 Shift+1 act and stop; not selected, ⌘+ stays the page`s; the host owns Escape (item 20)', async () => {
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
    // In a page the editor keeps the focus and hands the keys over (`handleKey`); Escape is the host's (it deselects).
    expect(win.handleKey(new KeyboardEvent('keydown', { key: '-', metaKey: true }))).toBe(true)
    expect(win.handleKey(new KeyboardEvent('keydown', { key: 'x' }))).toBe(false)
    expect(key({ key: 'Escape' }).defaultPrevented).toBe(false)
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

    vi.mocked(loadPicture).mockResolvedValueOnce('missing')
    const gone = mount().win
    await settle()
    expect(gone.dom.textContent).toContain('Missing drawing: Board')
    // A4: a file that is there but would not read or draw says so, not "Missing".
    vi.mocked(loadPicture).mockResolvedValueOnce('broken')
    const broken = mount().win
    await settle()
    expect(broken.dom.classList.contains('board-window--broken')).toBe(true)
    expect(broken.dom.querySelector('.board-window__message')!.textContent).toBe("Can't show drawing: Board")
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
    // A16: "Fit whole …", so "frame" means only the drawing's frames of "Frame ▸".
    expect(rows.map((r) => r.label)).toEqual(['Fit whole diagram', 'Lock view', 'Page', 'View full size'])
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

  it('View full size (item 4): a second window over the page at the same view; Esc closes it and focus comes back', async () => {
    const { win } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    win.setSelected(true)
    win.dom.focus() // what had the focus when the overlay opened gets it back
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

  it('A6: no stored size and no picture known yet: 16:9 of the column (no jump from 0), then ONE settle to the board`s shape', async () => {
    vi.mocked(peekPicture).mockReturnValueOnce(undefined)
    const { win, onOptions } = mount({ options: null })
    expect(win.dom.style.height).toBe('394px') // 700 × 9/16
    await settle()
    expect(win.dom.style.height).toBe('350px') // 700 × 500/1000
    // Another window of the same board drew it already: its shape at once.
    const known = mount({ options: null }).win
    expect(known.dom.style.height).toBe('350px')
    expect(onOptions).not.toHaveBeenCalled()
  })

  it('A7: Obsidian`s width alone (`|300`): that width, the height from the board`s shape; the first write keeps the width', async () => {
    const { win, onOptions } = mount({ options: opts({ width: 300, height: null }) })
    expect(win.dom.style.width).toBe('300px')
    expect(win.dom.style.height).toBe('160px') // 300 × 0.5 = 150, at least 160
    await settle()
    win.handleKey(new KeyboardEvent('keydown', { key: '=', metaKey: true }))
    vi.advanceTimersByTime(800)
    expect(onOptions.mock.calls[0][0]).toMatchObject({ width: 300, height: 160 })
  })

  it('A8: flush() writes a view still waiting for its 800 ms at once; with nothing waiting it writes nothing', async () => {
    const { win, onOptions } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    win.flush()
    expect(onOptions).not.toHaveBeenCalled()
    wheel(win, { deltaY: 30 })
    win.flush()
    expect(onOptions).toHaveBeenCalledTimes(1)
    expect(onOptions.mock.calls[0][0]).toMatchObject({ view: { x: 0, y: 30, zoom: 1 } })
    vi.advanceTimersByTime(1000)
    expect(onOptions).toHaveBeenCalledTimes(1)
  })

  it('A3: a press in a page never takes the focus (the editor keeps the caret); the full-size window does', async () => {
    const editor = document.createElement('div')
    editor.tabIndex = 0
    document.body.appendChild(editor)
    editor.focus()
    const { win } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    const stage = win.dom.querySelector('.board-window__stage')!
    mouse(stage, 'mousedown', 10, 10)
    mouse(document, 'mousemove', 60, 60)
    mouse(document, 'mouseup', 60, 60)
    expect(document.activeElement).toBe(editor)
    win.menuRows().find((r) => r.label === 'View full size')!.run()
    const inner = document.querySelector<HTMLElement>('.board-window--full')!
    expect(document.activeElement).toBe(inner)
    mouse(inner.querySelector('.board-window__stage')!, 'mousedown', 5, 5)
    mouse(document, 'mouseup', 5, 5)
    expect(document.activeElement).toBe(inner)
    editor.remove()
  })

  it('A28: a right-click selects the window first (the host`s onSelect), then its menu opens', async () => {
    const onContextMenu = vi.fn()
    const { win, onSelect } = mount({ onContextMenu })
    await settle()
    win.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(win.dom.classList.contains('is-selected')).toBe(true)
    expect(onSelect.mock.invocationCallOrder[0]).toBeLessThan(onContextMenu.mock.invocationCallOrder[0])
    // Already selected: no second select.
    win.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onContextMenu).toHaveBeenCalledTimes(2)
  })

  it('A23: a pan writes the zoom label only when its percent changes', async () => {
    const { win } = mount({ options: opts({ view: { x: 0, y: 0, zoom: 1 } }) })
    await settle()
    const zoom = win.dom.querySelector<HTMLButtonElement>('.board-window__zoom')!
    const writes = vi.spyOn(zoom, 'textContent', 'set')
    for (let i = 0; i < 5; i++) {
      wheel(win, { deltaY: 10 })
      await settle()
    }
    expect(writes).not.toHaveBeenCalled()
    wheel(win, { deltaY: 10, metaKey: true })
    await settle()
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('A5: the sleep`s sweep keeps the pictures that mounted windows show, and only those', async () => {
    mount()
    mount({ ref: { root: '/v', path: null, kind: 'drawing', name: 'Lost', vault: null } })
    await settle()
    sweepPictures()
    expect(dropPicturesExcept).toHaveBeenLastCalledWith(new Set(['k1']))
  })

  it('YAZ-4862: the observer`s root is the page`s scroll container: one observer per root, ended with its last window', async () => {
    const scroller = document.createElement('div')
    const a = mount({ scrollRoot: scroller }, false).win
    const b = mount({ scrollRoot: scroller }, false).win
    const viewport = mount({}, false).win
    const roots = observers.filter((o) => !o.disconnected)
    expect(roots.map((o) => o.options.root ?? null)).toEqual([scroller, null])
    expect(roots[0].options.rootMargin).toBe('100% 0px')
    expect([...roots[0].targets]).toEqual([a.dom, b.dom])
    a.destroy()
    expect(roots[0].disconnected).toBe(false)
    b.destroy()
    expect(roots[0].disconnected).toBe(true)
    expect(roots[1].targets.has(viewport.dom)).toBe(true)
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

describe('Explore`s board layer: fill mode (YAZ-4943)', () => {
  const SPOT = { x: 400, y: 200, width: 200, height: 100, inner: 'DNS basics', wiki: true }
  const layer = (over: Partial<BoardWindowHost> = {}) => {
    const onLink = vi.fn()
    const onPages = vi.fn()
    const made = mount({ editable: false, options: null, fill: true, columnWidth: () => 1000, onOptions: undefined, onOpen: undefined, onSelect: undefined, onLink, onPages, ...over })
    return { ...made, onLink, onPages }
  }

  it('fills its box (no px size), never locked although not editable, never rests; pan and zoom are free and nothing is written', async () => {
    const onOptions = vi.fn()
    const { win } = layer({ onOptions })
    await settle()
    expect(win.dom.classList.contains('board-window--fill')).toBe(true)
    expect([win.dom.style.width, win.dom.style.height]).toEqual(['', ''])
    expect(win.dom.classList.contains('board-window--locked')).toBe(false)
    const before = transformOf(win)
    vi.advanceTimersByTime(31_000)
    expect(win.dom.classList.contains('board-window--resting')).toBe(false)
    expect(wheel(win, { deltaY: 40 }).defaultPrevented).toBe(true)
    wheel(win, { deltaY: -10, ctrlKey: true, clientX: 100, clientY: 100 })
    mouse(win.dom, 'mousedown', 100, 100)
    mouse(document, 'mousemove', 150, 130)
    mouse(document, 'mouseup', 150, 130)
    await settle()
    expect(transformOf(win)).not.toEqual(before)
    // ⌘0 and Shift+1 work while it has the keyboard (the layer selects it).
    win.setSelected(true)
    win.dom.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true, cancelable: true }))
    await settle()
    expect(transformOf(win).zoom).toBe(1)
    vi.advanceTimersByTime(5_000)
    expect(onOptions).not.toHaveBeenCalled()
    // Escape is the layer's (it closes the layer): the window leaves it.
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    win.dom.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(false)
  })

  it('a click on a link spot opens it (with the keys held); a click elsewhere or a drag opens nothing', async () => {
    pictures.picture = { ...BOARD, links: [SPOT] }
    const { win, onLink } = layer()
    await settle()
    // Fitted: the board's centre (500, 250) is the window's centre (500, 240).
    mouse(win.dom, 'mousedown', 500, 240, { metaKey: true })
    mouse(document, 'mouseup', 500, 240)
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(onLink.mock.calls[0][0]).toEqual(SPOT)
    expect(onLink.mock.calls[0][1]).toMatchObject({ metaKey: true, altKey: false })
    mouse(win.dom, 'mousedown', 5, 5)
    mouse(document, 'mouseup', 5, 5)
    mouse(win.dom, 'mousedown', 500, 240)
    mouse(document, 'mousemove', 560, 260)
    mouse(document, 'mouseup', 560, 260)
    expect(onLink).toHaveBeenCalledTimes(1)
    // A pointer over a spot shows the hand.
    mouse(win.dom, 'mousemove', 500, 240)
    expect(win.dom.classList.contains('board-window--on-link')).toBe(true)
    mouse(win.dom, 'mousemove', 5, 5)
    expect(win.dom.classList.contains('board-window--on-link')).toBe(false)
  })

  it('a diagram tells the layer its pages and the page shown; showPage draws that page, fitted, and writes nothing', async () => {
    pictures.picture = { ...BOARD, pages: [{ id: 'p0', name: 'Overview' }, { id: 'p1', name: 'Detail' }], page: 'p0' }
    const onOptions = vi.fn()
    const { win, onPages } = layer({ ref: { root: '/v', path: 'C.drawio', kind: 'diagram', name: 'C', vault: null }, onOptions })
    await settle()
    expect(onPages).toHaveBeenLastCalledWith(pictures.picture.pages, 'p0')
    pictures.picture = { ...pictures.picture, key: 'k2', page: 'p1' }
    win.showPage('p1')
    await settle()
    expect(vi.mocked(loadPicture)).toHaveBeenLastCalledWith({ root: '/v', path: 'C.drawio' }, 'p1')
    expect(onPages).toHaveBeenLastCalledWith(pictures.picture.pages, 'p1')
    expect(onOptions).not.toHaveBeenCalled()
  })
})

describe('Explore`s board layer: a resize of the layer (YAZ-4944 Tile)', () => {
  it('a fitted board fits again when its box changes size (one observer, gone with the window); a board you moved keeps its view', async () => {
    const observed: Array<{ cb: () => void; disconnect: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn()
        constructor(cb: () => void) {
          observed.push({ cb, disconnect: this.disconnect })
        }
        observe() {}
      },
    )
    const { win } = mount({ editable: false, options: null, fill: true, columnWidth: () => 1000, onOptions: undefined })
    await settle()
    expect(observed).toHaveLength(1)
    const before = transformOf(win).zoom
    Object.defineProperty(win.dom, 'clientWidth', { value: 500, configurable: true })
    Object.defineProperty(win.dom, 'clientHeight', { value: 400, configurable: true })
    observed[0].cb()
    await settle()
    expect(transformOf(win).zoom).toBeCloseTo((500 - 20) / 1000, 6)
    expect(transformOf(win).zoom).not.toBeCloseTo(before, 3)
    wheel(win, { deltaY: 40 })
    await settle()
    const moved = transformOf(win)
    Object.defineProperty(win.dom, 'clientWidth', { value: 900, configurable: true })
    observed[0].cb()
    await settle()
    expect(transformOf(win)).toEqual(moved)
    win.destroy()
    expect(observed[0].disconnect).toHaveBeenCalled()
  })
})
