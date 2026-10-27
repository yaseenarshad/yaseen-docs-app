/** The zoom menu's "− 100% +" (YAZ-3389, YAZ-3432): − / + write the next step of the kind, the percent writes 100, the walls disable a button. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ZoomStepper } from './ZoomStepper'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function render(kind: 'sidebar' | 'app', value: number, onChange: (percent: number) => void): HTMLElement {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() => root?.render(<ZoomStepper kind={kind} value={value} onChange={onChange} />))
  return host
}

const [out, into] = [(el: HTMLElement) => el.querySelectorAll<HTMLButtonElement>('.zoom-stepper__step')[0], (el: HTMLElement) => el.querySelectorAll<HTMLButtonElement>('.zoom-stepper__step')[1]]
const percent = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.zoom-stepper__value')!

describe('ZoomStepper', () => {
  it('sidebar (YAZ-3389): shows the value; + writes 125 from 100, − writes 90, a click on the percent writes 100', () => {
    const onChange = vi.fn()
    const el = render('sidebar', 100, onChange)
    expect(el.querySelector('[role="group"][aria-label="Sidebar zoom"]')?.textContent).toBe('−100%+')
    expect([out(el).getAttribute('aria-label'), out(el).title]).toEqual(['Zoom the sidebar out', 'Zoom the sidebar out (⌘−)'])
    expect([into(el).getAttribute('aria-label'), into(el).title]).toEqual(['Zoom the sidebar in', 'Zoom the sidebar in (⌘+)'])
    expect(percent(el).title).toBe('Sidebar zoom. Click for 100%')

    act(() => into(el).click())
    expect(onChange).toHaveBeenLastCalledWith(125)
    act(() => out(el).click())
    expect(onChange).toHaveBeenLastCalledWith(90)

    render('sidebar', 150, onChange)
    expect(percent(el).textContent).toBe('150%')
    act(() => percent(el).click())
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('sidebar: disables − at 50% and + at 200%; a disabled button writes nothing', () => {
    const onChange = vi.fn()
    const el = render('sidebar', 50, onChange)
    expect([out(el).disabled, into(el).disabled]).toEqual([true, false])
    act(() => out(el).click())
    expect(onChange).not.toHaveBeenCalled()
    render('sidebar', 200, onChange)
    expect([out(el).disabled, into(el).disabled]).toEqual([false, true])
    act(() => into(el).click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('app (YAZ-3432): the same control along 90 · 100 · 110 · 125, the walls at 90 and 125, the percent writes 100', () => {
    const onChange = vi.fn()
    const el = render('app', 100, onChange)
    expect(el.querySelector('[role="group"][aria-label="App size"]')?.textContent).toBe('−100%+')
    expect([out(el).getAttribute('aria-label'), into(el).getAttribute('aria-label'), percent(el).title]).toEqual(['Make the app smaller', 'Make the app larger', 'App size. Click for 100%'])
    act(() => into(el).click())
    expect(onChange).toHaveBeenLastCalledWith(110)
    act(() => out(el).click())
    expect(onChange).toHaveBeenLastCalledWith(90)

    render('app', 110, onChange)
    act(() => into(el).click())
    expect(onChange).toHaveBeenLastCalledWith(125)

    onChange.mockClear()
    render('app', 90, onChange)
    expect([out(el).disabled, into(el).disabled]).toEqual([true, false])
    act(() => out(el).click())
    render('app', 125, onChange)
    expect([out(el).disabled, into(el).disabled]).toEqual([false, true])
    act(() => into(el).click())
    expect(onChange).not.toHaveBeenCalled()
    act(() => percent(el).click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith(100)
  })
})
