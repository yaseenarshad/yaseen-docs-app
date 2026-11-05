/**
 * The "Read only" chip and its "Allow edits?" box (YAZ-3076 D4, cases S45-S48). The host keeps
 * whether the box is open (`asking`) and what "Allow edits" does; the chip only shows and asks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReadOnlyChip } from './ReadOnlyChip'
import { tellReadOnlyEdit } from './readOnlyEdit'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let allowed: ReturnType<typeof vi.fn<() => void>>

/** A host as the editors are: `readOnly` goes off on "Allow edits", and the chip goes with it. */
function mount() {
  allowed = vi.fn()
  function Harness() {
    const [readOnly, setReadOnly] = useState(true)
    const [asking, setAsking] = useState(false)
    return <>
      {readOnly && <ReadOnlyChip asking={asking} onAsk={() => setAsking(true)} onAllow={() => { allowed(); setAsking(false); setReadOnly(false) }} onCancel={() => setAsking(false)} />}
      <button data-outside>Outside</button>
    </>
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

const chip = () => container.querySelector<HTMLButtonElement>('.read-only-chip__button')
const box = () => container.querySelector<HTMLElement>('.read-only-chip__ask')
const button = (name: string) => [...(box()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === name)!
const click = (element: Element) => act(() => void element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const press = (element: Element, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => void element.dispatchEvent(event))
  return event
}

describe('ReadOnlyChip', () => {
  it('says "Read only" with a lock, and its tooltip says what a click does', () => {
    mount()
    expect(chip()?.textContent).toBe('Read only')
    expect(chip()?.querySelector('svg')).not.toBeNull()
    expect(chip()?.title).toBe('Click to allow edits')
    expect(chip()?.getAttribute('aria-expanded')).toBe('false')
    expect(box()).toBeNull()
  })

  it('S45: a click opens the "Allow edits?" box under it; a second click closes it', () => {
    mount()
    click(chip()!)
    expect(box()?.getAttribute('role')).toBe('dialog')
    expect(box()?.querySelector('p')?.textContent).toBe('Allow edits?')
    expect([...box()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Allow edits', 'Cancel'])
    expect(chip()?.getAttribute('aria-expanded')).toBe('true')
    click(chip()!)
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
  })

  it('S46: the focus goes to "Allow edits", so Enter allows', () => {
    mount()
    click(chip()!)
    expect(document.activeElement).toBe(button('Allow edits'))
  })

  it('S46: Esc cancels, keeps the key from the page, and puts the focus on the chip', () => {
    mount()
    click(chip()!)
    const beyond = vi.fn()
    document.addEventListener('keydown', beyond)
    const esc = press(button('Allow edits'), 'Escape')
    document.removeEventListener('keydown', beyond)
    expect(box()).toBeNull()
    expect(esc.defaultPrevented).toBe(true)
    expect(beyond).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(chip())
    expect(allowed).not.toHaveBeenCalled()
  })

  it('S46: a press outside cancels; Cancel cancels', () => {
    mount()
    click(chip()!)
    act(() => void container.querySelector('[data-outside]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(box()).toBeNull()
    click(chip()!)
    click(button('Cancel'))
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
    expect(chip()).not.toBeNull()
  })

  it('a press inside the box is not "outside"', () => {
    mount()
    click(chip()!)
    act(() => void box()!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(box()).not.toBeNull()
  })

  it('S46: a press on a canvas that cancels its pointerdown (Excalidraw\u2019s view mode pans on it, so no mousedown follows) still cancels', () => {
    mount()
    click(chip()!)
    const canvas = container.querySelector('[data-outside]')!
    canvas.addEventListener('pointerdown', (e) => e.preventDefault())
    act(() => void canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true })))
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
  })

  it('S46: the window losing focus cancels — a press inside the draw.io frame never reaches this document', () => {
    mount()
    click(chip()!)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(box()).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
  })

  it('S48: "Allow edits" turns read only off, and the chip goes', () => {
    mount()
    click(chip()!)
    click(button('Allow edits'))
    expect(allowed).toHaveBeenCalledTimes(1)
    expect(chip()).toBeNull()
    expect(box()).toBeNull()
  })

  it('Esc with the box closed is not the chip’s: the page keeps it', () => {
    mount()
    const esc = press(chip()!, 'Escape')
    expect(esc.defaultPrevented).toBe(false)
  })
})

/**
 * The message of an edit attempt (YAZ-4446, D33 of YAZ-4278): a Read only guard tells its pane (`tellReadOnlyEdit`), and
 * the pane's chip shows a small card under it, a red arrow pointing up at it, and pulses once.
 */
describe('the edit-attempt message (YAZ-4446)', () => {
  /** Two panes, as a split view has: each a `section.editor` with its own chip and its own body. */
  function mountPanes() {
    function Pane({ id }: { id: string }) {
      const [asking, setAsking] = useState(false)
      return <section className="editor" data-pane={id}>
        <ReadOnlyChip asking={asking} onAsk={() => setAsking(true)} onAllow={() => setAsking(false)} onCancel={() => setAsking(false)} />
        <div data-body={id} />
        <div role="dialog"><div data-popup={id} /></div>
      </section>
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<><Pane id="a" /><Pane id="b" /></>))
  }
  const pane = (id: string) => container.querySelector<HTMLElement>(`[data-pane="${id}"]`)!
  const card = (id: string) => pane(id).querySelector<HTMLElement>('.read-only-message__card')
  const status = (id: string) => pane(id).querySelector<HTMLElement>('[role="status"]')
  const paneChip = (id: string) => pane(id).querySelector<HTMLButtonElement>('.read-only-chip__button')!
  const attempt = (selector: string, what: 'note' | 'drawing' = 'note') => act(() => tellReadOnlyEdit(container.querySelector(selector)!, what))

  afterEach(() => vi.useRealTimers())

  it('an attempt shows the card in plain words, as a status, under the chip; the chip pulses', () => {
    vi.useFakeTimers()
    mountPanes()
    expect(card('a')).toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(false)
    attempt('[data-body="a"]')
    expect(card('a')?.textContent).toBe('This note is Read only.Click Read only to allow edits.')
    expect(status('a')?.contains(card('a'))).toBe(true)
    expect(card('a')?.querySelector('.read-only-message__arrow svg')).not.toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(true)
    // It is the chip's own: the card sits in the chip's box, so nothing in the page moves.
    expect(pane('a').querySelector('.read-only-chip')?.contains(card('a'))).toBe(true)
  })

  it('a drawing says "drawing"', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="a"]', 'drawing')
    expect(card('a')?.querySelector('strong')?.textContent).toBe('This drawing is Read only.')
  })

  it('it shows only in the pane typed in (a split view), and not for a popup in that pane', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="b"]')
    expect(card('a')).toBeNull()
    expect(card('b')).not.toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(false)
    attempt('[data-popup="a"]', 'drawing')
    expect(card('a')).toBeNull()
  })

  it('more attempts keep ONE card up and start its time again; it goes about 2.5 s after the last one', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="a"]')
    for (let i = 0; i < 5; i++) {
      act(() => vi.advanceTimersByTime(2000))
      attempt('[data-body="a"]')
      expect(pane('a').querySelectorAll('.read-only-message__card')).toHaveLength(1)
    }
    act(() => vi.advanceTimersByTime(2400))
    expect(card('a')).not.toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(card('a')).toBeNull()
    expect(paneChip('a').classList.contains('read-only-chip__button--pulse')).toBe(false)
  })

  it('it shows at most once a second: closed early by the chip, the next attempt within 1 s shows nothing', () => {
    vi.useFakeTimers()
    mountPanes()
    attempt('[data-body="a"]')
    click(paneChip('a'))
    // The "Allow edits?" box answers the chip now: the card goes.
    expect(card('a')).toBeNull()
    click(paneChip('a'))
    act(() => vi.advanceTimersByTime(500))
    attempt('[data-body="a"]')
    expect(card('a')).toBeNull()
    act(() => vi.advanceTimersByTime(600))
    attempt('[data-body="a"]')
    expect(card('a')).not.toBeNull()
  })
})
