/**
 * Anchored popover (YAZ-743): `Popover` mounted on its own with react-dom in jsdom, both rects
 * stubbed. With `anchor` it goes `position: fixed` under that element, clamped to the viewport,
 * and click-away measures the anchor instead of the parent so the trigger still toggles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Popover } from './Popover'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rect = (r: Partial<DOMRect>): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}), ...r }) as DOMRect

let root: Root | null = null
let container: HTMLElement | null = null

/** The popover measures 200 x 100; the anchor's own rect wins over the prototype stub. */
function anchorAt(r: Partial<DOMRect>): HTMLElement {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect({ width: 200, height: 100 }))
  const el = document.createElement('button')
  el.getBoundingClientRect = () => rect(r)
  document.body.appendChild(el)
  return el
}

function mount(anchor?: HTMLElement) {
  const onClose = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <Popover label="View menu" anchor={anchor} onClose={onClose}>
        <div role="menu" />
      </Popover>,
    ),
  )
  const pop = container.querySelector<HTMLElement>('.base-popover')
  if (pop === null) throw new Error('missing .base-popover')
  return { pop, onClose }
}

const mousedown = (el: Node): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
  document.querySelectorAll('button').forEach((b) => b.remove())
})

describe('anchored popover', () => {
  it('hangs fixed 6px under the anchor', () => {
    const { pop } = mount(anchorAt({ top: 20, bottom: 48, left: 30, right: 70 }))
    expect(pop.style.position).toBe('fixed')
    expect(pop.style.top).toBe('54px')
    expect(pop.style.left).toBe('30px')
    expect(pop.className).toBe('base-popover base-popover--fixed')
  })

  it('keeps the CSS position without an anchor', () => {
    expect(mount().pop.getAttribute('style')).toBeNull()
  })

  it('clamps back inside the viewport at the right edge', () => {
    const { pop } = mount(anchorAt({ top: 20, bottom: 48, left: 1000, right: 1024 }))
    expect(window.innerWidth).toBe(1024)
    expect(pop.style.left).toBe('824px')
    expect(pop.style.top).toBe('54px')
  })

  it('closes on a mousedown away from the anchor, not on the anchor itself', () => {
    const anchor = anchorAt({ top: 20, bottom: 48, left: 30, right: 70 })
    const { onClose } = mount(anchor)
    mousedown(anchor)
    expect(onClose).not.toHaveBeenCalled()
    mousedown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a scroll under the anchor, and never without one', () => {
    const { onClose } = mount(anchorAt({ top: 20, bottom: 48, left: 30, right: 70 }))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root?.unmount())
    const plain = mount()
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(plain.onClose).not.toHaveBeenCalled()
  })
})
