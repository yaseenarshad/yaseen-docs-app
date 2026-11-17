// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEdgeBack } from './useEdgeBack'

const HERE = dirname(fileURLToPath(import.meta.url))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Screen({ onBack }: { onBack?: () => void }) {
  const frame = useRef<HTMLDivElement>(null)
  useEdgeBack(frame, onBack)
  return (
    <div className="app" ref={frame}>
      <main className="screen">text</main>
    </div>
  )
}

let root: Root | null = null
let host: HTMLElement
let reduced = false
const setStandalone = (on: boolean) => Object.defineProperty(navigator, 'standalone', { value: on, configurable: true })

beforeEach(() => {
  vi.useFakeTimers()
  reduced = false
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduced-motion') ? reduced : false })) as unknown as typeof matchMedia
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
  vi.useRealTimers()
})

function mount(onBack: () => void) {
  root = createRoot(host)
  act(() => root!.render(<Screen onBack={onBack} />))
  return host.querySelector<HTMLElement>('.app')!
}

let stamp = 0
function touch(el: HTMLElement, type: string, x: number, y = 300) {
  const e = new Event(type, { bubbles: true })
  stamp += type === 'touchmove' ? 40 : 10
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  Object.defineProperty(e, 'timeStamp', { value: stamp })
  act(() => void el.dispatchEvent(e))
}
function swipe(el: HTMLElement, from: number, to: number) {
  touch(el, 'touchstart', from)
  for (let x = from + 10; x <= to; x += 10) touch(el, 'touchmove', x)
}

describe('YAZ-5435: the edge swipe on a screen with Back', () => {
  it('in the Home Screen app: the screen follows the finger, a release past a third goes back after a short slide', () => {
    setStandalone(true)
    const onBack = vi.fn()
    const app = mount(onBack)
    Object.defineProperty(app, 'clientWidth', { value: 390 })
    swipe(app, 5, 165)
    expect(app.style.transform).toBe('translateX(160px)')
    touch(app, 'touchend', 165)
    expect(onBack).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(200))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('a short drag springs back; a drag from the middle of the screen does nothing', () => {
    setStandalone(true)
    const onBack = vi.fn()
    const app = mount(onBack)
    Object.defineProperty(app, 'clientWidth', { value: 390 })
    swipe(app, 5, 65)
    touch(app, 'touchend', 65)
    expect(app.style.transform).toBe('')
    swipe(app, 100, 300)
    expect(app.style.transform).toBe('')
    touch(app, 'touchend', 300)
    act(() => void vi.advanceTimersByTime(500))
    expect(onBack).not.toHaveBeenCalled()
  })

  it('in a Safari tab the app does nothing: Safari\'s own back swipe stays the only one', () => {
    setStandalone(false)
    const onBack = vi.fn()
    const app = mount(onBack)
    swipe(app, 5, 300)
    touch(app, 'touchend', 300)
    act(() => void vi.advanceTimersByTime(500))
    expect(app.style.transform).toBe('')
    expect(onBack).not.toHaveBeenCalled()
  })

  it('with Reduce Motion: no follow, and a swipe goes back at once', () => {
    setStandalone(true)
    reduced = true
    const onBack = vi.fn()
    const app = mount(onBack)
    Object.defineProperty(app, 'clientWidth', { value: 390 })
    swipe(app, 5, 165)
    expect(app.style.transform).toBe('')
    touch(app, 'touchend', 165)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('YAZ-5436: the document never scrolls; only the screen does', () => {
  it('the shell\'s computed styles: html, body and the frame are fixed; the screen alone scrolls, contained', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(join(HERE, '../styles.css'), 'utf8')
    document.head.append(style)
    host.innerHTML =
      '<div id="root"><div class="app"><header class="topbar"></header><main class="screen screen--reader"></main><nav class="tabbar"></nav></div></div>'
    const css = (el: Element) => getComputedStyle(el)
    for (const el of [document.documentElement, document.body, host.querySelector('#root')!]) {
      expect(css(el).overflow).toBe('hidden')
      expect(css(el).getPropertyValue('overscroll-behavior')).toBe('none')
      expect(css(el).height).toBe('100%')
    }
    expect(css(document.body).position).toBe('fixed')
    const app = host.querySelector('.app')!
    expect(css(app).height).toBe('100%')
    expect(css(app).overflow).toBe('hidden')
    const screen = host.querySelector('.screen')!
    expect(css(screen).overflowY).toBe('auto')
    expect(css(screen).overflowX).toBe('hidden')
    expect(css(screen).getPropertyValue('overscroll-behavior')).toBe('contain')
    expect(css(screen).minHeight).toMatch(/^0(px)?$/)
    expect(css(screen).position).toBe('relative')
    // The bars never shrink or scroll.
    expect(css(host.querySelector('.topbar')!).flexShrink).toBe('0')
    expect(css(host.querySelector('.tabbar')!).flexShrink).toBe('0')
    // The reader shows no scroll bar.
    expect(css(screen).getPropertyValue('scrollbar-width')).toBe('none')
    // No `100vh` anywhere (on iOS it is taller than the screen, so the document scrolls).
    expect(style.textContent).not.toMatch(/100vh/)
    style.remove()
  })

  it('every screen with Back or tabs is drawn in the one frame (`Frame`): its `.screen` is the only scroller', () => {
    const frame = readFileSync(join(HERE, 'Frame.tsx'), 'utf8')
    expect(frame).toMatch(/className=\{review \? 'screen screen--review' : reader \? 'screen screen--reader' : 'screen'\}/)
  })
})
