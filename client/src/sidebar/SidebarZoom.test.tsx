/** The footer's sidebar zoom (YAZ-3389): − / + write the next step, the percent writes 100, the walls disable a button. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SidebarZoom } from './SidebarZoom'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function render(value: number, onChange: (percent: number) => void): HTMLElement {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() => root?.render(<SidebarZoom value={value} onChange={onChange} />))
  return host
}

const out = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[aria-label="Zoom the sidebar out"]')!
const into = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[aria-label="Zoom the sidebar in"]')!
const percent = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar-zoom__value')!

describe('SidebarZoom', () => {
  it('shows the value; + writes 125 from 100, − writes 90, a click on the percent writes 100', () => {
    const onChange = vi.fn()
    const el = render(100, onChange)
    expect(el.querySelector('[role="group"][aria-label="Sidebar zoom"]')?.textContent).toBe('−100%+')
    expect(out(el).title).toBe('Zoom the sidebar out (⌘−)')
    expect(into(el).title).toBe('Zoom the sidebar in (⌘+)')
    expect(percent(el).title).toBe('Sidebar zoom. Click for 100%')

    act(() => into(el).click())
    expect(onChange).toHaveBeenLastCalledWith(125)
    act(() => out(el).click())
    expect(onChange).toHaveBeenLastCalledWith(90)

    render(150, onChange)
    expect(percent(el).textContent).toBe('150%')
    act(() => percent(el).click())
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('disables − at 50% and + at 200%; a disabled button writes nothing', () => {
    const onChange = vi.fn()
    const el = render(50, onChange)
    expect([out(el).disabled, into(el).disabled]).toEqual([true, false])
    act(() => out(el).click())
    expect(onChange).not.toHaveBeenCalled()
    render(200, onChange)
    expect([out(el).disabled, into(el).disabled]).toEqual([false, true])
    act(() => into(el).click())
    expect(onChange).not.toHaveBeenCalled()
  })
})
