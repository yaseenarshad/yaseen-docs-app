/**
 * The page settings cog and its menu (YAZ-2643, cases S2–S6 and S13–S20). The host keeps the
 * switch; the menu only shows it, and counts the text ONCE, when it opens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TocSource } from '@shared/types'
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
const menu = () => container.querySelector<HTMLElement>('.page-settings__menu[role="group"]')
const toggle = () => menu()!.querySelector<HTMLButtonElement>('button[aria-pressed]')!
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
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    click(toggle())
    expect(menu()).not.toBeNull()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(toggle().textContent).toContain('✓')
    click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
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

/**
 * "TOC made from" (YAZ-2700 D14): what this page's table of contents is built from. One label and
 * three choices that are one control; the host keeps the choice (and saves it), the menu shows it.
 */
describe('PageSettings: TOC made from', () => {
  let changed: ReturnType<typeof vi.fn<(source: TocSource | null) => void>>

  function mountWith(initial: TocSource | null, shown = true) {
    readText = vi.fn(() => 'text')
    changed = vi.fn()
    function Harness() {
      const [source, setSource] = useState<TocSource | null>(initial)
      const onChange = (next: TocSource | null) => {
        changed(next)
        setSource(next)
      }
      return <PageSettings lineNumbers={false} onToggleLineNumbers={() => undefined} tableOfContents onToggleTableOfContents={() => undefined} contentsFrom={source} onChangeContentsFrom={shown ? onChange : undefined} readText={readText} />
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<Harness />))
    click(cog())
  }

  const group = () => menu()!.querySelector<HTMLElement>('[role="group"][aria-label="TOC made from"]')
  const choices = () => [...group()!.querySelectorAll<HTMLButtonElement>('button')]
  const pressed = () => choices().map((button) => `${button.textContent}:${button.getAttribute('aria-pressed')}`)

  it('a mount that passes no handler has no such control: the menu is as it was', () => {
    mount()
    click(cog())
    expect(menu()!.textContent).not.toContain('TOC made from')
    expect(menu()!.querySelector('.page-settings__choices')).toBeNull()
  })

  it('shows a label and three choices in one group, after "Table of contents" and above the counts; Auto is pressed for a note with no choice', () => {
    mountWith(null)
    expect(menu()!.querySelector('.page-settings__label')?.textContent).toBe('TOC made from:')
    expect(pressed()).toEqual(['Auto:true', 'Headings:false', 'Bullets:false'])
    const order = [...menu()!.children].map((child) => child.className || child.textContent)
    expect(order).toEqual(['Line numbers', 'Table of contents✓', 'page-settings__label', 'page-settings__choices', 'page-settings__divider', '1 words', '4 characters'])
  })

  it('shows the saved choice pressed, and that one alone', () => {
    mountWith('bullets')
    expect(pressed()).toEqual(['Auto:false', 'Headings:false', 'Bullets:true'])
  })

  it('a click hands the host that source — null for Auto — and leaves the menu open with every choice still there', () => {
    mountWith(null)
    click(choices()[1])
    expect(changed).toHaveBeenLastCalledWith('headings')
    expect(pressed()).toEqual(['Auto:false', 'Headings:true', 'Bullets:false'])
    click(choices()[2])
    expect(changed).toHaveBeenLastCalledWith('bullets')
    expect(pressed()).toEqual(['Auto:false', 'Headings:false', 'Bullets:true'])
    click(choices()[0])
    expect(changed).toHaveBeenLastCalledWith(null)
    expect(pressed()).toEqual(['Auto:true', 'Headings:false', 'Bullets:false'])
    expect(changed).toHaveBeenCalledTimes(3)
    expect(menu()).not.toBeNull()
  })

  it('is gone when the host passes no handler, though a source is saved: this page shows no table of contents', () => {
    mountWith('headings', false)
    expect(group()).toBeNull()
    expect(menu()!.textContent).not.toContain('TOC made from')
  })
})
