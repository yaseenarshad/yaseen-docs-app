/**
 * The shared list drag (YAZ-4606 D58), on a vertical list: the live gap, the lift one frame on, Esc and the drag's end,
 * ONE write per drop, the glide (and none under reduced motion), and the count of layout reads per `dragover`. jsdom has
 * no layout: each item is 100 px high, stacked from 0, and the list's own place is 0.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useLiveGapReorder } from './useLiveGapReorder'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

function List({ items, onMove }: { items: readonly string[]; onMove: (from: number, to: number) => void }) {
  const live = useLiveGapReorder<HTMLUListElement>({ axis: 'y', keys: items, onMove })
  return (
    <ul {...live.listProps}>
      {items.map((k, i) => (
        <li key={k} {...live.itemProps(i)} draggable onDragStart={(e) => live.start(e, i)} onDragEnd={live.end}>
          {k}
        </li>
      ))}
    </ul>
  )
}

/** A list that takes its own moves, as a folder page's write does: the new order renders at once. */
function Owner({ onMove }: { onMove: (from: number, to: number) => void }) {
  const [items, setItems] = useState(['A', 'B', 'C', 'D'])
  return (
    <List
      items={items}
      onMove={(from, to) => {
        onMove(from, to)
        const next = [...items]
        next.splice(to, 0, ...next.splice(from, 1))
        setItems(next)
      }}
    />
  )
}

/** Each item's layout place by its place in the list now; `reads` counts the layout reads. */
const reads = { offset: 0 }
function layOut(): void {
  for (const li of host!.querySelectorAll('li')) {
    Object.defineProperties(li, {
      offsetTop: { configurable: true, get: () => (reads.offset++, [...li.parentElement!.children].indexOf(li) * 100) },
      offsetHeight: { configurable: true, get: () => (reads.offset++, 100) },
    })
    li.getBoundingClientRect = () => ({ top: [...li.parentElement!.children].indexOf(li) * 100, left: 0 }) as DOMRect
  }
}

function mount(onMove = vi.fn(), owner = false, items = ['A', 'B', 'C', 'D']) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(owner ? <Owner onMove={onMove} /> : <List items={items} onMove={onMove} />))
  layOut()
  return onMove
}

const li = (i: number) => host!.querySelectorAll<HTMLElement>('li')[i]
const fire = (target: Element, type: string, clientY = 0): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY })
  act(() => void target.dispatchEvent(event))
  return event
}
const frame = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => done())))
const transforms = () => [0, 1, 2, 3].map((i) => li(i).style.transform)

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  vi.unstubAllGlobals()
})

describe('useLiveGapReorder (YAZ-4606 D58)', () => {
  it('the items between the grab and the slot part by the grabbed item\'s room; the grabbed item leaves the list one frame on', async () => {
    mount()
    fire(li(0), 'dragstart')
    expect(li(0).hasAttribute('data-live-lifted')).toBe(false) // the Mac takes its picture first
    await frame()
    expect(li(0).hasAttribute('data-live-lifted')).toBe(true)
    fire(li(2), 'dragover', 260) // below C's midpoint: the slot after C
    expect(transforms()).toEqual(['', 'translateY(-100px)', 'translateY(-100px)', ''])
    expect(host!.querySelector('ul')!.hasAttribute('data-live-parting')).toBe(true)
    // A slot either side of the grabbed item moves nothing.
    fire(li(0), 'dragover', 60)
    expect(transforms()).toEqual(['', '', '', ''])
  })

  it('the slot is the layout\'s, not the drawn item\'s: a parted item under the pointer does not move the gap', () => {
    mount()
    fire(li(3), 'dragstart')
    fire(li(0), 'dragover', 40) // above A's midpoint: the first slot; A, B and C slide down
    expect(transforms()).toEqual(['translateY(100px)', 'translateY(100px)', 'translateY(100px)', ''])
    // A is now drawn at 100…200: the pointer at 140 is over it, but the layout says the slot after A.
    fire(li(0), 'dragover', 140)
    expect(transforms()).toEqual(['', 'translateY(100px)', 'translateY(100px)', ''])
  })

  it('a drop in the middle is ONE move to the final index; the gap closes once the new order renders', () => {
    const onMove = mount(vi.fn(), true)
    fire(li(0), 'dragstart')
    fire(li(2), 'dragover', 260)
    fire(li(2), 'drop', 260)
    expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 2)
    expect(transforms()).toEqual(['', '', '', ''])
    expect(host!.querySelector('[data-live-lifted], [data-live-parting]')).toBeNull()
  })

  it('NO SNAP-BACK (YAZ-4877): after a drop the gap holds until the new order arrives, the drag\'s end included; a drop whose order never comes ends after 1s', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const onMove = mount() // a list that never takes the move: a slow or refused write
      fire(li(0), 'dragstart')
      fire(li(2), 'dragover', 260)
      fire(li(2), 'drop', 260)
      expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 2)
      // The old order is NOT drawn while the move is written: the items keep their parted places.
      expect(transforms()).toEqual(['', 'translateY(-100px)', 'translateY(-100px)', ''])
      fire(li(0), 'dragend') // the browser's end comes after the drop
      expect(transforms()).toEqual(['', 'translateY(-100px)', 'translateY(-100px)', ''])
      act(() => void vi.advanceTimersByTime(999))
      expect(host!.querySelector('ul')!.hasAttribute('data-live-parting')).toBe(true)
      act(() => void vi.advanceTimersByTime(1))
      expect(transforms()).toEqual(['', '', '', ''])
      expect(host!.querySelector('[data-live-parting]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('NO SNAP-BACK (YAZ-4877): Esc after a drop still ends it at once', () => {
    mount()
    fire(li(0), 'dragstart')
    fire(li(2), 'dragover', 260)
    fire(li(2), 'drop', 260)
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(transforms()).toEqual(['', '', '', ''])
  })

  it('a drop on its own place writes nothing', () => {
    const onMove = mount()
    fire(li(1), 'dragstart')
    fire(li(1), 'drop', 190)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('Esc cancels: the gap closes and a later drop writes nothing; so does the drag\'s end', () => {
    const onMove = mount()
    fire(li(0), 'dragstart')
    fire(li(2), 'dragover', 260)
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(transforms()).toEqual(['', '', '', ''])
    expect(fire(li(2), 'drop', 260).defaultPrevented).toBe(false)
    fire(li(0), 'dragstart')
    fire(li(2), 'dragover', 260)
    fire(li(0), 'dragend')
    expect(transforms()).toEqual(['', '', '', ''])
    fire(li(2), 'drop', 260)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('a list replaced under a drag drops the drag', () => {
    const onMove = mount()
    fire(li(0), 'dragstart')
    fire(li(2), 'dragover', 260)
    act(() => root!.render(<List items={['A', 'B', 'X', 'D']} onMove={onMove} />))
    expect(transforms()).toEqual(['', '', '', ''])
    fire(li(2), 'drop', 260)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('THE GLIDE: a new order slides each item from where it was drawn to its new place; the dropped item, which stood nowhere, does not', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const animate = vi.fn()
    Element.prototype.animate = animate as unknown as Element['animate']
    mount(vi.fn(), true)
    fire(li(0), 'dragstart')
    await frame()
    fire(li(2), 'dragover', 260)
    // The parted items are drawn where the new order puts them, so they do not move again.
    li(1).getBoundingClientRect = () => ({ top: 0, left: 0 }) as DOMRect
    li(2).getBoundingClientRect = () => ({ top: 100, left: 0 }) as DOMRect
    fire(li(2), 'drop', 260)
    expect(host!.textContent).toBe('BCAD')
    expect(animate).not.toHaveBeenCalled()
    // @ts-expect-error -- jsdom's own `animate` is absent; the stub goes away with the prototype's.
    delete Element.prototype.animate
  })

  it('reduced motion: no glide', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    const animate = vi.fn()
    Element.prototype.animate = animate as unknown as Element['animate']
    const onMove = vi.fn()
    mount(onMove)
    act(() => root!.render(<List items={['B', 'A', 'C', 'D']} onMove={onMove} />))
    expect(animate).not.toHaveBeenCalled()
    // @ts-expect-error -- see above
    delete Element.prototype.animate
  })

  it('a reorder glides each moved item from its old place; under a pixel off, none', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const moved: string[] = []
    Element.prototype.animate = function (this: Element, keyframes: Keyframe[]) {
      moved.push(`${this.textContent} ${String(keyframes[0].transform)}`)
      return {} as Animation
    } as Element['animate']
    const onMove = vi.fn()
    mount(onMove)
    act(() => root!.render(<List items={['B', 'A', 'C', 'D']} onMove={onMove} />))
    expect(moved.sort()).toEqual(['A translateY(-100px)', 'B translateY(100px)'])
    // @ts-expect-error -- see above
    delete Element.prototype.animate
  })

  it('COUNT: a dragover reads the layout for the slot alone — one rect, the items\' offsets, no style', () => {
    mount()
    fire(li(0), 'dragstart')
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const style = vi.spyOn(window, 'getComputedStyle')
    reads.offset = 0
    for (let i = 0; i < 10; i++) fire(li(2), 'dragover', 200 + i * 10)
    expect(rect).toHaveBeenCalledTimes(10) // the list's own place: no scroller here, so no end-zone read
    expect(style).not.toHaveBeenCalled()
    expect(reads.offset).toBeLessThanOrEqual(10 * 2 * 4) // at most each item's place and size
    rect.mockRestore()
    style.mockRestore()
  })
})
