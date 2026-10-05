/**
 * A sheet with two real answers (YAZ-2523 🔒 V2): `onDismiss` makes Esc and a click outside a
 * third way out that answers nothing, and Enter choose nothing. A sheet without it is the sheet
 * `confirmSheets.test.tsx` pins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmSheet } from './ConfirmSheet'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const cb = { onConfirm: vi.fn(), onCancel: vi.fn(), onDismiss: vi.fn() }
const calls = () => [cb.onConfirm.mock.calls.length, cb.onCancel.mock.calls.length, cb.onDismiss.mock.calls.length]

function render(twoAnswers: boolean): HTMLElement {
  Object.values(cb).forEach((fn) => fn.mockClear())
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const extra = twoAnswers ? { cancelLabel: 'No', onDismiss: cb.onDismiss } : {}
  act(() => root?.render(<ConfirmSheet labelId="t" text="Text" confirmLabel="Yes" onConfirm={cb.onConfirm} onCancel={cb.onCancel} {...extra} />))
  return host
}

const key = (k: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void window.dispatchEvent(event))
  return event
}
const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')]
const clickAway = (el: HTMLElement) => act(() => void el.querySelector('.confirm-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

describe('ConfirmSheet with onDismiss: two answers and a way out', () => {
  it('Esc dismisses and answers nothing', () => {
    render(true)
    key('Escape')
    expect(calls()).toEqual([0, 0, 1])
  })

  it('a click outside dismisses and answers nothing; a click inside does nothing', () => {
    const el = render(true)
    act(() => void el.querySelector('.confirm')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(calls()).toEqual([0, 0, 0])
    clickAway(el)
    expect(calls()).toEqual([0, 0, 1])
  })

  it('the second button carries its own label, takes the focus and cancels; the first confirms', () => {
    const el = render(true)
    expect(buttons(el).map((b) => b.textContent)).toEqual(['No', 'Yes'])
    expect(document.activeElement?.textContent).toBe('No')
    act(() => buttons(el)[0].click())
    expect(calls()).toEqual([0, 1, 0])
    act(() => buttons(el)[1].click())
    expect(calls()).toEqual([1, 1, 0])
  })

  it('Enter does nothing, and is swallowed so it cannot press the focused button', () => {
    render(true)
    expect(key('Enter').defaultPrevented).toBe(true)
    expect(calls()).toEqual([0, 0, 0])
  })
})

describe('ConfirmSheet without onDismiss: unchanged', () => {
  it('the second button says Cancel; Esc and a click outside cancel, Enter confirms', () => {
    const el = render(false)
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Cancel', 'Yes'])
    key('Escape')
    clickAway(el)
    expect(calls()).toEqual([0, 2, 0])
    key('Enter')
    expect(calls()).toEqual([1, 2, 0])
  })
})
