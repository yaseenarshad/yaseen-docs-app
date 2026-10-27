/** The footer's zoom menu (YAZ-3432): the chip shows the sidebar zoom and opens the menu; Sidebar steps, App sets the App size. */
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
const sizes = () => [...document.querySelectorAll<HTMLButtonElement>('.zoom-menu [role="group"][aria-label="App size"] button')]
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
    expect([...menu()!.querySelectorAll('.zoom-menu__label')].map((l) => l.textContent)).toEqual(['Sidebar', 'App size'])
    expect(menu()!.querySelector('.sidebar-zoom__value')?.textContent).toBe('150%')

    act(() => chip().click())
    expect(menu()).toBeNull()
  })

  it('Sidebar: − and + step the sidebar zoom and the percent writes 100, as the footer did (YAZ-3389)', () => {
    const onSidebar = vi.fn()
    render({ sidebar: 100, onSidebar })
    act(() => chip().click())
    act(() => menu()!.querySelector<HTMLButtonElement>('button[aria-label="Zoom the sidebar in"]')!.click())
    expect(onSidebar).toHaveBeenLastCalledWith(125)
    act(() => menu()!.querySelector<HTMLButtonElement>('button[aria-label="Zoom the sidebar out"]')!.click())
    expect(onSidebar).toHaveBeenLastCalledWith(90)
    render({ sidebar: 200, onSidebar })
    expect(menu()!.querySelector<HTMLButtonElement>('button[aria-label="Zoom the sidebar in"]')!.disabled).toBe(true)
    act(() => menu()!.querySelector<HTMLButtonElement>('.sidebar-zoom__value')!.click())
    expect(onSidebar).toHaveBeenLastCalledWith(100)
    // A click inside the menu keeps it open.
    expect(menu()).not.toBeNull()
  })

  it('App size: one button for each of 90 · 100 · 110 · 125, the current one pressed; a click writes its percent', () => {
    const onApp = vi.fn()
    render({ app: 110, onApp })
    act(() => chip().click())
    expect(sizes().map((b) => b.textContent)).toEqual(['90%', '100%', '110%', '125%'])
    expect(sizes().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false'])
    act(() => sizes()[3].click())
    expect(onApp).toHaveBeenCalledExactlyOnceWith(125)
    expect(chip().getAttribute('aria-label')).toBe('Zoom: sidebar 100%, App size 110%')
  })

  it('the menu is zoomed by 1 / the App size, so it keeps its size on the screen; its place is kept in screen px while it is open', () => {
    render({ app: 100 })
    vi.spyOn(chip(), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 40, y: 700, width: 38, height: 22 }))
    act(() => chip().click())
    const body = () => menu()!.querySelector<HTMLElement>('.zoom-menu__body')!
    expect(body().style.zoom).toBe('1')
    const bottom = window.innerHeight - 700 + 4
    expect([menu()!.style.left, menu()!.style.bottom]).toEqual(['40px', `${bottom}px`])
    // App size 125%: the page is 1.25× larger, so the menu is zoomed by 0.8 and its place in page px shrinks to match.
    render({ app: 125 })
    expect(body().style.zoom).toBe('0.8')
    expect([menu()!.style.left, menu()!.style.bottom]).toEqual([`${40 / 1.25}px`, `${bottom / 1.25}px`])
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
    mousedown(menu()!.querySelector('.zoom-menu__size')!)
    expect(menu()).not.toBeNull()
    mousedown(document.body)
    expect(menu()).toBeNull()

    act(() => chip().click())
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(menu()).toBeNull()
  })
})
