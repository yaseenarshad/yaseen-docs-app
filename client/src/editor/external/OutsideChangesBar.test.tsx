/**
 * The one-line note (YAZ-3704 D6): its words for one, many and the whole page, and its buttons, which only
 * call the channel. A real channel with a stub controller bound, as the plugin binds its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { applyExternalMarkdown } from './applyExternalMarkdown'
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

function mount(onKeep?: () => void) {
  const channel = createOutsideChangesChannel()
  const controller: OutsideChangesController = { next: vi.fn(), go: vi.fn(), rows: vi.fn(() => []), clear: vi.fn(), markWholePage: vi.fn(), setGlow: vi.fn() }
  channel.bind(controller)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Pinned: the count is plain text. Unpinned, it opens the dropdown (OutsideChangesList.test.tsx).
  act(() => root?.render(<OutsideChangesBar channel={channel} pinned onKeep={onKeep} />))
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
    act(() => channel.sync({ count: 1, wholePage: false, fadesAt: null }))
    expect(bar()?.getAttribute('role')).toBe('status')
    expect(bar()?.querySelector('span')?.textContent).toBe('1 outside change in this page')
    act(() => channel.sync({ count: 3, wholePage: false, fadesAt: null }))
    expect(bar()?.querySelector('span')?.textContent).toBe('3 outside changes in this page')
    expect([...(bar()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Next change', 'Mark all checked'])
    expect(button('Dismiss')).toBeUndefined()
    act(() => channel.sync({ count: 0, wholePage: false, fadesAt: null }))
    expect(bar()).toBeNull()
  })

  it('whole-page mode says so, with Dismiss alone', () => {
    const { channel, bar } = mount()
    act(() => channel.sync({ count: 0, wholePage: true, fadesAt: null }))
    expect(bar()?.querySelector('span')?.textContent).toBe('Whole page changed outside the app')
    expect([...(bar()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Dismiss'])
  })

  it('each button calls the channel, and its mousedown keeps the focus in the page', () => {
    const { channel, controller, button } = mount()
    act(() => channel.sync({ count: 2, wholePage: false, fadesAt: null }))
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button('Next change')?.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    act(() => button('Next change')?.click())
    expect(controller.next).toHaveBeenCalledTimes(1)
    act(() => button('Mark all checked')?.click())
    expect(controller.clear).toHaveBeenCalledTimes(1)
    act(() => channel.sync({ count: 0, wholePage: true, fadesAt: null }))
    act(() => button('Dismiss')?.click())
    expect(controller.clear).toHaveBeenCalledTimes(2)
  })

  it('renders again only when the count, whole-page mode or the fade time changes (a Next is none, YAZ-3844)', () => {
    const { channel } = mount()
    const listener = vi.fn()
    channel.subscribe(listener)
    act(() => channel.sync({ count: 2, wholePage: false, fadesAt: null }))
    act(() => channel.sync({ count: 2, wholePage: false, fadesAt: null }))
    expect(listener).toHaveBeenCalledTimes(1)
    act(() => channel.sync({ count: 3, wholePage: false, fadesAt: null }))
    act(() => channel.sync({ count: 0, wholePage: true, fadesAt: null }))
    expect(listener).toHaveBeenCalledTimes(3)
    act(() => channel.sync({ count: 0, wholePage: true, fadesAt: 5_000 }))
    expect(listener).toHaveBeenCalledTimes(4)
    expect(Object.keys(channel.getState()).sort()).toEqual(['count', 'fadesAt', 'wholePage'])
  })

  it('a timed glow shows "fades in", which ticks each second; Keep calls onKeep (YAZ-4272 demo)', () => {
    vi.useFakeTimers()
    try {
      const onKeep = vi.fn()
      const { channel, bar, button } = mount(onKeep)
      act(() => channel.sync({ count: 2, wholePage: false, fadesAt: Date.now() + 65_000 }))
      const fade = () => bar()?.querySelector('.outside-changes-bar__fade')?.textContent
      expect(fade()).toBe('fades in 1:05')
      expect([...(bar()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Keep', 'Next change', 'Mark all checked'])
      act(() => vi.advanceTimersByTime(6_000))
      expect(fade()).toBe('fades in 59s')
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      button('Keep')?.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true)
      act(() => button('Keep')?.click())
      expect(onKeep).toHaveBeenCalledTimes(1)
      // Until checked: no fade time, so no countdown and no Keep.
      act(() => channel.sync({ count: 2, wholePage: false, fadesAt: null }))
      expect(fade()).toBeUndefined()
      expect(button('Keep')).toBeUndefined()
      // Whole-page mode counts down too.
      act(() => channel.sync({ count: 0, wholePage: true, fadesAt: Date.now() + 300_000 }))
      expect(fade()).toBe('fades in 5:00')
      expect(button('Keep')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the dropdown in a real page (4J2)', () => {
  it('Escape closes the dropdown and leaves the caret in the page', async () => {
    const sidebarRow = document.createElement('button')
    sidebarRow.className = 'tree__row tree__row--active'
    document.body.appendChild(sidebarRow)
    const channel = createOutsideChangesChannel()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const crepe = createCrepe({ root: host, defaultValue: '* One\n* Two\n', outsideChanges: channel })
    await crepe.create()
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    applyExternalMarkdown(crepe, getMarkdownForSave(crepe).replace('Two', 'Two B'))
    const barRoot = document.createElement('div')
    document.body.appendChild(barRoot)
    const barReact = createRoot(barRoot)
    act(() => barReact.render(<OutsideChangesBar channel={channel} pinned={false} onPin={() => {}} />))
    act(() => barRoot.querySelector<HTMLButtonElement>('.outside-changes-bar__count')?.click())
    view.focus()
    act(() => {
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
    })
    expect(barRoot.querySelector('.outside-list--dropdown')).toBeNull()
    expect(document.activeElement).toBe(view.dom)
    act(() => barReact.unmount())
    await crepe.destroy()
    host.remove()
    barRoot.remove()
    sidebarRow.remove()
  })
})
