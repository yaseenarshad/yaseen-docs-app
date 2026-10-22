/**
 * The "Read only" chip and its "Allow edits?" box (YAZ-3076 D4, cases S45-S48). The host keeps
 * whether the box is open (`asking`) and what "Allow edits" does; the chip only shows and asks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReadOnlyChip } from './ReadOnlyChip'

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

  it('S46: a click outside cancels; Cancel cancels', () => {
    mount()
    click(chip()!)
    act(() => void container.querySelector('[data-outside]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
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
    act(() => void box()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(box()).not.toBeNull()
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
