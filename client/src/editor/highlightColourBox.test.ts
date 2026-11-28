import { describe, expect, it, vi } from 'vitest'
import { ColourBox } from './highlightColourBox'

describe('ColourBox opacity slider (YAZ-6693)', () => {
  it('omits the opacity slider by default and emits solid #rrggbb', () => {
    const preview = vi.fn()
    const pick = vi.fn()
    const close = vi.fn()
    const box = new ColourBox(document, { preview, pick, close })
    box.show('#434343')
    expect(box.el.querySelector('input[aria-label="Opacity"]')).toBeNull()
    expect(box.hex).toBe('#434343')
  })

  it('shows Opacity slider (0-100%, default 100%) when showAlpha is true, reads #rrggbbaa and emits #rrggbb at 100% / #rrggbbaa below 100%', () => {
    const preview = vi.fn()
    const pick = vi.fn()
    const close = vi.fn()
    const box = new ColourBox(document, { showAlpha: true, preview, pick, close })
    const range = box.el.querySelector<HTMLInputElement>('input[aria-label="Opacity"]')!
    const readout = box.el.querySelector<HTMLElement>('.colour-box__alpha-value')!
    expect(range).not.toBeNull()
    expect([range.min, range.max, range.step, range.value]).toEqual(['0', '100', '1', '100'])
    expect(readout.textContent).toBe('100%')

    // Opens on translucent #rrggbbaa at exact percent (0x80 = 50%).
    box.show('#43434380')
    expect(range.value).toBe('50')
    expect(readout.textContent).toBe('50%')
    expect(box.hex).toBe('#43434380')

    // Dragging to 100% previews and picks solid 6-digit #rrggbb.
    range.value = '100'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    expect(preview).toHaveBeenLastCalledWith('#434343')
    expect(readout.textContent).toBe('100%')
    range.dispatchEvent(new Event('change', { bubbles: true }))
    expect(pick).toHaveBeenLastCalledWith('#434343')

    // Dragging to 25% emits #43434340; 0% emits #43434300.
    range.value = '25'
    range.dispatchEvent(new Event('change', { bubbles: true }))
    expect(pick).toHaveBeenLastCalledWith('#43434340')
    range.value = '0'
    range.dispatchEvent(new Event('change', { bubbles: true }))
    expect(pick).toHaveBeenLastCalledWith('#43434300')

    // Solid #rrggbb resets slider to 100%.
    box.show('#d9d9d9')
    expect(range.value).toBe('100')
    expect(readout.textContent).toBe('100%')
    expect(box.hex).toBe('#d9d9d9')

    // Escape on opacity slider closes the box.
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    range.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
