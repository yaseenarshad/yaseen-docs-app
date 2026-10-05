/**
 * The page title (⚡ YAZ-888): the page's title, editable in place. A commit is a title edit
 * (YAZ-2420 D16), through App's one rename door, which confirms.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageTitle } from './PageTitle'
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

const PATH = '/vault/Docs/Old Note.md'

function mount(opts: { path?: string; kind?: 'file' | 'dir'; titles?: PathTitles } = {}) {
  const onRetitle = vi.fn()
  const onArrowDown = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <PageTitle path={opts.path ?? PATH} kind={opts.kind} titles={opts.titles ?? new Map()} onRetitle={onRetitle} onArrowDown={onArrowDown} />,
    ),
  )
  return { el: container, onRetitle, onArrowDown }
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
  it('a note with no title shows its file name minus the extension', () => {
    const { el } = mount()
    expect(heading(el)?.textContent).toBe('Old Note')
    expect(input(el)).toBeNull()
  })

  it('E: the page title shows the note\'s title, and a folder\'s page its folder\'s (YAZ-2420 D14)', () => {
    const titles = new Map([['/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', 'UP-001 - Abdul'], ['/vault/Docs', 'Upwork 2026']])
    expect(heading(mount({ path: '/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', titles }).el)?.textContent).toBe('UP-001 - Abdul')
    act(() => root?.unmount())
    expect(heading(mount({ path: '/vault/Docs', kind: 'dir', titles }).el)?.textContent).toBe('Upwork 2026')
  })

  it('a click swaps the heading for an input prefilled with the current name', () => {
    const { el } = mount()
    act(() => heading(el)?.click())
    expect(heading(el)).toBeNull()
    expect(input(el)?.defaultValue).toBe('Old Note')
  })

  it('Enter commits the TITLE typed: the name on disk is not the heading\'s to build (YAZ-2420 D16)', () => {
    const { el, onRetitle } = mount()
    act(() => heading(el)?.click())
    type(el, 'New Note')
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith('New Note')
    // The input closes on commit; the heading still reads the OLD name until the path changes.
    expect(input(el)).toBeNull()
    expect(heading(el)?.textContent).toBe('Old Note')
  })

  it('the field edits the TITLE, for a note and for a folder: it is prefilled with it, and the title unchanged commits nothing (YAZ-2420 D16)', () => {
    const titles = new Map([['/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', 'UP-001 - Abdul'], ['/vault/Docs', 'Upwork 2026']])
    const note = mount({ path: '/vault/Docs/up-001-abdul-k3m9x2pq7abc.md', titles })
    act(() => heading(note.el)?.click())
    expect(input(note.el)?.defaultValue).toBe('UP-001 - Abdul')
    type(note.el, 'UP-001 - Abdul')
    expect(note.onRetitle).not.toHaveBeenCalled()
    act(() => heading(note.el)?.click())
    type(note.el, 'up-001-abdul-k3m9x2pq7abc') // the file name is not what the field compares with
    expect(note.onRetitle).toHaveBeenCalledExactlyOnceWith('up-001-abdul-k3m9x2pq7abc')
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
    expect(heading(el)?.textContent).toBe('Old Note')
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
    expect(heading(el)?.textContent).toBe('Old Note')
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
    type(el, 'Old Note')
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

  it('a note named Home renames like any other note (YAZ-2290)', () => {
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
    expect(input(el)?.value).toBe('Old Note')
  })
})
