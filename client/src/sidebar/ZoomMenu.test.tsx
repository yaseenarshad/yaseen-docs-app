/** The footer's zoom menu (YAZ-3432): the chip shows the sidebar zoom and opens the menu; App size on top, Sidebar at the bottom, each − % +. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ZoomMenu } from './ZoomMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function render(props: { sidebar?: number; app?: number; onSidebar?: (p: number) => void; onApp?: (p: number) => void } = {}): HTMLElement {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() => root?.render(<ZoomMenu sidebar={props.sidebar ?? 100} onSidebar={props.onSidebar ?? vi.fn()} app={props.app ?? 100} onApp={props.onApp ?? vi.fn()} />))
  return host
}

const chip = () => document.querySelector<HTMLButtonElement>('.zoom-chip')!
const menu = () => document.querySelector<HTMLElement>('.zoom-menu[role="dialog"]')
/** A button of the menu by its accessible name. */
const button = (name: string) => menu()!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const value = (row: 'App size' | 'Sidebar zoom') => menu()!.querySelector<HTMLButtonElement>(`[role="group"][aria-label="${row}"] .zoom-stepper__value`)!
/** The page's zoom as Chromium shows it: `devicePixelRatio` (1 on this screen at 100%), and the resize it fires. */
function pageZoom(z: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: z })
  act(() => void window.dispatchEvent(new Event('resize')))
}
afterEach(() => {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
})
const mousedown = (el: EventTarget) => act(() => void el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

describe('ZoomMenu', () => {
  it('the chip shows the sidebar zoom and opens the menu on document.body, out of the footer; a second click closes it', () => {
    const el = render({ sidebar: 150 })
    expect(chip().textContent).toBe('150%')
    expect(chip().getAttribute('aria-expanded')).toBe('false')
    expect(menu()).toBeNull()

    act(() => chip().click())
    expect(menu()).not.toBeNull()
    expect(el.contains(menu())).toBe(false)
    expect(menu()!.parentElement).toBe(document.body)
    expect(chip().getAttribute('aria-expanded')).toBe('true')
    expect(chip().className).toBe('zoom-chip zoom-chip--open')
    // App size on top, Sidebar at the bottom, next to the chip; each row the same "− 100% +".
    expect([...menu()!.querySelectorAll('.zoom-menu__label, [role="group"]')].map((l) => l.getAttribute('aria-label') ?? l.textContent)).toEqual(['App size', 'App size', 'Sidebar', 'Sidebar zoom'])
    expect([value('App size').textContent, value('Sidebar zoom').textContent]).toEqual(['100%', '150%'])

    act(() => chip().click())
    expect(menu()).toBeNull()
  })

  it('each row writes its own zoom only (the steps, the walls and the percent: ZoomStepper.test.tsx); a click inside keeps the menu open', () => {
    const onSidebar = vi.fn()
    const onApp = vi.fn()
    render({ sidebar: 100, app: 110, onSidebar, onApp })
    act(() => chip().click())
    act(() => button('Zoom the sidebar in').click())
    expect(onSidebar).toHaveBeenCalledExactlyOnceWith(125)
    act(() => button('Make the app larger').click())
    expect(onApp).toHaveBeenCalledExactlyOnceWith(125)
    expect(onSidebar).toHaveBeenCalledTimes(1)
    expect(menu()).not.toBeNull()
  })

  it('the chip\'s tooltip and accessible name tell both values (D1)', () => {
    render({ sidebar: 150, app: 90 })
    expect([chip().title, chip().getAttribute('aria-label')]).toEqual(['Zoom: sidebar 150%, App size 90%', 'Zoom: sidebar 150%, App size 90%'])
  })

  it('the menu is zoomed by 1 / the PAGE\'s zoom, so it keeps its size on the screen; its place is kept in screen px while it is open', () => {
    render({ app: 100 })
    vi.spyOn(chip(), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 40, y: 700, width: 38, height: 22 }))
    act(() => chip().click())
    const body = () => menu()!.querySelector<HTMLElement>('.zoom-menu__body')!
    const place = () => [menu()!.style.left, menu()!.style.bottom, body().style.zoom]
    const bottom = window.innerHeight - 700 + 4
    expect(place()).toEqual(['40px', `${bottom}px`, '1'])
    // The setting says 110% before main has zoomed the page: the menu keeps its size and place, so a second quick
    // click on + lands on + again.
    render({ app: 110 })
    expect(place()).toEqual(['40px', `${bottom}px`, '1'])
    // The page is zoomed (a resize, with the new `devicePixelRatio`): the menu by 1 / 1.1, its place in page px to match.
    pageZoom(1.1)
    expect(place()).toEqual([`${40 / 1.1}px`, `${bottom / 1.1}px`, String(1 / 1.1)])
    render({ app: 125 })
    pageZoom(1.25)
    expect(place()).toEqual([`${40 / 1.25}px`, `${bottom / 1.25}px`, '0.8'])
  })

  it('opened at an App size of 125%, the menu is zoomed by 0.8 from the start, right above the chip', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.25 })
    render({ app: 125 })
    vi.spyOn(chip(), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 40, y: 700, width: 38, height: 22 }))
    act(() => chip().click())
    expect([menu()!.style.left, menu()!.style.bottom, menu()!.querySelector<HTMLElement>('.zoom-menu__body')!.style.zoom]).toEqual(['40px', `${window.innerHeight - 700 + 4}px`, '0.8'])
  })

  it('a menu that would pass the window\'s right edge moves left, once, and never past the left edge (a narrow Files window)', () => {
    render()
    const width = 160
    vi.spyOn(chip(), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: window.innerWidth - 60, y: 700, width: 38, height: 22 }))
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('zoom-menu')) return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 })
      return DOMRect.fromRect({ x: parseFloat(this.style.left), y: 500, width, height: 90 })
    })
    act(() => chip().click())
    // Its right edge 4 px inside the window, after one move; the measure ran once for the open and once for the move.
    expect(parseFloat(menu()!.style.left)).toBe(window.innerWidth - 4 - width)
    expect(measure.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('Escape, a mousedown outside and the window\'s blur close it; Escape gives the focus back to the chip', () => {
    render()
    act(() => chip().click())
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(chip())

    act(() => chip().click())
    mousedown(button('Make the app larger'))
    expect(menu()).not.toBeNull()
    mousedown(document.body)
    expect(menu()).toBeNull()

    act(() => chip().click())
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(menu()).toBeNull()
  })
})
