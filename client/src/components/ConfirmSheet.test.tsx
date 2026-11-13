/** The confirm sheet's own rules: where the focus goes and comes back to, its keys, and a confirm that waits for input. `confirmSheets.test.tsx` pins each sheet built on it. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmSheet } from './ConfirmSheet'
import appCss from '../app.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const cb = { onConfirm: vi.fn(), onCancel: vi.fn() }
const calls = () => [cb.onConfirm.mock.calls.length, cb.onCancel.mock.calls.length]

function render(): HTMLElement {
  Object.values(cb).forEach((fn) => fn.mockClear())
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<ConfirmSheet labelId="t" text="Text" confirmLabel="Yes" onConfirm={cb.onConfirm} onCancel={cb.onCancel} />))
  return host
}

const key = (k: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void window.dispatchEvent(event))
  return event
}
const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')]
const clickAway = (el: HTMLElement) => act(() => void el.querySelector('.confirm-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))

describe('a sheet that goes away puts the focus back where it was', () => {
  const opener = (): HTMLButtonElement => {
    const button = document.body.appendChild(document.createElement('button'))
    button.focus()
    return button
  }

  it('on the element that had it when the sheet opened', () => {
    const button = opener()
    render()
    expect(document.activeElement).not.toBe(button)
    act(() => root?.render(null))
    expect(document.activeElement).toBe(button)
    button.remove()
  })

  it('an element that is no longer in the document is left alone', () => {
    const button = opener()
    render()
    button.remove()
    act(() => root?.render(null))
    expect(document.activeElement).toBe(document.body)
  })
})

describe('ConfirmSheet: its buttons and keys', () => {
  it('the second button says Cancel; Esc and a click outside cancel, Enter confirms', () => {
    const el = render()
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Cancel', 'Yes'])
    key('Escape')
    clickAway(el)
    expect(calls()).toEqual([0, 2])
    key('Enter')
    expect(calls()).toEqual([1, 2])
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
    expect(calls()).toEqual([0, 0])
  })

  it('Enter confirms nothing, and is swallowed so it cannot press the focused Cancel', () => {
    renderDisabled(true)
    expect(key('Enter').defaultPrevented).toBe(true)
    expect(calls()).toEqual([0, 0])
  })

  it('Cancel, Esc and a click outside still cancel', () => {
    const el = renderDisabled(true)
    act(() => buttons(el)[0].click())
    key('Escape')
    clickAway(el)
    expect(calls()).toEqual([0, 3])
  })

  it('once it is false again, the button and Enter confirm', () => {
    const el = renderDisabled(true)
    act(() => root?.render(<ConfirmSheet labelId="t" text="Text" confirmLabel="Yes" confirmDisabled={false} onConfirm={cb.onConfirm} onCancel={cb.onCancel} />))
    expect(buttons(el)[1].disabled).toBe(false)
    act(() => buttons(el)[1].click())
    key('Enter')
    expect(calls()).toEqual([2, 0])
  })
})

describe('YAZ-4989: a sheet of choices (the "This vault is read only" ask)', () => {
  const picked: string[] = []
  function renderChoices(): HTMLElement {
    picked.length = 0
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() =>
      root?.render(
        <ConfirmSheet
          labelId="t"
          text="This vault is read only."
          confirmLabel="Just this once"
          focusConfirm
          choices
          onConfirm={() => picked.push('once')}
          onCancel={() => picked.push('cancel')}
          other={
            <>
              <button type="button" className="confirm__btn" onClick={() => picked.push('minute')}>1 minute</button>
              <button type="button" className="confirm__btn" onClick={() => picked.push('ten')}>10 minutes</button>
            </>
          }
        />,
      ),
    )
    return host
  }
  const focused = () => document.activeElement?.textContent
  const press = (k: string, init: KeyboardEventInit = {}) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))

  it('the focus starts on Just this once; ↓ / Tab go Just this once → 1 minute → 10 minutes → Cancel and round; ↑ / ⇧Tab back', () => {
    renderChoices()
    expect(focused()).toBe('Just this once')
    const seen: (string | undefined)[] = []
    for (let i = 0; i < 4; i++) {
      press(i % 2 === 0 ? 'ArrowDown' : 'Tab')
      seen.push(focused())
    }
    expect(seen).toEqual(['1 minute', '10 minutes', 'Cancel', 'Just this once'])
    press('ArrowUp')
    expect(focused()).toBe('Cancel')
    press('Tab', { shiftKey: true })
    expect(focused()).toBe('10 minutes')
    expect(picked).toEqual([])
  })

  it('Enter picks the focused choice; Esc cancels', () => {
    renderChoices()
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    expect(picked).toEqual(['ten'])
    press('Escape')
    expect(picked).toEqual(['ten', 'cancel'])
  })

  it('a sheet without `choices` keeps its rule: Enter confirms wherever the focus is', () => {
    const el = render()
    act(() => buttons(el)[0].focus())
    key('Enter')
    expect(calls()).toEqual([1, 0])
  })
})

describe('YAZ-4964 round 2, item 3: the four choices of "This vault is read only" fit in the sheet', () => {
  const body = (selector: string): string => [...appCss.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel.trim() === selector)?.[2] ?? ''
  it('a sheet of choices is wider than a two-button sheet, and never wider than the window; its row wraps in a narrow window', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(<ConfirmSheet labelId="t" text="Text" confirmLabel="Just this once" choices onConfirm={() => {}} onCancel={() => {}} other={<button type="button" className="confirm__btn">1 minute</button>} />))
    expect(host.querySelector('.confirm')?.classList.contains('confirm--choices')).toBe(true)
    expect(body('.confirm.confirm--choices')).toMatch(/width:\s*min\(460px, calc\(100vw - 24px\)\)/)
    expect(body('.confirm--choices .confirm__actions')).toMatch(/flex-wrap:\s*wrap/)
  })
})
