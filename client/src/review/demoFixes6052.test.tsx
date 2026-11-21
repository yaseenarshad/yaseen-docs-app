// @vitest-environment jsdom
import { act } from 'react'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot, type Root } from 'react-dom/client'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { doneCardEmbedAt, registerCardEmbedDone } from '../editor/card/embedCard'
import { useTransientCardWidth } from './inboxCardWidth'
import { cardInboxHints } from './cardInboxKeys'

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

describe('YAZ-6017 demo quick-fix regressions (YAZ-6052, YAZ-6054, Scroll hint)', () => {
  it('YAZ-6052: doneCardEmbedAt invokes the registered done callback and unregisters cleanly', () => {
    const el = document.createElement('div')
    const done = vi.fn()
    const unregister = registerCardEmbedDone(el, done)
    doneCardEmbedAt(el)
    expect(done).toHaveBeenCalledTimes(1)
    unregister()
    doneCardEmbedAt(el)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('YAZ-6054: useTransientCardWidth drags in memory, resets on reset() and resetKey change, and never writes storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const addSpy = vi.spyOn(window, 'addEventListener')
    const remSpy = vi.spyOn(window, 'removeEventListener')
    let api!: ReturnType<typeof useTransientCardWidth>
    function Harness({ resetKey }: { resetKey: string }) {
      const ref = useRef<HTMLDivElement>(null)
      api = useTransientCardWidth(ref, ref, resetKey, true, 24)
      return (
        <div ref={ref} data-testid="box">
          <div className="card" />
        </div>
      )
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<Harness resetKey="card-a" />))

    const box = host.querySelector<HTMLElement>('[data-testid="box"]')!
    const card = host.querySelector<HTMLElement>('.card')!
    Object.defineProperty(box, 'clientWidth', { value: 1200, configurable: true })
    card.getBoundingClientRect = () => ({ left: 0, top: 0, right: 554, bottom: 200, width: 554, height: 200, x: 0, y: 0, toJSON: () => ({}) })

    expect(api.width).toBeNull()
    act(() => {
      api.startDrag(1)({ button: 0, clientX: 500, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.PointerEvent<HTMLElement>)
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 550 }))
    })
    // Centered drag: +50px right edge -> +100px card text width (520 -> 620)
    expect(api.width).toBe(620)
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
    // Listeners removed on pointerup
    expect(remSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(remSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    // Double-click reset
    act(() => api.reset())
    expect(api.width).toBeNull()
    // Drag again, then switch resetKey -> resets to null
    act(() => {
      api.startDrag(1)({ button: 0, clientX: 500, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.PointerEvent<HTMLElement>)
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 540 }))
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
    expect(api.width).toBe(600)
    act(() => root!.render(<Harness resetKey="card-b" />))
    expect(api.width).toBeNull()
    expect(setItem).not.toHaveBeenCalled()

    setItem.mockRestore()
    addSpy.mockRestore()
    remSpy.mockRestore()
  })

  it('Inbox hints show Scroll (Space) when answering on a long card with more content below', () => {
    const withMore = cardInboxHints({ card: true, answering: true, canUndo: false, scrollDown: true })
    expect(withMore[0]).toEqual({ keys: 'Space', label: 'Scroll' })
    const atBottom = cardInboxHints({ card: true, answering: true, canUndo: false, scrollDown: false })
    expect(atBottom.some((h) => h.keys === 'Space')).toBe(false)
  })
})
