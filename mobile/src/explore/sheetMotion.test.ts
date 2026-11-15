// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sheetMotion, type SheetParts } from './sheetMotion'

/**
 * YAZ-5472, THE SMOOTHNESS PROOF: a drag of 300 finger moves (three for each frame, as a 120 Hz finger on a 60 Hz
 * screen, or a slow frame, gives) over a sheet. It counts every style write (each is a `style` attribute mutation) and
 * every layout read the browser would have to answer at once (`getBoundingClientRect`, `offsetHeight`, `scrollTop`,
 * `getComputedStyle`, `innerHeight` and the rest), from the finger's first move to its lift:
 *  - a finger's move writes NOTHING (it only notes where the sheet goes);
 *  - each frame writes ONE transform on the sheet and ONE opacity on its dim, and nothing else;
 *  - there is NO layout read in the loop.
 */

const READS: [object, string, 'get' | 'value'][] = [
  [Element.prototype, 'getBoundingClientRect', 'value'],
  [Element.prototype, 'getClientRects', 'value'],
  [Element.prototype, 'scrollTop', 'get'],
  [Element.prototype, 'scrollHeight', 'get'],
  [Element.prototype, 'clientHeight', 'get'],
  [Element.prototype, 'clientWidth', 'get'],
  [HTMLElement.prototype, 'offsetHeight', 'get'],
  [HTMLElement.prototype, 'offsetWidth', 'get'],
  [HTMLElement.prototype, 'offsetTop', 'get'],
  [HTMLElement.prototype, 'offsetLeft', 'get'],
  [window, 'getComputedStyle', 'value'],
  [window, 'innerHeight', 'get'],
  [window, 'innerWidth', 'get'],
]

let reads: string[] = []
let restore: (() => void)[] = []
function watchReads() {
  for (const [owner, name, kind] of READS) {
    const own = Object.getOwnPropertyDescriptor(owner, name)
    const where = own !== undefined ? owner : Object.getPrototypeOf(owner)
    const desc = Object.getOwnPropertyDescriptor(where, name)
    if (desc === undefined) continue
    if (kind === 'get' && desc.get !== undefined) {
      const get = desc.get
      Object.defineProperty(owner, name, { ...desc, configurable: true, get(this: unknown) { reads.push(name); return get.call(this) } })
    } else if (kind === 'value' && typeof desc.value === 'function') {
      const fn = desc.value as (...a: unknown[]) => unknown
      Object.defineProperty(owner, name, { ...desc, configurable: true, value(this: unknown, ...a: unknown[]) { reads.push(name); return fn.apply(this, a) } })
    }
    restore.push(() => (own === undefined ? delete (owner as Record<string, unknown>)[name] : Object.defineProperty(owner, name, own)))
  }
}

function parts(): SheetParts {
  const dim = document.createElement('div')
  const box = document.createElement('div')
  const head = document.createElement('div')
  const body = document.createElement('div')
  const top = document.createElement('div')
  body.append(top, Object.assign(document.createElement('p'), { textContent: 'A page.' }))
  box.append(head, body)
  document.body.append(dim, box)
  return { box, head, body, top, dim }
}

function touch(el: HTMLElement, type: string, x: number, y: number, t: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  Object.defineProperty(e, 'timeStamp', { value: t })
  el.dispatchEvent(e)
  return e
}

function pointer(el: HTMLElement, type: string, x: number, y: number, t: number): void {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, { pointerId: 1, button: 0, clientX: x, clientY: y })
  Object.defineProperty(e, 'timeStamp', { value: t })
  el.dispatchEvent(e)
}

/** Every `style` write on each element, as the browser would see them. */
function watchWrites(els: Record<string, HTMLElement>) {
  const writes: string[] = []
  const observer = new MutationObserver((records) => {
    for (const r of records) writes.push(Object.entries(els).find(([, el]) => el === r.target)?.[0] ?? 'other')
  })
  for (const el of Object.values(els)) observer.observe(el, { attributes: true, attributeFilter: ['style'] })
  return { take: () => [...writes.splice(0), ...observer.takeRecords().map((r) => Object.entries(els).find(([, el]) => el === r.target)?.[0] ?? 'other')] }
}

let frames: (() => void)[] = []
const frame = (draw: () => void) => frames.push(draw)
const runFrame = () => {
  const now = frames.splice(0)
  for (const draw of now) draw()
  return now.length
}

beforeEach(() => {
  reads = []
  restore = []
  frames = []
  document.body.replaceChildren()
})
afterEach(() => {
  for (const r of restore.reverse()) r()
})

describe('a sheet drag is drawn once a frame, with no layout read (YAZ-5472)', () => {
  it('300 moves from the body at its top: no write in a move, one transform and one opacity a frame, no layout read', () => {
    const p = parts()
    const closed = vi.fn()
    const m = sheetMotion(p, { onClosed: closed, edge: false, still: () => false, frame, cancelFrame: () => undefined })
    const writes = watchWrites({ box: p.box, dim: p.dim })
    touch(p.body, 'touchstart', 100, 200, 0)
    writes.take()
    watchReads()
    // The watch sees a read (and a write) when one is made.
    void p.body.scrollTop
    void p.box.getBoundingClientRect()
    void window.innerHeight
    expect(reads).toEqual(['scrollTop', 'getBoundingClientRect', 'innerHeight'])
    reads = []
    p.box.style.opacity = '1'
    expect(writes.take()).toEqual(['box'])
    p.box.style.opacity = ''
    writes.take()
    let claimed = 0
    let frameCount = 0
    const perFrame: string[][] = []
    for (let i = 1; i <= 300; i++) {
      const e = touch(p.body, 'touchmove', 100, 200 + i, i * 4)
      if (e.defaultPrevented) claimed++
      // A finger's move alone writes nothing.
      expect(writes.take()).toEqual([])
      if (i % 3 === 0) {
        frameCount += runFrame()
        perFrame.push(writes.take())
      }
    }
    expect(reads).toEqual([])
    // The first moves decide (6 px); every move after is the drag's, and the body does not scroll.
    expect(claimed).toBe(300 - 5)
    expect(frameCount).toBeGreaterThanOrEqual(98)
    expect(frameCount).toBeLessThanOrEqual(100)
    for (const w of perFrame.filter((f) => f.length > 0)) expect(w.sort()).toEqual(['box', 'dim'])
    expect(p.box.style.transform).toBe('translate3d(0px, 300px, 0)')
    expect(Number(p.dim.style.opacity)).toBeCloseTo(1 - 300 / window.innerHeight, 3)
    for (const r of restore.reverse()) r()
    restore = []
    touch(p.body, 'touchend', 100, 500, 1210)
    expect(closed).toHaveBeenCalledTimes(1)
    m.destroy()
  })

  it('the same from the head (Pointer Events): no write in a move, one pair a frame, no layout read', () => {
    const p = parts()
    const m = sheetMotion(p, { onClosed: () => undefined, edge: false, still: () => false, frame, cancelFrame: () => undefined })
    const writes = watchWrites({ box: p.box, dim: p.dim })
    pointer(p.head, 'pointerdown', 100, 60, 0)
    watchReads()
    for (let i = 1; i <= 120; i++) {
      pointer(p.head, 'pointermove', 100, 60 + i * 2, i * 4)
      expect(writes.take()).toEqual([])
      if (i % 3 === 0) {
        runFrame()
        const w = writes.take()
        if (w.length > 0) expect(w.sort()).toEqual(['box', 'dim'])
      }
    }
    expect(reads).toEqual([])
    m.destroy()
  })

  it('a scroll of the body is never touched: no claim, no write', () => {
    const p = parts()
    const m = sheetMotion(p, { onClosed: () => undefined, edge: false, still: () => false, frame, cancelFrame: () => undefined })
    const writes = watchWrites({ box: p.box, dim: p.dim })
    touch(p.body, 'touchstart', 100, 400, 0)
    for (let i = 1; i <= 60; i++) expect(touch(p.body, 'touchmove', 100, 400 - i * 3, i * 8).defaultPrevented).toBe(false)
    runFrame()
    expect(writes.take()).toEqual([])
    m.destroy()
  })
})
