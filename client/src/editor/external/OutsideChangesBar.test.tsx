/**
 * The one-line note (YAZ-3704 D6): its words for one, many and the whole note, and its buttons, which only
 * call the channel. A real channel with a stub controller bound, as the plugin binds its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OutsideChangesBar } from './OutsideChangesBar'
import { createOutsideChangesChannel, type OutsideChangesController } from './outsideChangesChannel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function mount() {
  const channel = createOutsideChangesChannel()
  const controller: OutsideChangesController = { next: vi.fn(), go: vi.fn(), rows: vi.fn(() => []), clear: vi.fn(), markWholeNote: vi.fn(), setGlow: vi.fn() }
  channel.bind(controller)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Pinned: the count is plain text. Unpinned, it opens the dropdown (OutsideChangesList.test.tsx).
  act(() => root?.render(<OutsideChangesBar channel={channel} pinned />))
  const el = container
  const bar = () => el.querySelector('.outside-changes-bar')
  const button = (name: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === name)
  return { channel, controller, bar, button }
}

describe('OutsideChangesBar (YAZ-3704 D6)', () => {
  it('shows nothing with no change', () => {
    const { bar } = mount()
    expect(bar()).toBeNull()
  })

  it('says one change, then many, as a calm status line with Next change and Mark all checked', () => {
    const { channel, bar, button } = mount()
    act(() => channel.sync({ count: 1, wholeNote: false }))
    expect(bar()?.getAttribute('role')).toBe('status')
    expect(bar()?.querySelector('span')?.textContent).toBe('1 outside change in this note')
    act(() => channel.sync({ count: 3, wholeNote: false }))
    expect(bar()?.querySelector('span')?.textContent).toBe('3 outside changes in this note')
    expect([...(bar()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Next change', 'Mark all checked'])
    expect(button('Dismiss')).toBeUndefined()
    act(() => channel.sync({ count: 0, wholeNote: false }))
    expect(bar()).toBeNull()
  })

  it('whole-note mode says so, with Dismiss alone', () => {
    const { channel, bar } = mount()
    act(() => channel.sync({ count: 0, wholeNote: true }))
    expect(bar()?.querySelector('span')?.textContent).toBe('Whole note changed outside the app')
    expect([...(bar()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Dismiss'])
  })

  it('each button calls the channel, and its mousedown keeps the focus in the note', () => {
    const { channel, controller, button } = mount()
    act(() => channel.sync({ count: 2, wholeNote: false }))
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button('Next change')?.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    act(() => button('Next change')?.click())
    expect(controller.next).toHaveBeenCalledTimes(1)
    act(() => button('Mark all checked')?.click())
    expect(controller.clear).toHaveBeenCalledTimes(1)
    act(() => channel.sync({ count: 0, wholeNote: true }))
    act(() => button('Dismiss')?.click())
    expect(controller.clear).toHaveBeenCalledTimes(2)
  })

  it('renders again only when the count or whole-note mode changes (a Next is neither, YAZ-3844)', () => {
    const { channel } = mount()
    const listener = vi.fn()
    channel.subscribe(listener)
    act(() => channel.sync({ count: 2, wholeNote: false }))
    act(() => channel.sync({ count: 2, wholeNote: false }))
    expect(listener).toHaveBeenCalledTimes(1)
    act(() => channel.sync({ count: 3, wholeNote: false }))
    act(() => channel.sync({ count: 0, wholeNote: true }))
    expect(listener).toHaveBeenCalledTimes(3)
    expect(Object.keys(channel.getState()).sort()).toEqual(['count', 'wholeNote'])
  })
})
