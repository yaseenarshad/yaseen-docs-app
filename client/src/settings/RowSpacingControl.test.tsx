/**
 * Settings › Sidebar › Row spacing (YAZ-5885 D1–D3): the three named heights write their px; Custom shows the field
 * and writes nothing until a px is kept; a kept px is clamped to 20–40 and rounded to a half px.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { clampRowHeight, RowSpacingControl, rowSpacingMode } from './RowSpacingControl'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let el: HTMLElement

afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

function mount(value: number) {
  const onSet = vi.fn()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  const render = (next: number) => act(() => root!.render(<RowSpacingControl value={next} onSet={onSet} />))
  render(value)
  return { onSet, render }
}
const pressed = () => el.querySelector('[aria-pressed="true"]')?.textContent
const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.settings__option')].find((b) => b.textContent === label)!
const field = () => el.querySelector<HTMLInputElement>('input[aria-label="Row spacing in px"]')
function type(text: string) {
  const input = field()!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

describe('Row spacing (YAZ-5885)', () => {
  it('names each height; any other px is Custom; a typed px is clamped to 20–40 and rounded to a half px', () => {
    expect([22, 25.5, 30, 27].map(rowSpacingMode)).toEqual(['compact', 'default', 'roomy', 'custom'])
    expect(['10', '20', '23.3', '24.8', '41', '99', 'x', ''].map(clampRowHeight)).toEqual([20, 20, 23.5, 25, 40, 40, null, null])
  })

  it('Default is picked at 25.5 with no field; Compact and Roomy write 22 and 30; the picked one writes nothing', () => {
    const { onSet, render } = mount(25.5)
    expect(pressed()).toBe('Default')
    expect(field()).toBeNull()
    act(() => button('Default').click())
    expect(onSet).not.toHaveBeenCalled()
    act(() => button('Compact').click())
    expect(onSet).toHaveBeenLastCalledWith(22)
    render(22)
    expect(pressed()).toBe('Compact')
    act(() => button('Roomy').click())
    expect(onSet).toHaveBeenLastCalledWith(30)
  })

  it('Custom shows the field at the height of the moment and writes only a kept px, clamped', () => {
    const { onSet, render } = mount(25.5)
    act(() => button('Custom').click())
    expect(pressed()).toBe('Custom')
    expect(field()?.value).toBe('25.5')
    expect(onSet).not.toHaveBeenCalled()
    type('50')
    expect(onSet).toHaveBeenLastCalledWith(40)
    render(40)
    expect(field()?.value).toBe('40')
    type('12')
    expect(onSet).toHaveBeenLastCalledWith(20)
    render(20)
    type('nope')
    expect(onSet).toHaveBeenCalledTimes(2) // no number keeps the height
    expect(field()?.value).toBe('20')
    // A stored px that is not a named height opens on Custom.
    render(27)
    expect(pressed()).toBe('Custom')
    expect(field()?.value).toBe('27')
  })
})
