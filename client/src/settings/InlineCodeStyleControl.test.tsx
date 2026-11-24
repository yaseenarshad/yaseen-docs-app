/**
 * Settings › Editor › Code blocks › Inline code (YAZ-6452): preset switching, Custom text colour &
 * pill background modes (Match text, Auto tint, None, hex pickers), Reset, and Light/Dark live preview.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { InlineCodeStyle } from '@shared/types'
import { InlineCodeStyleControl } from './InlineCodeStyleControl'
import { inlineCodeAttr, inlineCodeVars } from './inlineCodeStyle'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let el: HTMLElement

afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
  delete document.documentElement.dataset.theme
})

function mount(initial: InlineCodeStyle) {
  const onChange = vi.fn()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  const render = (next: InlineCodeStyle) => act(() => root!.render(<InlineCodeStyleControl value={next} onChange={onChange} />))
  render(initial)
  return { onChange, render }
}

const buttonsIn = (groupLabel: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${groupLabel}"] button`)]
const buttonIn = (groupLabel: string, text: string) =>
  buttonsIn(groupLabel).find((b) => b.textContent === text)!
const resetBtn = () => el.querySelector<HTMLButtonElement>('.inline-code-control__reset')
const previewSurface = () => el.querySelector<HTMLElement>('[data-preview="inline-code"]')!
const colorInput = (ariaLabel: string) => el.querySelector<HTMLInputElement>(`input[type="color"][aria-label="${ariaLabel}"]`)

function pickColor(input: HTMLInputElement, hex: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, hex)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('inlineCodeStyle CSS helpers (YAZ-6452)', () => {
  it('computes data attribute and custom CSS vars accurately', () => {
    expect(inlineCodeAttr(undefined)).toBe('default')
    expect(inlineCodeAttr('classic')).toBe('classic')
    expect(inlineCodeAttr('github')).toBe('github')
    expect(inlineCodeAttr({ fg: 'text', bg: 'auto' })).toBe('custom')

    expect(inlineCodeVars('default')).toEqual({})
    expect(inlineCodeVars('classic')).toEqual({})
    expect(inlineCodeVars('subtle')).toEqual({})
    expect(inlineCodeVars({ fg: 'text', bg: 'auto' })).toEqual({
      '--inline-code-fg': 'var(--fg)',
      '--inline-code-bg': 'color-mix(in srgb, var(--inline-code-fg) 14%, transparent)',
    })
    expect(inlineCodeVars({ fg: '#1d4ed8', bg: 'none' })).toEqual({
      '--inline-code-fg': '#1d4ed8',
      '--inline-code-bg': 'transparent',
    })
    expect(inlineCodeVars({ fg: '#1d4ed8', bg: '#dbeafe' })).toEqual({
      '--inline-code-fg': '#1d4ed8',
      '--inline-code-bg': '#dbeafe',
    })
  })
})

describe('InlineCodeStyleControl (YAZ-6452)', () => {
  it('renders all presets and live preview sentence; switches presets cleanly', () => {
    const { onChange, render } = mount('default')
    expect(buttonsIn('Inline code style').map((b) => b.textContent)).toEqual([
      'Default',
      'Classic',
      'Subtle',
      'GitHub',
      'Accent',
      'Plum',
      'Plain',
      'Custom…',
    ])
    expect(buttonIn('Inline code style', 'Default').getAttribute('aria-pressed')).toBe('true')
    expect(resetBtn()).toBeNull()
    expect(el.querySelector('.inline-code-control__custom')).toBeNull()

    const preview = previewSurface()
    expect(preview.textContent).toContain('When we updated App.tsx and /api/launchers, inline code stayed easy to scan.')
    expect([...preview.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['App.tsx', '/api/launchers'])
    expect(preview.dataset.inlineCodeStyle).toBe('default')

    act(() => buttonIn('Inline code style', 'Classic').click())
    expect(onChange).toHaveBeenLastCalledWith('classic')
    render('classic')
    expect(buttonIn('Inline code style', 'Classic').getAttribute('aria-pressed')).toBe('true')
    expect(previewSurface().dataset.inlineCodeStyle).toBe('classic')
    expect(resetBtn()).not.toBeNull()

    act(() => buttonIn('Inline code style', 'Subtle').click())
    expect(onChange).toHaveBeenLastCalledWith('subtle')
    render('subtle')
    expect(buttonIn('Inline code style', 'Subtle').getAttribute('aria-pressed')).toBe('true')
    expect(previewSurface().dataset.inlineCodeStyle).toBe('subtle')
    expect(resetBtn()).not.toBeNull()

    act(() => buttonIn('Inline code style', 'GitHub').click())
    expect(onChange).toHaveBeenLastCalledWith('github')
    render('github')
    expect(previewSurface().dataset.inlineCodeStyle).toBe('github')

    act(() => buttonIn('Inline code style', 'Plain').click())
    expect(onChange).toHaveBeenLastCalledWith('plain')
    render('plain')
    expect(previewSurface().dataset.inlineCodeStyle).toBe('plain')
  })

  it('supports Custom with Match text, Auto tint, None, and hex colour pickers', () => {
    const { onChange, render } = mount('default')

    act(() => buttonIn('Inline code style', 'Custom…').click())
    expect(onChange).toHaveBeenLastCalledWith({ fg: 'text', bg: 'auto' })
    render({ fg: 'text', bg: 'auto' })

    expect(buttonIn('Inline code style', 'Custom…').getAttribute('aria-pressed')).toBe('true')
    expect(buttonIn('Inline code text colour mode', 'Match text (Light/Dark)').getAttribute('aria-pressed')).toBe('true')
    expect(buttonIn('Inline code pill background mode', 'Auto tint (Light/Dark)').getAttribute('aria-pressed')).toBe('true')
    expect(colorInput('Inline code text colour')).toBeNull()
    expect(colorInput('Inline code background colour')).toBeNull()

    const preview = previewSurface()
    expect(preview.dataset.inlineCodeStyle).toBe('custom')
    expect(preview.style.getPropertyValue('--inline-code-fg')).toBe('var(--fg)')
    expect(preview.style.getPropertyValue('--inline-code-bg')).toBe('color-mix(in srgb, var(--inline-code-fg) 14%, transparent)')

    // Switch Text colour to Custom colour and pick a hex.
    act(() => buttonIn('Inline code text colour mode', 'Custom colour').click())
    expect(onChange).toHaveBeenLastCalledWith({ fg: '#1d4ed8', bg: 'auto' })
    render({ fg: '#1d4ed8', bg: 'auto' })
    const fgPicker = colorInput('Inline code text colour')!
    expect(fgPicker).not.toBeNull()
    pickColor(fgPicker, '#0f766e')
    expect(onChange).toHaveBeenLastCalledWith({ fg: '#0f766e', bg: 'auto' })
    render({ fg: '#0f766e', bg: 'auto' })
    expect(previewSurface().style.getPropertyValue('--inline-code-fg')).toBe('#0f766e')

    // Switch Pill background to None.
    act(() => buttonIn('Inline code pill background mode', 'None').click())
    expect(onChange).toHaveBeenLastCalledWith({ fg: '#0f766e', bg: 'none' })
    render({ fg: '#0f766e', bg: 'none' })
    expect(previewSurface().style.getPropertyValue('--inline-code-bg')).toBe('transparent')

    // Switch Pill background to Custom colour and pick a hex.
    act(() => buttonIn('Inline code pill background mode', 'Custom colour').click())
    expect(onChange).toHaveBeenLastCalledWith({ fg: '#0f766e', bg: '#e8f0fe' })
    render({ fg: '#0f766e', bg: '#e8f0fe' })
    const bgPicker = colorInput('Inline code background colour')!
    expect(bgPicker).not.toBeNull()
    pickColor(bgPicker, '#ccfbf1')
    expect(onChange).toHaveBeenLastCalledWith({ fg: '#0f766e', bg: '#ccfbf1' })
    render({ fg: '#0f766e', bg: '#ccfbf1' })
    expect(previewSurface().style.getPropertyValue('--inline-code-bg')).toBe('#ccfbf1')

    // Switch back to Match text and Auto tint.
    act(() => buttonIn('Inline code text colour mode', 'Match text (Light/Dark)').click())
    expect(onChange).toHaveBeenLastCalledWith({ fg: 'text', bg: '#ccfbf1' })
    render({ fg: 'text', bg: '#ccfbf1' })
    act(() => buttonIn('Inline code pill background mode', 'Auto tint (Light/Dark)').click())
    expect(onChange).toHaveBeenLastCalledWith({ fg: 'text', bg: 'auto' })
  })

  it('Reset returns to default from presets and Custom', () => {
    const { onChange, render } = mount('plum')
    expect(resetBtn()).not.toBeNull()
    act(() => resetBtn()!.click())
    expect(onChange).toHaveBeenLastCalledWith('default')
    render('default')
    expect(resetBtn()).toBeNull()

    render({ fg: '#7e22ce', bg: 'auto' })
    expect(resetBtn()).not.toBeNull()
    act(() => resetBtn()!.click())
    expect(onChange).toHaveBeenLastCalledWith('default')
  })

  it('Light / Dark preview toggle switches preview theme without calling onChange', () => {
    document.documentElement.dataset.theme = 'dark'
    const { onChange } = mount('accent')
    expect(previewSurface().dataset.theme).toBe('dark')
    expect(buttonIn('Preview theme', 'Dark').getAttribute('aria-pressed')).toBe('true')
    expect(buttonIn('Preview theme', 'Light').getAttribute('aria-pressed')).toBe('false')

    act(() => buttonIn('Preview theme', 'Light').click())
    expect(previewSurface().dataset.theme).toBe('light')
    expect(buttonIn('Preview theme', 'Light').getAttribute('aria-pressed')).toBe('true')
    expect(buttonIn('Preview theme', 'Dark').getAttribute('aria-pressed')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()

    act(() => buttonIn('Preview theme', 'Dark').click())
    expect(previewSurface().dataset.theme).toBe('dark')
    expect(onChange).not.toHaveBeenCalled()
  })
})
