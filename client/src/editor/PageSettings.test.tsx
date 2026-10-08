/**
 * The page settings cog and its menu (YAZ-2643, cases S2–S6 and S13–S20). The host keeps the
 * switch; the menu only shows it, and counts the text ONCE, when it opens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageSettings } from './PageSettings'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let readText: ReturnType<typeof vi.fn<() => string>>

function mount(text = 'one two  three\nfour') {
  readText = vi.fn(() => text)
  function Harness() {
    const [on, setOn] = useState(false)
    return <>
      <PageSettings lineNumbers={on} onToggleLineNumbers={() => setOn((value) => !value)} readText={readText} />
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

const cog = () => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!
const menu = () => container.querySelector<HTMLElement>('.page-settings__menu')
const toggle = () => menu()!.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!
const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe('PageSettings', () => {
  it('opens under the cog on a click and closes on the second (S2)', () => {
    mount()
    expect(menu()).toBeNull()
    expect(cog().getAttribute('aria-expanded')).toBe('false')
    click(cog())
    expect(menu()).not.toBeNull()
    expect(cog().getAttribute('aria-expanded')).toBe('true')
    click(cog())
    expect(menu()).toBeNull()
  })

  it('closes on a click outside (S3)', () => {
    mount()
    click(cog())
    click(container.querySelector('[data-outside]')!)
    expect(menu()).toBeNull()
  })

  it('closes on Esc, keeps the key from the page, and puts the focus on the cog (S4)', () => {
    mount()
    click(cog())
    toggle().focus()
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const beyond = vi.fn()
    document.addEventListener('keydown', beyond)
    act(() => void toggle().dispatchEvent(esc))
    document.removeEventListener('keydown', beyond)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(cog())
    expect(esc.defaultPrevented).toBe(true)
    expect(beyond).not.toHaveBeenCalled()
  })

  it('has ONE switch, "Line numbers", which flips the host state and leaves the menu open (S5, S6)', () => {
    mount()
    click(cog())
    expect(menu()!.querySelectorAll('button')).toHaveLength(1)
    expect(toggle().textContent).toContain('Line numbers')
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    click(toggle())
    expect(menu()).not.toBeNull()
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(toggle().textContent).toContain('✓')
    click(toggle())
    expect(toggle().getAttribute('aria-checked')).toBe('false')
  })

  it('shows the words and the characters of the text (S13, S17, S18)', () => {
    mount('one two  three\nfour')
    click(cog())
    expect(menu()!.textContent).toContain('4 words')
    expect(menu()!.textContent).toContain('19 characters')
  })

  it('uses the locale’s separators (S19)', () => {
    mount('word '.repeat(1204))
    click(cog())
    expect(menu()!.textContent).toContain(`${(1204).toLocaleString()} words`)
    expect(menu()!.textContent).toContain(`${(6020).toLocaleString()} characters`)
  })

  it('shows zero for an empty note (S20)', () => {
    mount('')
    click(cog())
    expect(menu()!.textContent).toContain('0 words')
    expect(menu()!.textContent).toContain('0 characters')
  })

  it('reads the text once per open, never while closed, and not again on the switch (S14, S15)', () => {
    mount()
    expect(readText).not.toHaveBeenCalled()
    click(cog())
    expect(readText).toHaveBeenCalledTimes(1)
    click(toggle())
    expect(readText).toHaveBeenCalledTimes(1)
    click(cog())
    click(cog())
    expect(readText).toHaveBeenCalledTimes(2)
  })
})
