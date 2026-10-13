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
    const [indent, setIndent] = useState(false)
    return <>
      <PageSettings lineNumbers={on} onToggleLineNumbers={() => setOn((value) => !value)} sectionIndent={indent} onToggleSectionIndent={() => setIndent((value) => !value)} headingLevels={false} onToggleHeadingLevels={() => undefined} readText={readText} />
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
/** The second switch (YAZ-2709). */
const indentToggle = () => menu()!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')[1]
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

  it('"Line numbers" is the first switch: it flips the host state and leaves the menu open (S5, S6)', () => {
    mount()
    click(cog())
    // This host hands no table of contents handler, as the app does with the setting Off: three switches.
    expect([...menu()!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Line numbers', 'Section indent', 'Heading levels'])
    expect(toggle().textContent).toContain('Line numbers')
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    click(toggle())
    expect(menu()).not.toBeNull()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(toggle().textContent).toContain('✓')
    click(toggle())
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
  })

  it('has "Section indent" under it: its own switch, which leaves "Line numbers" and the open menu alone (YAZ-2709)', () => {
    mount()
    click(cog())
    expect(indentToggle().getAttribute('aria-pressed')).toBe('false')
    click(indentToggle())
    expect(menu()).not.toBeNull()
    expect(indentToggle().getAttribute('aria-pressed')).toBe('true')
    expect(indentToggle().textContent).toContain('✓')
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    click(indentToggle())
    expect(indentToggle().getAttribute('aria-pressed')).toBe('false')
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
      return <PageSettings lineNumbers={false} onToggleLineNumbers={() => undefined} sectionIndent={false} onToggleSectionIndent={() => undefined} headingLevels={false} onToggleHeadingLevels={() => undefined} tableOfContents onToggleTableOfContents={() => undefined} tocSource={source} onChangeTocSource={shown ? onChange : undefined} readText={readText} />
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

  it('a mount that passes no handler has no such control', () => {
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
    expect(order).toEqual(['Line numbers', 'Section indent', 'Heading levels', 'Table of contents✓', 'page-settings__label', 'page-settings__choices', 'page-settings__divider', '1 words', '4 characters'])
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

  /** The small "i" beside the label, and the text it opens. */
  describe('the "i"', () => {
    const info = () => menu()!.querySelector<HTMLButtonElement>('.page-settings__info')!
    const tip = () => container.querySelector<HTMLElement>('.page-settings__tip')
    // React hears `mouseenter` / `mouseleave` as the `mouseover` / `mouseout` that bubble.
    const mouse = (type: 'mouseover' | 'mouseout') => act(() => void info().dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body })))

    it('is a button in the label, named for what it explains, and no row or choice of the menu', () => {
      mountWith(null)
      expect(info().closest('.page-settings__label')).not.toBeNull()
      expect(info().getAttribute('aria-label')).toBe('About “TOC made from”')
      expect(info().hasAttribute('aria-pressed')).toBe(false)
      expect(choices()).not.toContain(info())
      // The label reads "TOC made from:" and nothing more: the "i" is a drawing.
      expect(info().textContent).toBe('')
      expect(tip()).toBeNull()
      expect(info().hasAttribute('aria-describedby')).toBe(false)
    })

    it('shows its text while the mouse is on it, BESIDE the menu and not in it, and says the approved words', () => {
      mountWith(null)
      mouse('mouseover')
      expect(tip()?.getAttribute('role')).toBe('tooltip')
      expect(menu()!.contains(tip())).toBe(false)
      expect(tip()?.parentElement).toBe(container.querySelector('.page-settings'))
      expect(info().getAttribute('aria-describedby')).toBe(tip()?.id)
      expect([...tip()!.querySelectorAll(':scope > p')].map((p) => p.textContent)).toEqual([
        'This sets what the table of contents of this page shows.',
        'If a selection finds less than two lines, no table of contents shows. Select Auto to get it back.',
        'The app saves the selection for this page.',
      ])
      expect([...tip()!.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['Auto', 'Headings', 'Bullets'])
      expect([...tip()!.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
        'The app selects. A page with two or more headings outside bullets shows its headings. Each other page shows its bullets.',
        'Shows each H1, H2 and H3. This includes the headings that are in bullets.',
        'Shows the bullets, to three levels.',
      ])
      // Reading it chose nothing and closed nothing.
      expect(changed).not.toHaveBeenCalled()
      expect(pressed()).toEqual(['Auto:true', 'Headings:false', 'Bullets:false'])
      mouse('mouseout')
      expect(tip()).toBeNull()
      expect(menu()).not.toBeNull()
    })

    it('shows it for the keyboard too: on focus, and gone on blur', () => {
      mountWith('headings')
      act(() => info().focus())
      expect(tip()).not.toBeNull()
      act(() => choices()[0].focus())
      expect(tip()).toBeNull()
    })

    it('goes with the menu, and a menu opened again starts without it', () => {
      mountWith(null)
      // The mouse rests on the "i" while Esc closes the menu from a choice: no `mouseleave` ever comes for a button that is gone.
      mouse('mouseover')
      act(() => choices()[1].focus())
      act(() => void choices()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(menu()).toBeNull()
      expect(tip()).toBeNull()
      click(cog())
      expect(menu()).not.toBeNull()
      expect(tip()).toBeNull()
    })
  })
})

/**
 * The two page switches of YAZ-2700: "Heading levels" (D12) and "Table of contents" (D15). Like
 * "Line numbers", each shows what the host keeps and asks the host to flip it; a host that hands no
 * handler for "Table of contents" gets no row for it.
 */
describe('PageSettings: Heading levels and Table of contents', () => {
  function mountSwitches(tableOfContentsRow = true) {
    readText = vi.fn(() => 'text')
    function Harness() {
      const [levels, setLevels] = useState(false)
      const [contents, setContents] = useState(true)
      return <PageSettings lineNumbers={false} onToggleLineNumbers={() => undefined}
        sectionIndent={false} onToggleSectionIndent={() => undefined}
        headingLevels={levels} onToggleHeadingLevels={() => setLevels((on) => !on)}
        tableOfContents={contents} onToggleTableOfContents={tableOfContentsRow ? () => setContents((on) => !on) : undefined}
        readText={readText} />
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<Harness />))
    click(cog())
  }
  const rows = () => [...menu()!.querySelectorAll<HTMLButtonElement>(':scope > button')]
  const row = (name: string) => rows().find((button) => button.textContent?.startsWith(name))!
  const state = () => rows().map((button) => `${button.textContent}:${button.getAttribute('aria-pressed')}`)

  it('stand under "Line numbers" and "Section indent" (YAZ-2709), in that order: "Heading levels" off and "Table of contents" on until the reader says otherwise', () => {
    mountSwitches()
    expect(state()).toEqual(['Line numbers:false', 'Section indent:false', 'Heading levels:false', 'Table of contents✓:true'])
  })

  it('each flips its own host state and no other, and leaves the menu open', () => {
    mountSwitches()
    click(row('Heading levels'))
    expect(state()).toEqual(['Line numbers:false', 'Section indent:false', 'Heading levels✓:true', 'Table of contents✓:true'])
    click(row('Table of contents'))
    expect(state()).toEqual(['Line numbers:false', 'Section indent:false', 'Heading levels✓:true', 'Table of contents:false'])
    click(row('Heading levels'))
    click(row('Table of contents'))
    expect(state()).toEqual(['Line numbers:false', 'Section indent:false', 'Heading levels:false', 'Table of contents✓:true'])
    expect(menu()).not.toBeNull()
  })

  it('a host that hands no handler for "Table of contents" gets no row for it: the app-wide setting is Off, so there is nothing to turn off here', () => {
    mountSwitches(false)
    expect(state()).toEqual(['Line numbers:false', 'Section indent:false', 'Heading levels:false'])
  })
})
