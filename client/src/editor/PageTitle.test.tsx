/**
 * The page title (⚡ YAZ-888): the page's title, editable in place. A commit is a title edit
 * (YAZ-2420 D16), through App's one rename door, which confirms.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageTitle } from './PageTitle'
import { READ_ONLY_EDIT, type ReadOnlyEditEvent } from './readOnlyEdit'
import type { PathTitles } from '../lib/pageLabel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const PATH = '/vault/Docs/Old Page.md'

function mount(opts: { path?: string; kind?: 'file' | 'dir'; titles?: PathTitles; readOnly?: boolean } = {}) {
  const onRetitle = vi.fn()
  const onArrowDown = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = (readOnly = opts.readOnly) =>
    act(() =>
      root?.render(
        <PageTitle path={opts.path ?? PATH} kind={opts.kind} titles={opts.titles ?? new Map()} onRetitle={onRetitle} onArrowDown={onArrowDown} readOnly={readOnly} />,
      ),
    )
  render()
  return { el: container, onRetitle, onArrowDown, render }
}

const heading = (el: HTMLElement) => el.querySelector<HTMLHeadingElement>('.page-title__text')
const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.page-title__input')
/** The open input, or a loud failure — every editing test starts here. */
const field = (el: HTMLElement) => {
  const f = input(el)
  if (f === null) throw new Error('the title input is not open')
  return f
}
const press = (node: Element, key: string) => act(() => void node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
const blur = (node: Element) => act(() => void node.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

/** Type into the open input the way a user does, then press `key`. */
function type(el: HTMLElement, value: string, key = 'Enter') {
  const f = field(el)
  f.value = value
  press(f, key)
}

describe('PageTitle (⚡ YAZ-888)', () => {
  it('a page with no title shows its file name minus the extension', () => {
    const { el } = mount()
    expect(heading(el)?.textContent).toBe('Old Page')
    expect(input(el)).toBeNull()
  })

  it('E: the page title shows the page\'s title, and a folder\'s page its folder\'s (YAZ-2420 D14)', () => {
    const titles = new Map([['/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', 'UP-001 - Abdul'], ['/vault/Docs', 'Upwork 2026']])
    expect(heading(mount({ path: '/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', titles }).el)?.textContent).toBe('UP-001 - Abdul')
    act(() => root?.unmount())
    expect(heading(mount({ path: '/vault/Docs', kind: 'dir', titles }).el)?.textContent).toBe('Upwork 2026')
  })

  it('a click swaps the heading for an input prefilled with the current name', () => {
    const { el } = mount()
    act(() => heading(el)?.click())
    expect(heading(el)).toBeNull()
    expect(input(el)?.defaultValue).toBe('Old Page')
  })

  it('Enter commits the TITLE typed: the name on disk is not the heading\'s to build (YAZ-2420 D16)', () => {
    const { el, onRetitle } = mount()
    act(() => heading(el)?.click())
    type(el, 'New Page')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith('New Page')
    // The input closes on commit; the heading still reads the OLD name until the path changes.
    expect(input(el)).toBeNull()
    expect(heading(el)?.textContent).toBe('Old Page')
  })

  it('the field edits the TITLE, for a page and for a folder: it is prefilled with it, and the title unchanged commits nothing (YAZ-2420 D16)', () => {
    const titles = new Map([['/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', 'UP-001 - Abdul'], ['/vault/Docs', 'Upwork 2026']])
    const page = mount({ path: '/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', titles })
    act(() => heading(page.el)?.click())
    expect(input(page.el)?.defaultValue).toBe('UP-001 - Abdul')
    type(page.el, 'UP-001 - Abdul')
    expect(page.onRetitle).not.toHaveBeenCalled()
    act(() => heading(page.el)?.click())
    type(page.el, 'up-001-abdul-k3m9x2pq7abc') // the file name is not what the field compares with
    expect(page.onRetitle).toHaveBeenCalledExactlyOnceWith('up-001-abdul-k3m9x2pq7abc')
    act(() => root?.unmount())
    const folder = mount({ path: '/vault/Docs', kind: 'dir', titles })
    act(() => heading(folder.el)?.click())
    expect(input(folder.el)?.defaultValue).toBe('Upwork 2026')
    type(folder.el, 'Upwork 2027')
    expect(folder.onRetitle).toHaveBeenCalledExactlyOnceWith('Upwork 2027')
  })

  it('Escape reverts and renames nothing', () => {
    const { el, onRetitle } = mount()
    act(() => heading(el)?.click())
    type(el, 'Discarded', 'Escape')
    expect(onRetitle).not.toHaveBeenCalled()
    expect(heading(el)?.textContent).toBe('Old Page')
  })

  it('leaving the field commits — click-away is the same gesture as Enter (YAZ-1553)', () => {
    const { el, onRetitle } = mount()
    act(() => heading(el)?.click())
    const f = field(el)
    f.value = 'Left Behind'
    blur(f)
    expect(onRetitle).toHaveBeenCalledWith('Left Behind')
    expect(input(el)).toBeNull()
  })

  it('Escape followed by the trailing blur Chromium fires on removal commits nothing (YAZ-1553, the settled guard)', () => {
    const { el, onRetitle } = mount()
    act(() => heading(el)?.click())
    const f = field(el)
    f.value = 'Discarded'
    act(() => {
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      f.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onRetitle).not.toHaveBeenCalled()
    expect(heading(el)?.textContent).toBe('Old Page')
  })

  it('one leave commits ONCE even when the trailing blur follows it (YAZ-1553)', () => {
    const { el, onRetitle } = mount()
    act(() => heading(el)?.click())
    const f = field(el)
    f.value = 'Once'
    act(() => {
      f.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      f.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onRetitle).toHaveBeenCalledTimes(1)
  })

  it('an empty or whitespace-only name never commits, and neither does the unchanged one', () => {
    const { el, onRetitle } = mount()
    act(() => heading(el)?.click())
    type(el, '   ')
    expect(onRetitle).not.toHaveBeenCalled()
    act(() => heading(el)?.click())
    type(el, 'Old Page')
    expect(onRetitle).not.toHaveBeenCalled()
  })

  it('a title is free text: `/`, `:`, `?`, quotes and a leading dot all commit (YAZ-2420 table B)', () => {
    const { el, onRetitle } = mount()
    for (const title of ['Docs/Nested', 'Q3: "what now"?', '.hidden']) {
      act(() => heading(el)?.click())
      type(el, title)
      expect(onRetitle).toHaveBeenLastCalledWith(title)
    }
  })

  it('ArrowDown is a leave too: it commits the changed name AND hands focus on to the editor (YAZ-1553)', () => {
    const { el, onRetitle, onArrowDown } = mount()
    act(() => heading(el)?.click())
    type(el, 'Half typed', 'ArrowDown')
    expect(onArrowDown).toHaveBeenCalledTimes(1)
    expect(onRetitle).toHaveBeenCalledWith('Half typed')
    expect(input(el)).toBeNull()
  })

  it('a page named Home renames like any other page (YAZ-2290)', () => {
    const { el, onRetitle } = mount({ path: '/vault/Home.md' })
    expect(heading(el)?.textContent).toBe('Home')
    expect(heading(el)?.tabIndex).toBe(0)
    act(() => heading(el)?.click())
    type(el, 'Start')
    expect(onRetitle).toHaveBeenCalledWith('Start')
  })

  it('a rename never REQUIRES the mouse: the heading is focusable and Enter opens the input (⚡ YAZ-891)', () => {
    const { el } = mount()
    expect(heading(el)?.tabIndex).toBe(0)
    press(heading(el)!, 'Enter')
    expect(input(el)?.value).toBe('Old Page')
  })
})

describe('PageTitle on a read-only page (YAZ-3076 S22)', () => {
  it('neither a click nor Enter opens the field; the heading is not a tab stop', () => {
    const { el } = mount({ readOnly: true })
    act(() => heading(el)?.click())
    expect(input(el)).toBeNull()
    press(heading(el)!, 'Enter')
    expect(input(el)).toBeNull()
    // YAZ-5141: it takes the keyboard on a click (for the chip's Enter), but Tab passes it.
    expect(heading(el)?.getAttribute('tabindex')).toBe('-1')
    expect(heading(el)?.getAttribute('aria-readonly')).toBe('true')
  })

  it('YAZ-5141: a click is an edit attempt — the pane hears it (the chip\'s card) and the title takes the keyboard; YAZ-5145 round 2: it carries the rename, which the chip runs once the page unlocks: the field opens at once', () => {
    const { el, render, onRetitle } = mount({ readOnly: true })
    const heard: ReadOnlyEditEvent[] = []
    el.addEventListener(READ_ONLY_EDIT, (e) => heard.push(e as ReadOnlyEditEvent))
    act(() => heading(el)?.click())
    expect(heard.map((e) => e.detail)).toEqual(['page'])
    expect(document.activeElement).toBe(heading(el))
    expect(input(el)).toBeNull()
    // The chip's "Allow edits" unlocks, then runs what the click carried.
    render(false)
    act(() => heard[0].resume?.())
    expect(document.activeElement).toBe(field(el))
    expect(field(el).value).toBe('Old Page')
    type(el, 'New Page')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith('New Page')
  })

  it('YAZ-5145 round 2: with no "Allow edits", an unlock alone opens no field', () => {
    const { el, render } = mount({ readOnly: true })
    act(() => heading(el)?.click())
    render(false)
    expect(input(el)).toBeNull()
  })

  it('YAZ-5141: read only for want of a rename door (`locked` false): a click tells nothing and takes no keyboard', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<PageTitle path={PATH} titles={new Map()} onRetitle={vi.fn()} readOnly locked={false} />))
    const heard: string[] = []
    container.addEventListener(READ_ONLY_EDIT, (e) => heard.push((e as CustomEvent<string>).detail))
    act(() => heading(container!)?.click())
    expect(heard).toEqual([])
    expect(heading(container)?.hasAttribute('tabindex')).toBe(false)
  })

  it('a field open when the switch turns on is put down unchanged — nothing is renamed', () => {
    const { el, onRetitle, render } = mount()
    act(() => heading(el)?.click())
    field(el).value = 'Half typed'
    render(true)
    expect(input(el)).toBeNull()
    expect(onRetitle).not.toHaveBeenCalled()
    expect(heading(el)?.textContent).toBe('Old Page')
  })
})

describe('the ID after the title (YAZ-4940 "In the title")', () => {
  const idButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.page-title__id')
  /** The ID handed in, and a notice sink: the component reads neither the index nor the setting; the editor does. */
  function mountWithId(id: string | undefined, opts: { readOnly?: boolean } = {}) {
    const onRetitle = vi.fn()
    const onNotice = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<PageTitle path={PATH} titles={new Map([[PATH, 'DNS basics']])} onRetitle={onRetitle} readOnly={opts.readOnly} id={id} onNotice={onNotice} />))
    return { el: container, onRetitle, onNotice }
  }

  it('shows the ID as its own element after the heading, never in the heading\'s text; with no ID nothing is drawn', () => {
    const { el } = mountWithId('EMB-46')
    expect(heading(el)?.textContent).toBe('DNS basics')
    expect(idButton(el)?.textContent).toBe('EMB-46')
    expect(idButton(el)?.previousElementSibling).toBe(heading(el))
    expect(idButton(el)?.getAttribute('title')).toBe('Copy the ID')
    act(() => root?.unmount())
    container?.remove()
    const none = mountWithId(undefined)
    expect(idButton(none.el)).toBeNull()
    expect(heading(none.el)?.textContent).toBe('DNS basics')
  })

  it('a click copies the ID and says "Copied EMB-46"; the heading does not open its field', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { el, onNotice } = mountWithId('EMB-46')
    await act(async () => idButton(el)?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('EMB-46')
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Copied EMB-46', 'info', 'clipboard')
    expect(input(el)).toBeNull()
  })

  it('a copy that fails says so', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('no clipboard'))) }, configurable: true })
    const { el, onNotice } = mountWithId('EMB-46')
    await act(async () => idButton(el)?.click())
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy the ID: no clipboard", 'error')
  })

  it('the open field takes the whole line: the ID is not drawn while the title is edited, and comes back after; a commit hands the title alone', () => {
    const { el, onRetitle } = mountWithId('EMB-46')
    act(() => heading(el)?.click())
    expect(idButton(el)).toBeNull()
    type(el, 'DNS basics 2')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith('DNS basics 2')
    expect(idButton(el)?.textContent).toBe('EMB-46')
  })

  it('a read-only page shows the ID too', () => {
    const { el } = mountWithId('EMB-46', { readOnly: true })
    expect(idButton(el)?.textContent).toBe('EMB-46')
  })
})
