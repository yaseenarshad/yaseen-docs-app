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

  it('the sheet itself holds the focus, not a button: a Space typed as the box appears presses neither answer', () => {
    const el = render(true)
    expect(document.activeElement).toBe(el.querySelector('.confirm'))
  })

  it('the second button carries its own label and cancels; the first confirms', () => {
    const el = render(true)
    expect(buttons(el).map((b) => b.textContent)).toEqual(['No', 'Yes'])
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

describe('a sheet that goes away puts the focus back where it was', () => {
  const opener = (): HTMLButtonElement => {
    const button = document.body.appendChild(document.createElement('button'))
    button.focus()
    return button
  }

  it.each([true, false])('on the element that had it when the sheet opened (two answers: %s)', (twoAnswers) => {
    const button = opener()
    render(twoAnswers)
    expect(document.activeElement).not.toBe(button)
    act(() => root?.render(null))
    expect(document.activeElement).toBe(button)
    button.remove()
  })

  it('an element that is no longer in the document is left alone', () => {
    const button = opener()
    render(false)
    button.remove()
    act(() => root?.render(null))
    expect(document.activeElement).toBe(document.body)
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

/** A sheet that cannot be confirmed yet (YAZ-2677 🔒 D2): the box in Settings, until the typed ID letters are valid. */
describe('ConfirmSheet with confirmDisabled: the confirm button and Enter do nothing', () => {
  const renderDisabled = (confirmDisabled: boolean): HTMLElement => {
    Object.values(cb).forEach((fn) => fn.mockClear())
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(<ConfirmSheet labelId="t" text="Text" confirmLabel="Yes" confirmDisabled={confirmDisabled} onConfirm={cb.onConfirm} onCancel={cb.onCancel} />))
    return host
  }

  it('the confirm button is disabled and a click on it confirms nothing', () => {
    const el = renderDisabled(true)
    expect(buttons(el).map((b) => b.disabled)).toEqual([false, true])
    act(() => buttons(el)[1].click())
    expect(calls()).toEqual([0, 0, 0])
  })

  it('Enter confirms nothing, and is swallowed so it cannot press the focused Cancel', () => {
    renderDisabled(true)
    expect(key('Enter').defaultPrevented).toBe(true)
    expect(calls()).toEqual([0, 0, 0])
  })

  it('Cancel, Esc and a click outside still cancel', () => {
    const el = renderDisabled(true)
    act(() => buttons(el)[0].click())
    key('Escape')
    clickAway(el)
    expect(calls()).toEqual([0, 3, 0])
  })

  it('once it is false again, the button and Enter confirm', () => {
    const el = renderDisabled(true)
    act(() => root?.render(<ConfirmSheet labelId="t" text="Text" confirmLabel="Yes" confirmDisabled={false} onConfirm={cb.onConfirm} onCancel={cb.onCancel} />))
    expect(buttons(el)[1].disabled).toBe(false)
    act(() => buttons(el)[1].click())
    key('Enter')
    expect(calls()).toEqual([2, 0, 0])
  })
})
