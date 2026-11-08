/**
 * The shared live gap (YAZ-4606 D58): the tab bar's part, glide and slide cancel, on both axes. jsdom has no layout:
 * each item is given its place in the layout and where it is drawn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { slotAt } from './dragSlot'
import { cancelSlides, drawnPlaces, glide, motionOff, partGap, partShift, partTransform, roomOf } from './liveGap'

/** A list from (100, 50); three items of 40 px with 10 px between, `data-live-item` k0…k2. */
function list(axis: 'x' | 'y') {
  const el = document.createElement('div')
  el.style.columnGap = '10px'
  el.style.rowGap = '10px'
  el.getBoundingClientRect = () => ({ left: 100, top: 50, right: 300, bottom: 250, width: 200, height: 200 }) as DOMRect
  const items = [0, 1, 2].map((i) => {
    const item = document.createElement('div')
    item.dataset.liveItem = `k${i}`
    const at = i * 50
    Object.defineProperties(item, axis === 'x' ? { offsetLeft: { value: at }, offsetWidth: { value: 40 } } : { offsetTop: { value: at }, offsetHeight: { value: 40 } })
    el.appendChild(item)
    return item
  })
  document.body.appendChild(el)
  return { el, items }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('slotAt on both axes (YAZ-4606)', () => {
  it('a horizontal list: the slot by each item\'s midpoint where the layout puts it', () => {
    const { el } = list('x')
    expect([110, 125, 160, 175, 240].map((x) => slotAt(el, x, 'x', '[data-live-item]'))).toEqual([0, 1, 1, 2, 3])
  })

  it('a vertical list reads y, and follows its own scroll', () => {
    const { el } = list('y')
    expect([60, 75, 110, 125, 190].map((y) => slotAt(el, y, 'y', '[data-live-item]'))).toEqual([0, 1, 1, 2, 3])
    Object.defineProperty(el, 'scrollTop', { value: 50 })
    expect([25, 60, 75].map((y) => slotAt(el, y, 'y', '[data-live-item]'))).toEqual([1, 1, 2])
  })
})

describe('the part (YAZ-3808 6A, shared by YAZ-4606)', () => {
  it('the room is the item\'s size and the list\'s gap, on its axis', () => {
    expect(roomOf(list('x').items[0], document.body.firstElementChild as HTMLElement, 'x')).toBe(50)
    document.body.innerHTML = ''
    const { el, items } = list('y')
    expect(roomOf(items[1], el, 'y')).toBe(50)
  })

  it('no gap next to the grabbed item; the items between the grab and the slot slide toward the grab by one room', () => {
    expect([0, 1, 2, null].map((over) => partGap(over, 1))).toEqual([0, null, null, null])
    expect(partGap(3, 1)).toBe(3)
    // Item 0 grabbed, gap at the end: 1 and 2 slide back one room.
    expect([0, 1, 2].map((i) => partShift(i, 0, 3, 50))).toEqual([0, -50, -50])
    // Item 2 grabbed, gap at the start: 0 and 1 slide on one room.
    expect([0, 1, 2].map((i) => partShift(i, 2, 0, 50))).toEqual([50, 50, 0])
    // An item from elsewhere: the items from the slot on slide on.
    expect([0, 1, 2].map((i) => partShift(i, -1, 1, 50))).toEqual([0, 50, 50])
    expect(partTransform(-50, 'x')).toBe('translateX(-50px)')
    expect(partTransform(50, 'y')).toBe('translateY(50px)')
  })
})

describe('the glide (YAZ-3808 D6, shared by YAZ-4606)', () => {
  it('each item slides from where it was drawn to its layout place; an item with no place before, or under a pixel off, does not', () => {
    const { el, items } = list('y')
    items.forEach((item, i) => (item.getBoundingClientRect = () => ({ top: 50 + [100, 0, 50][i] }) as DOMRect))
    const from = drawnPlaces(el, items.slice(0, 2), (item) => item.dataset.liveItem!, 'y')
    expect([...from]).toEqual([['k0', 100], ['k1', 0]])
    const animate = items.map((item) => (item.animate = vi.fn() as unknown as HTMLElement['animate']))
    glide(items, (item) => item.dataset.liveItem!, from, 'y')
    expect(animate[0]).toHaveBeenCalledWith([{ transform: 'translateY(100px)' }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    expect(animate[1]).toHaveBeenCalledWith([{ transform: 'translateY(-50px)' }, { transform: 'none' }], expect.anything())
    expect(animate[2]).not.toHaveBeenCalled()
  })

  it('reduced motion turns the glide off, and so does a window with no matchMedia', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    expect(motionOff()).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(motionOff()).toBe(false)
    vi.stubGlobal('matchMedia', undefined)
    expect(motionOff()).toBe(true)
  })

  it('the drag\'s end cancels the part\'s running slides, not other animations (YAZ-3808 6G)', () => {
    const slide = { transitionProperty: 'transform', cancel: vi.fn() }
    const other = { cancel: vi.fn() }
    const item = document.createElement('div')
    item.getAnimations = () => [slide, other] as unknown as Animation[]
    cancelSlides([item])
    expect(slide.cancel).toHaveBeenCalledTimes(1)
    expect(other.cancel).not.toHaveBeenCalled()
  })
})
