/**
 * The page settings cog and its menu (YAZ-2643, cases S2–S6 and S13–S20). The host keeps the
 * switch; the menu only shows it, and counts the text ONCE, when it opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OutsideChangeGlow, TocSource } from '@shared/types'
import { PageSettings, type PageSwitch } from './PageSettings'

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
      <PageSettings readOnly={false} onToggleReadOnly={() => undefined} lineNumbers={on} onToggleLineNumbers={() => setOn((value) => !value)} sectionIndent={indent} onToggleSectionIndent={() => setIndent((value) => !value)} headingLevels={false} onToggleHeadingLevels={() => undefined} readText={readText} />
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
/** The menu: on the page, in `document.body` (YAZ-4776), not under the cog. */
const menu = () => document.querySelector<HTMLElement>('.page-settings__menu[role="group"]')
/** A switch of the menu by its name: "Read only" stands first (YAZ-3076), so the rows are found by what they say. */
const switchNamed = (name: string) => [...menu()!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((button) => button.textContent?.startsWith(name))!
const toggle = () => switchNamed('Line numbers')
/** The switch under it (YAZ-2709). */
const indentToggle = () => switchNamed('Section indent')
const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
/** A real press: `pointerdown`, then the `click` (a press outside closes on the first). */
const press = (element: Element) => {
  act(() => void element.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  click(element)
}

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

  it('closes on a press outside (S3)', () => {
    mount()
    click(cog())
    press(container.querySelector('[data-outside]')!)
    expect(menu()).toBeNull()
  })

  it('YAZ-3121: closes when the window loses focus — a press inside the draw.io frame reaches no event of this document', () => {
    mount()
    click(cog())
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(menu()).toBeNull()
  })

  it('YAZ-3121: closes on a press whose pointerdown a canvas cancels (no mousedown or click may follow)', () => {
    mount()
    click(cog())
    const canvas = container.querySelector('[data-outside]')!
    canvas.addEventListener('pointerdown', (e) => e.preventDefault())
    act(() => void canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true })))
    expect(menu()).toBeNull()
  })

  it('a press on the cog or inside the menu is not "outside": the cog\u2019s own click toggles it', () => {
    mount()
    click(cog())
    press(toggle())
    expect(menu()).not.toBeNull()
    press(cog())
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
    // This host hands no table of contents handler, as a board, a drawing and a diagram do: four switches.
    expect([...menu()!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Read only', 'Line numbers', 'Section indent', 'Heading levels'])
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
      return <PageSettings readOnly={false} onToggleReadOnly={() => undefined} lineNumbers={false} onToggleLineNumbers={() => undefined} sectionIndent={false} onToggleSectionIndent={() => undefined} headingLevels={false} onToggleHeadingLevels={() => undefined} tableOfContents onToggleTableOfContents={() => undefined} tocSource={source} onChangeTocSource={shown ? onChange : undefined} readText={readText} />
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
    expect(order).toEqual(['Read only', 'Line numbers', 'Section indent', 'Heading levels', 'Table of contents✓', 'page-settings__label', 'page-settings__choices', 'page-settings__divider', '1 words', '4 characters'])
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
        'Shows each heading from H1 to H5. This includes the headings that are in bullets.',
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
      return <PageSettings readOnly={false} onToggleReadOnly={() => undefined} lineNumbers={false} onToggleLineNumbers={() => undefined}
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
    expect(state()).toEqual(['Read only:false', 'Line numbers:false', 'Section indent:false', 'Heading levels:false', 'Table of contents✓:true'])
  })

  it('each flips its own host state and no other, and leaves the menu open', () => {
    mountSwitches()
    click(row('Heading levels'))
    expect(state()).toEqual(['Read only:false', 'Line numbers:false', 'Section indent:false', 'Heading levels✓:true', 'Table of contents✓:true'])
    click(row('Table of contents'))
    expect(state()).toEqual(['Read only:false', 'Line numbers:false', 'Section indent:false', 'Heading levels✓:true', 'Table of contents:false'])
    click(row('Heading levels'))
    click(row('Table of contents'))
    expect(state()).toEqual(['Read only:false', 'Line numbers:false', 'Section indent:false', 'Heading levels:false', 'Table of contents✓:true'])
    expect(menu()).not.toBeNull()
  })

  it('a host that hands no handler for "Table of contents" gets no row for it: a board, a drawing and a diagram have no table of contents (YAZ-3558 D1: a note always hands one)', () => {
    mountSwitches(false)
    expect(state()).toEqual(['Read only:false', 'Line numbers:false', 'Section indent:false', 'Heading levels:false'])
  })
})

/**
 * "Read only" (YAZ-3076 D3, D4): the first row on every kind of file. The host decides what the
 * row does — on at once, or the "Allow edits?" box — and the menu closes when the box is to open.
 */
describe('PageSettings: Read only', () => {
  let toggled: ReturnType<typeof vi.fn<() => void>>

  function mountReadOnly({ initial = false, board = false }: { initial?: boolean; board?: boolean } = {}) {
    readText = vi.fn(() => 'text')
    toggled = vi.fn()
    function Harness() {
      const [on, setOn] = useState(initial)
      // The host's rule (D4): off → on at once; on → the box, which this harness only records.
      const onToggle = () => {
        toggled()
        if (!on) setOn(true)
      }
      return board ? <PageSettings readOnly={on} onToggleReadOnly={onToggle} /> : <PageSettings readOnly={on} onToggleReadOnly={onToggle} lineNumbers={false} onToggleLineNumbers={() => undefined} sectionIndent={false} onToggleSectionIndent={() => undefined} headingLevels={false} onToggleHeadingLevels={() => undefined} readText={readText} />
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<Harness />))
    click(cog())
  }

  it('S41: "Read only" is the first row of a note\u2019s menu', () => {
    mountReadOnly()
    expect(menu()!.querySelector('button')?.textContent).toBe('Read only')
  })

  it('a host with no switch (a code file, YAZ-3448) hands no handler, and gets no row', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<PageSettings lineNumbers={false} onToggleLineNumbers={() => undefined} />))
    click(cog())
    expect([...menu()!.children].map((child) => child.textContent)).toEqual(['Line numbers'])
  })

  it('a code tab (YAZ-3449) passes its own rows: each shows its check mark, a click calls only its handler, and the menu stays open', () => {
    const calls: string[] = []
    function Harness() {
      const [rows, setRows] = useState({ 'Read only (all code files)': false, 'Wrap long lines': true, Minimap: false })
      const switches = Object.entries(rows).map(([label, on]) => ({ label, on, onToggle: () => {
        calls.push(label)
        setRows((now) => ({ ...now, [label]: !on }))
      } }))
      return <PageSettings switches={switches} />
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<Harness />))
    click(cog())
    expect([...menu()!.children].map((child) => child.textContent)).toEqual(['Read only (all code files)', 'Wrap long lines\u2713', 'Minimap'])
    expect(switchNamed('Wrap long lines').getAttribute('aria-pressed')).toBe('true')
    click(switchNamed('Read only (all code files)'))
    click(switchNamed('Minimap'))
    expect(calls).toEqual(['Read only (all code files)', 'Minimap'])
    expect(menu()).not.toBeNull()
    expect([...menu()!.children].map((child) => child.textContent)).toEqual(['Read only (all code files)\u2713', 'Wrap long lines\u2713', 'Minimap\u2713'])
    // No counts: a code tab hands no `readText`.
    expect(menu()!.textContent).not.toContain('words')
  })

  it('a heading over the code rows (YAZ-3458): one group with its name, a line, then this page\'s "Table of contents"', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const switches = ['Read only', 'Wrap long lines', 'Minimap'].map((label) => ({ label, on: false, onToggle: () => undefined }))
    act(() => root.render(<PageSettings switches={switches} switchesHeading="All code files" tableOfContents onToggleTableOfContents={() => undefined} />))
    click(cog())
    const group = menu()!.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('All code files')
    expect([...group.children].map((child) => child.textContent)).toEqual(['All code files', 'Read only', 'Wrap long lines', 'Minimap'])
    expect([...menu()!.children].map((child) => child.className)).toEqual(['', 'page-settings__divider', ''])
    expect(menu()!.lastElementChild!.textContent).toBe('Table of contents\u2713')
  })

  it('S41: a board\u2019s menu has only that row, and no counts', () => {
    mountReadOnly({ board: true })
    expect([...menu()!.children].map((child) => child.textContent)).toEqual(['Read only'])
    expect(menu()!.textContent).not.toContain('words')
  })

  it('S43: a click while off turns it on at once; the menu stays open and the check mark shows', () => {
    mountReadOnly()
    click(switchNamed('Read only'))
    expect(toggled).toHaveBeenCalledTimes(1)
    expect(menu()).not.toBeNull()
    expect(switchNamed('Read only').getAttribute('aria-pressed')).toBe('true')
    expect(switchNamed('Read only').textContent).toBe('Read only✓')
  })

  it('S47: a click while on asks the host (the box) and closes the menu', () => {
    mountReadOnly({ initial: true })
    expect(switchNamed('Read only').getAttribute('aria-pressed')).toBe('true')
    click(switchNamed('Read only'))
    expect(toggled).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })

  it('S42: a board\u2019s cog opens, closes on a second click and on Esc, as a note\u2019s does', () => {
    mountReadOnly({ board: true })
    click(cog())
    expect(menu()).toBeNull()
    click(cog())
    act(() => void switchNamed('Read only').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(menu()).toBeNull()
  })
})

/** A drawing's rows (YAZ-3943 D5, D13): an info row, action rows with no check mark, a disabled one, and lines between groups. */
describe('rows made while the menu is open (YAZ-3943)', () => {
  it('reads `rows` only while open; an action closes the menu; a disabled one does nothing; an info row is text', () => {
    const act1 = vi.fn()
    const act2 = vi.fn()
    const rows = vi.fn(() => [
      { label: 'Pictures in this file: 1.0 MB (2)', warn: true, divider: true },
      { label: 'Move pictures out', onToggle: act1, disabled: true },
      { label: 'Export Image or PDF…', onToggle: act2, divider: true },
    ])
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<PageSettings readOnly onToggleReadOnly={() => undefined} rows={rows} />))
    expect(rows).not.toHaveBeenCalled()
    click(cog())
    expect([...menu()!.children].map((c) => c.className || c.textContent)).toEqual(['Read only✓', 'page-settings__divider', 'page-settings__warn', 'Move pictures out', 'page-settings__divider', 'Export Image or PDF…'])
    const named = (label: string) => [...menu()!.querySelectorAll('button')].find((b) => b.textContent === label)!
    expect(named('Move pictures out').hasAttribute('aria-pressed')).toBe(false)
    click(named('Move pictures out'))
    expect(act1).not.toHaveBeenCalled()
    click(named('Export Image or PDF…'))
    expect(act2).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })

  /** A choice row (YAZ-4402 3A): the label, then one group of pills, as "TOC made from". */
  function mountChoices(disabled = false) {
    const picks = { a: vi.fn(), b: vi.fn(), c: vi.fn() }
    const rows = () => [
      { label: 'Link preview on hover', on: true, onToggle: () => undefined },
      {
        label: 'Fold arrows (app: hover)',
        divider: true,
        disabled,
        choices: [
          { label: 'App', on: false, onPick: picks.a, title: 'The app setting: Hover' },
          { label: 'Hover', on: true, onPick: picks.b },
          { label: 'Off', on: false, onPick: picks.c, title: 'No folding' },
        ],
      },
    ]
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<PageSettings readOnly={false} onToggleReadOnly={() => undefined} rows={rows} />))
    click(cog())
    const group = () => menu()!.querySelector<HTMLElement>('.page-settings__choices')!
    const pills = () => [...group().querySelectorAll<HTMLButtonElement>('button')]
    return { picks, group, pills }
  }

  it('YAZ-4402 3A: a choice row is its label, then one named group of pills; only the chosen pill is pressed, each has its tooltip', () => {
    const { group, pills } = mountChoices()
    expect([...menu()!.children].map((c) => c.className || c.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'page-settings__divider', 'page-settings__label', 'page-settings__choices'])
    expect(menu()!.querySelector('.page-settings__label')!.textContent).toBe('Fold arrows (app: hover):')
    expect(group().getAttribute('role')).toBe('group')
    expect(group().getAttribute('aria-label')).toBe('Fold arrows (app: hover)')
    expect(pills().map((b) => [b.textContent, b.getAttribute('aria-pressed'), b.getAttribute('title')])).toEqual([['App', 'false', 'The app setting: Hover'], ['Hover', 'true', null], ['Off', 'false', 'No folding']])
  })

  it('YAZ-4402 3A: a pick calls only its own handler and leaves the menu open', () => {
    const { picks, pills } = mountChoices()
    click(pills()[2])
    expect(picks.c).toHaveBeenCalledTimes(1)
    expect(picks.a).not.toHaveBeenCalled()
    expect(picks.b).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
    click(pills()[0])
    expect(picks.a).toHaveBeenCalledTimes(1)
    expect(menu()).not.toBeNull()
  })

  it('YAZ-4402 3A: a disabled choice row (Read only) greys out every pill, and a click picks nothing', () => {
    const { picks, pills } = mountChoices(true)
    expect(pills().map((b) => b.disabled)).toEqual([true, true, true])
    for (const b of pills()) click(b)
    expect(picks.a).not.toHaveBeenCalled()
    expect(picks.b).not.toHaveBeenCalled()
    expect(picks.c).not.toHaveBeenCalled()
  })
})

/** "Outside changes glow" (YAZ-4272 D5): this page's glow, one native dropdown; Default follows Settings. */
describe('PageSettings: Outside changes glow', () => {
  let changed: ReturnType<typeof vi.fn<(glow: OutsideChangeGlow | null) => void>>

  function mountWith(initial: OutsideChangeGlow | null, appGlow: OutsideChangeGlow = '60s') {
    readText = vi.fn(() => 'text')
    changed = vi.fn()
    function Harness() {
      const [glow, setGlow] = useState<OutsideChangeGlow | null>(initial)
      const onChange = (next: OutsideChangeGlow | null) => {
        changed(next)
        setGlow(next)
      }
      return <PageSettings readOnly={false} onToggleReadOnly={() => undefined} lineNumbers={false} onToggleLineNumbers={() => undefined} tableOfContents onToggleTableOfContents={() => undefined} tocSource={null} onChangeTocSource={() => undefined} outsideGlow={glow} appGlow={appGlow} onChangeOutsideGlow={onChange} readText={readText} />
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<Harness />))
    click(cog())
  }

  const select = () => menu()!.querySelector<HTMLSelectElement>('select.page-settings__select')
  const pick = (value: string) =>
    act(() => {
      select()!.value = value
      select()!.dispatchEvent(new Event('change', { bubbles: true }))
    })

  it('a mount that passes no handler has no dropdown (a board, a drawing, a code file)', () => {
    mount()
    click(cog())
    expect(select()).toBeNull()
    expect(menu()!.textContent).not.toContain('Outside changes glow')
  })

  it('a label and a dropdown after "TOC made from", above the counts; "Default" is chosen for a page with no choice, and its tooltip names Settings\u2019 glow', () => {
    mountWith(null, '5m')
    const label = menu()!.querySelector<HTMLLabelElement>('label.page-settings__label')!
    expect(label.textContent).toBe('Outside changes glow:')
    expect(label.htmlFor).toBe(select()!.id)
    expect([...select()!.options].map((option) => option.textContent)).toEqual(['Default', '1 minute', '5 minutes', 'Until I check it', 'Off'])
    expect(select()!.title).toBe('Default follows Settings: 5 minutes')
    expect(select()!.value).toBe('')
    const order = [...menu()!.children].map((child) => child.className || child.textContent)
    expect(order.slice(-6)).toEqual(['page-settings__divider', 'page-settings__label', 'page-settings__select', 'page-settings__divider', '1 words', '4 characters'])
  })

  it('shows the saved glow; a pick hands the host that glow, Default hands null, and the menu stays open', () => {
    mountWith('off')
    expect(select()!.value).toBe('off')
    pick('until-checked')
    expect(changed).toHaveBeenLastCalledWith('until-checked')
    expect(select()!.value).toBe('until-checked')
    pick('')
    expect(changed).toHaveBeenLastCalledWith(null)
    expect(select()!.value).toBe('')
    expect(changed).toHaveBeenCalledTimes(2)
    expect(menu()).not.toBeNull()
  })
})

/**
 * The menu on the page (YAZ-4776) and the (i) of a row (13BP CL4, YAZ-4748 demo): the menu is a portal in `document.body`,
 * placed under its cog and inside the window; a row's hint is an (i) whose box stands beside the menu, also on the page.
 */
describe('YAZ-4776, YAZ-4748: the menu on the page, and the (i) of a row', () => {
  /** What jsdom does not lay out: the cog's box, the menu's box and width, and each (i)'s box. */
  let boxes: { trigger: Partial<DOMRect>; menu: Partial<DOMRect>; info: Partial<DOMRect> }
  const at = (box: Partial<DOMRect>) => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...box }) as DOMRect
  let innerWidth: number
  beforeEach(() => {
    innerWidth = window.innerWidth
    boxes = { trigger: { left: 580, right: 600, top: 10, bottom: 30 }, menu: { left: 400, right: 600, top: 36, bottom: 336 }, info: { left: 500, right: 512, top: 60, bottom: 72 } }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('page-settings__trigger')) return at(boxes.trigger)
      if (this.classList.contains('page-settings__menu')) return at(boxes.menu)
      if (this.classList.contains('page-settings__info')) return at(boxes.info)
      return at({})
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('page-settings__menu') ? 200 : 0
    })
  })
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: innerWidth })
    vi.restoreAllMocks()
  })
  const setWindowWidth = (width: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })

  let onToggle: ReturnType<typeof vi.fn<() => void>>
  let onReadOnly: ReturnType<typeof vi.fn<() => void>>
  const LIST_HINT = { lead: 'The arrows left of a bullet.', rows: [['App', 'Follows Settings'], ['Off', 'No folding']] as const, foot: 'Saved in this file.' }
  function mountRows(rows: () => PageSwitch[]) {
    onReadOnly = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<><PageSettings readOnly={false} onToggleReadOnly={onReadOnly} rows={rows} readText={() => 'one two'} /><button data-outside>Outside</button></>))
    click(cog())
  }
  /** A drawing's rows: "Read only" where it stands, a switch and an action with an (i) each, and a choice row with a list (i). */
  function mountDrawingRows() {
    onToggle = vi.fn()
    mountRows(() => [
      { label: 'Read only', readOnlySlot: true, hint: 'Stops edits to this drawing.' },
      { label: 'Link preview on hover', hint: 'Rest the mouse on a link pill.', on: true, onToggle },
      { label: 'Fold arrows', hint: LIST_HINT, divider: true, choices: [{ label: 'App', on: true, onPick: () => undefined }] },
      { label: 'Export Image or PDF…', hint: 'Saves a picture of this drawing.', onToggle, divider: true },
    ])
  }
  const row = (name: string) => [...menu()!.querySelectorAll<HTMLButtonElement>(':scope > button')].find((b) => b.textContent?.startsWith(name))!
  const infoIn = (el: Element) => el.querySelector<HTMLElement>('.page-settings__info')!
  const hintBox = () => document.querySelector<HTMLElement>('.page-settings__tip--hint')
  const hover = (el: Element, type: 'mouseover' | 'mouseout') => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: null })))
  /** jsdom never matches `:focus-visible`: here the focused element matches it (a Tab), or never does (a mouse press). */
  const focusVisible = (visible: boolean) => {
    const matches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? visible && this === document.activeElement : matches.call(this, selector)
    })
  }

  it('the menu is in `document.body`, not under the cog, placed fixed with `--placed`, and closing it takes it away', () => {
    mountDrawingRows()
    expect(menu()!.parentElement).toBe(document.body)
    expect(container.querySelector('.page-settings__menu')).toBeNull()
    expect(menu()!.classList.contains('page-settings__menu--placed')).toBe(true)
    expect(cog().getAttribute('aria-controls')).toBe(menu()!.id)
    click(cog())
    expect(document.querySelector('.page-settings__menu')).toBeNull()
  })

  it('under its cog, right-aligned to it; moved left or right to stay inside the window, 8px from its edge', () => {
    mountDrawingRows()
    // The cog's right edge (600) less the menu's width (200), 6px under the cog.
    expect([menu()!.style.left, menu()!.style.top, menu()!.style.visibility]).toEqual(['400px', '36px', ''])
    click(cog())
    // A cog at the right edge of a narrow window: the menu ends 8px inside it.
    setWindowWidth(500)
    boxes.trigger = { left: 480, right: 500, top: 10, bottom: 30 }
    click(cog())
    expect([menu()!.style.left, menu()!.style.top]).toEqual(['292px', '36px'])
    click(cog())
    // A cog near the left edge (a sidebar would cover the menu): the menu starts 8px inside the window.
    boxes.trigger = { left: 40, right: 60, top: 100, bottom: 120 }
    click(cog())
    expect([menu()!.style.left, menu()!.style.top]).toEqual(['8px', '126px'])
  })

  it('a press inside the menu is not "outside", though the menu is not inside the cog’s box; a press outside both closes it', () => {
    mountDrawingRows()
    expect(container.contains(menu())).toBe(false)
    press(menu()!.querySelector('.page-settings__label')!)
    press(menu()!.lastElementChild!)
    expect(menu()).not.toBeNull()
    press(container.querySelector('[data-outside]')!)
    expect(menu()).toBeNull()
  })

  it('"Read only" stands where its row asks (`readOnlySlot`), once, with its (i); its (i) shows the hint and does not flip it', () => {
    onToggle = vi.fn()
    mountRows(() => [
      { label: 'Pictures: 2', warn: true },
      { label: 'Read only', readOnlySlot: true, hint: 'Stops edits to this drawing.' },
      { label: 'Export Image or PDF…', onToggle },
    ])
    expect([...menu()!.children].map((c) => c.className || c.textContent)).toEqual(['page-settings__warn', 'Read only', 'Export Image or PDF…', 'page-settings__divider', '2 words', '7 characters'])
    expect([...menu()!.querySelectorAll('button')].filter((b) => b.textContent === 'Read only')).toHaveLength(1)
    hover(infoIn(row('Read only')), 'mouseover')
    expect(hintBox()?.textContent).toBe('Stops edits to this drawing.')
    click(infoIn(row('Read only')))
    expect(onReadOnly).not.toHaveBeenCalled()
    expect(row('Read only').getAttribute('aria-pressed')).toBe('false')
    click(row('Read only'))
    expect(onReadOnly).toHaveBeenCalledTimes(1)
  })

  it('a host with no `readOnlySlot` row keeps "Read only" first, with no (i)', () => {
    mountRows(() => [{ label: 'Export Image or PDF…', onToggle: () => undefined }])
    expect(menu()!.querySelector('button')?.textContent).toBe('Read only')
    expect(infoIn(menu()!.querySelector('button')!)).toBeNull()
  })

  it('a row’s (i) is a glyph inside its button, hidden from the screen reader; the mouse on it shows the box on the page, beside the menu', () => {
    mountDrawingRows()
    const info = infoIn(row('Link preview on hover'))
    expect(info.tagName).toBe('SPAN')
    expect(info.getAttribute('aria-hidden')).toBe('true')
    expect(row('Link preview on hover').textContent).toBe('Link preview on hover✓')
    expect(hintBox()).toBeNull()
    hover(info, 'mouseover')
    expect(hintBox()!.getAttribute('role')).toBe('tooltip')
    expect(hintBox()!.textContent).toBe('Rest the mouse on a link pill.')
    expect(hintBox()!.parentElement).toBe(document.body)
    expect(menu()!.contains(hintBox())).toBe(false)
    hover(info, 'mouseout')
    expect(hintBox()).toBeNull()
  })

  it('a click on a switch’s (i) shows the box and does not flip the switch; a click on an action’s (i) neither acts nor closes the menu', () => {
    mountDrawingRows()
    click(infoIn(row('Link preview on hover')))
    expect(hintBox()?.textContent).toBe('Rest the mouse on a link pill.')
    expect(onToggle).not.toHaveBeenCalled()
    click(infoIn(row('Export Image or PDF…')))
    expect(hintBox()?.textContent).toBe('Saves a picture of this drawing.')
    expect(onToggle).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
    // The row itself still works.
    click(row('Link preview on hover'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('the keyboard on the row (focus-visible) shows the box, and the row names it (`aria-describedby`); blur takes it away', () => {
    mountDrawingRows()
    const link = row('Link preview on hover')
    expect(link.hasAttribute('aria-describedby')).toBe(false)
    focusVisible(true)
    act(() => link.focus())
    expect(hintBox()?.textContent).toBe('Rest the mouse on a link pill.')
    expect(link.getAttribute('aria-describedby')).toBe(hintBox()!.id)
    act(() => link.blur())
    expect(hintBox()).toBeNull()
    expect(link.hasAttribute('aria-describedby')).toBe(false)
  })

  it('a focus that is not focus-visible (a mouse press) shows no box', () => {
    mountDrawingRows()
    const link = row('Link preview on hover')
    focusVisible(false)
    act(() => link.focus())
    expect(hintBox()).toBeNull()
  })

  it('a choice row with a hint: its label ends in an (i) button, not a colon; a list hint is a line, the terms with their meanings, and a last line', () => {
    mountDrawingRows()
    const label = [...menu()!.querySelectorAll('.page-settings__label')].find((p) => p.textContent?.startsWith('Fold arrows'))!
    expect(label.textContent).toBe('Fold arrows')
    const info = label.querySelector<HTMLButtonElement>('button.page-settings__info')!
    expect(info.getAttribute('aria-label')).toBe('About Fold arrows')
    hover(info, 'mouseover')
    expect([...hintBox()!.querySelectorAll(':scope > p')].map((p) => p.textContent)).toEqual(['The arrows left of a bullet.', 'Saved in this file.'])
    expect([...hintBox()!.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['App', 'Off'])
    expect([...hintBox()!.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['Follows Settings', 'No folding'])
    expect(info.getAttribute('aria-describedby')).toBe(hintBox()!.id)
  })

  it('the box stands left of the menu, level with its (i); with no room there, right of it; with no room either side, under the (i)', () => {
    mountDrawingRows()
    const info = infoIn(row('Link preview on hover'))
    // Left: the menu's left (400) less the box (240) and its 8px gap; 10px above the (i)'s top.
    hover(info, 'mouseover')
    expect([hintBox()!.style.left, hintBox()!.style.top]).toEqual(['152px', '50px'])
    hover(info, 'mouseout')
    boxes.menu = { left: 100, right: 300, top: 36, bottom: 336 }
    hover(info, 'mouseover')
    expect([hintBox()!.style.left, hintBox()!.style.top]).toEqual(['308px', '50px'])
    hover(info, 'mouseout')
    setWindowWidth(400)
    boxes.menu = { left: 100, right: 300, top: 36, bottom: 336 }
    hover(info, 'mouseover')
    expect([hintBox()!.style.left, hintBox()!.style.top]).toEqual(['152px', '78px'])
  })

  it('closing the menu takes the box with it, and the menu opened again starts without it', () => {
    mountDrawingRows()
    hover(infoIn(row('Link preview on hover')), 'mouseover')
    expect(hintBox()).not.toBeNull()
    // Esc from the row: the mouse still rests on the (i), so no `mouseleave` comes.
    act(() => void row('Link preview on hover').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(menu()).toBeNull()
    expect(hintBox()).toBeNull()
    click(cog())
    expect(hintBox()).toBeNull()
    hover(infoIn(row('Link preview on hover')), 'mouseover')
    press(container.querySelector('[data-outside]')!)
    expect(hintBox()).toBeNull()
  })
})

describe('YAZ-4810 5G: Tab between the cog and its menu, which is on document.body', () => {
  const tab = (element: Element, shiftKey = false) =>
    act(() => void element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })))
  const items = () => [...menu()!.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]

  it('Tab on the open cog goes to the first row; Shift+Tab there goes back to the cog, and the menu stays open', () => {
    mount()
    cog().focus()
    click(cog())
    tab(cog())
    expect(document.activeElement).toBe(items()[0])
    tab(items()[0]!, true)
    expect(document.activeElement).toBe(cog())
    expect(menu()).not.toBeNull()
  })

  it('Tab on the last row closes the menu on the cog, as Esc does; a Tab between rows is the browser\u2019s own', () => {
    mount()
    click(cog())
    const all = items()
    expect(all.length).toBeGreaterThan(1)
    const middle = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => void all[0]!.dispatchEvent(middle))
    expect(middle.defaultPrevented).toBe(false)
    all[all.length - 1]!.focus()
    tab(all[all.length - 1]!)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(cog())
  })

  it('a closed cog leaves Tab alone', () => {
    mount()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => void cog().dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
  })
})
