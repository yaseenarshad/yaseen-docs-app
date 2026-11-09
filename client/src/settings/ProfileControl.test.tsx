/** Settings › General › You (YAZ-4615 D1, D7): the profile a comment is signed with. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { ProfileControl } from './ProfileControl'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
})

function mount(settings: SettingsState, onChange: (s: SettingsState) => void): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<ProfileControl settings={settings} onChange={onChange} />))
  return host
}

/** Type, then leave the field: the control saves on blur (audit 2), never on each key. */
function type(input: HTMLInputElement | null, value: string, leave = true): void {
  if (input === null) throw new Error('no input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (leave) act(() => void input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
}

const field = (el: HTMLElement, label: string) => [...el.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))?.querySelector('input') ?? null

describe('ProfileControl', () => {
  it('a name makes the profile, and the handle follows the name until it is typed by hand', () => {
    const onChange = vi.fn()
    const el = mount(DEFAULT_SETTINGS, onChange)
    type(field(el, 'Name'), 'Yaseen Arshad')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: { handle: 'yaseen-arshad', name: 'Yaseen Arshad', picture: null } }))
    type(field(el, 'Handle'), 'yaz')
    type(field(el, 'Name'), 'Yaseen A')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: { handle: 'yaz', name: 'Yaseen A', picture: null } }))
  })

  it('nothing is saved while you type; a SAVED profile keeps its handle when you rename yourself', () => {
    const onChange = vi.fn()
    const el = mount({ ...DEFAULT_SETTINGS, profile: { handle: 'yaseen', name: 'Yaseen', picture: null } }, onChange)
    type(field(el, 'Name'), 'Yaseen Arshad', false)
    expect(onChange).not.toHaveBeenCalled()
    act(() => void field(el, 'Name')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: { handle: 'yaseen', name: 'Yaseen Arshad', picture: null } }))
  })

  it('a bad handle says how to fix it and saves nothing; an empty name stops signing (null)', () => {
    const onChange = vi.fn()
    const el = mount({ ...DEFAULT_SETTINGS, profile: { handle: 'yaz', name: 'Yaseen', picture: null } }, onChange)
    type(field(el, 'Handle'), 'Bad Handle')
    expect(el.textContent).toContain('Use lowercase letters, numbers and single hyphens.')
    expect(onChange).not.toHaveBeenCalled()
    type(field(el, 'Name'), '')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile: null }))
  })
  it('the handle “agent” is refused: it is for AI agents, and nothing is saved', () => {
    const onChange = vi.fn()
    const el = mount({ ...DEFAULT_SETTINGS, profile: { handle: 'yaz', name: 'Yaseen', picture: null } }, onChange)
    type(field(el, 'Handle'), 'agent')
    expect(el.textContent).toContain('“agent” is for AI agents. Pick another handle.')
    expect(field(el, 'Handle')?.getAttribute('aria-invalid')).toBe('true')
    expect(onChange).not.toHaveBeenCalled()
  })
})
