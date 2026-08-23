/**
 * Context-menu viewport clamping (GRO-2204): the menu renders at the cursor but never spills
 * off screen — right/bottom overflow clamps the position; the "New ▸" submenu (Bible B,
 * GRO-2202) flips to the menu's left when it would overflow the right edge and slides up when
 * it would overflow the bottom. Sizes come from mocked `getBoundingClientRect` (jsdom has no
 * layout); the jsdom viewport is 1024×768.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContextMenu } from './ContextMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Box = { width?: number; height?: number; left?: number; top?: number }

/** Per-class mocked boxes; anything unlisted measures 0×0 (the jsdom default). */
let boxes: Record<string, Box> = {}

const asRect = ({ width = 0, height = 0, left = 0, top = 0 }: Box): DOMRect =>
  ({ width, height, left, top, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  boxes = {}
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    for (const [cls, box] of Object.entries(boxes)) if (this.classList.contains(cls)) return asRect(box)
    return asRect({})
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

type MenuProps = Parameters<typeof ContextMenu>[0]

function mount(x: number, y: number, over: Partial<MenuProps> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const props: MenuProps = {
    x,
    y,
    copyPath: null,
    copyLinkPath: null,
    newWindowPath: null,
    onOpenNewWindow: vi.fn(),
    renamePath: null,
    onRename: vi.fn(),
    deletePath: null,
    onDelete: vi.fn(),
    revealPath: null,
    onReveal: vi.fn(),
    newTypes: [{ name: 'kpi', label: 'KPI' }],
    onNewTyped: vi.fn(),
    onNewType: vi.fn(),
    onNewNote: vi.fn(),
    onNewBase: vi.fn(),
    onNewFolder: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  act(() => root?.render(<ContextMenu {...props} />))
  return container
}

const menu = (el: HTMLElement): HTMLElement => {
  const m = el.querySelector<HTMLElement>('.ctx-menu')
  if (m === null) throw new Error('missing menu')
  return m
}

const openSub = (el: HTMLElement): HTMLElement => {
  const trigger = [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent?.startsWith('New') && b.classList.contains('ctx-menu__item--sub'))
  if (trigger === undefined) throw new Error('missing submenu trigger')
  act(() => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  const sub = el.querySelector<HTMLElement>('.ctx-submenu')
  if (sub === null) throw new Error('missing submenu')
  return sub
}

describe('menu clamping', () => {
  it('renders at the requested position when it fits', () => {
    boxes = { 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(100, 120)
    expect(menu(el).style.left).toBe('100px')
    expect(menu(el).style.top).toBe('120px')
  })

  it('clamps at the right and bottom viewport edges instead of spilling off screen', () => {
    boxes = { 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(1000, 700)
    expect(menu(el).style.left).toBe('864px') // 1024 - 160
    expect(menu(el).style.top).toBe('588px') // 768 - 180
  })
})

describe('submenu clamping', () => {
  it('opens to the right with no flip or shift when there is room', () => {
    boxes = { 'ctx-menu__group': { left: 100, top: 100, width: 152 }, 'ctx-submenu': { width: 150, height: 60 } }
    const sub = openSub(mount(100, 100))
    expect(sub.classList.contains('ctx-submenu--left')).toBe(false)
    expect(sub.style.top).toBe('')
  })

  it('flips to the left of the menu when it would overflow the right edge', () => {
    boxes = { 'ctx-menu__group': { left: 864, top: 100, width: 152 }, 'ctx-submenu': { width: 150, height: 60 } }
    const sub = openSub(mount(864, 100))
    expect(sub.classList.contains('ctx-submenu--left')).toBe(true)
  })

  it('slides up when it would overflow the bottom edge', () => {
    boxes = { 'ctx-menu__group': { left: 100, top: 700, width: 152 }, 'ctx-submenu': { width: 150, height: 120 } }
    const sub = openSub(mount(100, 700))
    // Desired top 695 (group top - 5) + height 120 overflows 768 by 47 → slides up to -52.
    expect(sub.style.top).toBe('-52px')
  })
})
