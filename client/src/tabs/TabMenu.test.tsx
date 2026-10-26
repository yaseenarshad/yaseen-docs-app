/** The tab menu's groups (YAZ-2949 D3, D6): four groups in the sidebar menu's order, the display-name items, and what hides; its "Move to ▸" flyout (YAZ-3091 D3). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TabMenu, type TabMenuAt, type TabMenuProps } from './TabMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

const at = (over: Partial<TabMenuAt> = {}): TabMenuAt => ({ x: 0, y: 0, id: 't1', path: '/v/a.md', review: false, named: false, ...over })
const all = (over: Partial<TabMenuProps> = {}): TabMenuProps => ({
  menu: at(),
  label: 'A',
  onClose: vi.fn(),
  onMoveToRight: vi.fn(),
  onMoveToNewWindow: vi.fn(),
  onDuplicate: vi.fn(),
  onRename: vi.fn(),
  onResetName: vi.fn(),
  onShowInSidebar: vi.fn(),
  onSetReview: vi.fn(),
  ...over,
})
function mount(props: TabMenuProps): HTMLElement {
  const el = document.createElement('div')
  root = createRoot(el)
  act(() => root?.render(<TabMenu {...props} />))
  return el
}
const groups = (el: HTMLElement) => [...el.querySelectorAll('.ctx-menu [role="group"]')].map((g) => [...g.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent))
const item = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === label)

describe('TabMenu (YAZ-2949 D6)', () => {
  it('S26: four groups in the sidebar menu\'s order; "Reset to page name" only on a named tab', () => {
    expect(groups(mount(all()))).toEqual([
      ['Move to new window', 'Duplicate tab', 'Move to'],
      ['Show in sidebar', 'Copy path'],
      ['Set display name', 'Turn review on'],
      ['Reveal in Finder', 'Open in VS Code'],
    ])
    act(() => root?.unmount())
    expect(groups(mount(all({ menu: at({ named: true, review: true }) })))[2]).toEqual(['Set display name', 'Reset to page name', 'Turn review off'])
  })

  it('S27-S29: a group with nothing in it draws no group — a folder tab with upkeep off and no move doors keeps three', () => {
    const el = mount({ menu: at({ review: null }), label: 'A', onClose: vi.fn() })
    expect(groups(el)).toEqual([['Show in sidebar', 'Copy path'], ['Reveal in Finder', 'Open in VS Code']])
  })

  it('D3: "Set display name" and "Reset to page name" call their doors with the tab\'s id, and the menu closes', () => {
    const props = all({ menu: at({ named: true }) })
    let el = mount(props)
    act(() => item(el, 'Set display name')?.click())
    expect(props.onRename).toHaveBeenCalledWith('t1')
    expect(props.onClose).toHaveBeenCalledTimes(1)
    act(() => root?.unmount())
    el = mount(props)
    act(() => item(el, 'Reset to page name')?.click())
    expect(props.onResetName).toHaveBeenCalledWith('t1')
  })
})

describe('TabMenu "Move to ▸" (YAZ-3091 D3)', () => {
  const TARGETS = [{ id: 'w2', label: 'Work — Meeting notes · 2 tabs' }, { id: 'w3', label: 'Work · 0 tabs' }]
  /** The flyout's groups, after a click on "Move to" opens it. */
  const flyout = (el: HTMLElement) => {
    act(() => item(el, 'Move to')?.click())
    return [...el.querySelectorAll('.ctx-menu__sub [role="group"]')].map((g) => [...g.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent))
  }

  it('S2, D3: the flyout lists each other window, a line, then "Right panel"; a window row moves this tab (path and id) and closes the menu', () => {
    const props = all({ moveTargets: TARGETS, onMoveToWindow: vi.fn() })
    const el = mount(props)
    const parent = item(el, 'Move to')
    expect(parent?.getAttribute('aria-haspopup')).toBe('menu')
    expect(flyout(el)).toEqual([['Work — Meeting notes · 2 tabs', 'Work · 0 tabs'], ['Right panel']])
    act(() => item(el, 'Work · 0 tabs')?.click())
    expect(props.onMoveToWindow).toHaveBeenCalledWith('w3', '/v/a.md', 't1')
    expect(props.onMoveToRight).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('S1: with no other window the flyout has only "Right panel"; S18: it does what "Move to right panel" did', () => {
    const props = all({ moveTargets: [], onMoveToWindow: vi.fn() })
    const el = mount(props)
    expect(flyout(el)).toEqual([['Right panel']])
    act(() => item(el, 'Right panel')?.click())
    expect(props.onMoveToRight).toHaveBeenCalledWith('/v/a.md')
    expect(props.onClose).toHaveBeenCalledTimes(1)
    // The top-level item is gone (D3).
    expect(item(el, 'Move to right panel')).toBeUndefined()
  })

  it('an empty group is left out, and with no group there is no "Move to" item', () => {
    let el = mount(all({ onMoveToRight: undefined, moveTargets: TARGETS, onMoveToWindow: vi.fn() }))
    expect(flyout(el)).toEqual([['Work — Meeting notes · 2 tabs', 'Work · 0 tabs']])
    act(() => root?.unmount())
    el = mount(all({ onMoveToRight: undefined, moveTargets: [], onMoveToWindow: vi.fn() }))
    expect(groups(el)[0]).toEqual(['Move to new window', 'Duplicate tab'])
    act(() => root?.unmount())
    // Windows with no door to move to them are no rows either.
    el = mount(all({ onMoveToRight: undefined, moveTargets: TARGETS }))
    expect(item(el, 'Move to')).toBeUndefined()
  })
})

describe('TabMenu Focus and Favorites (YAZ-3264 D2)', () => {
  const lists = (over: Partial<TabMenuProps> = {}, state: TabMenuAt['lists'] = { focus: false, favorite: false }) => all({ menu: at({ lists: state }), onToggleFocus: vi.fn(), onToggleFavorite: vi.fn(), ...over })

  it('S1: "Add to focus" right after "Show in sidebar", "Add to favorites" first in the last group', () => {
    expect(groups(mount(lists()))).toEqual([
      ['Move to new window', 'Duplicate tab', 'Move to'],
      ['Show in sidebar', 'Add to focus', 'Copy path'],
      ['Set display name', 'Turn review on'],
      ['Add to favorites', 'Reveal in Finder', 'Open in VS Code'],
    ])
  })

  it('S2, S14: a page in a list reads "Remove from …", and each item toggles the path with the state the menu read', () => {
    const props = lists({}, { focus: true, favorite: true })
    let el = mount(props)
    expect([groups(el)[1][1], groups(el)[3][0]]).toEqual(['Remove from focus', 'Remove from favorites'])
    act(() => item(el, 'Remove from focus')?.click())
    expect(props.onToggleFocus).toHaveBeenCalledExactlyOnceWith(['/v/a.md'], true)
    expect(props.onClose).toHaveBeenCalledTimes(1)
    act(() => root?.unmount())
    el = mount(props)
    act(() => item(el, 'Remove from favorites')?.click())
    expect(props.onToggleFavorite).toHaveBeenCalledExactlyOnceWith(['/v/a.md'], true)
    act(() => root?.unmount())
    const off = lists()
    el = mount(off)
    act(() => item(el, 'Add to favorites')?.click())
    expect(off.onToggleFavorite).toHaveBeenCalledExactlyOnceWith(['/v/a.md'], false)
  })

  it('S7, S8: absent or null state hides both items, as does a menu with no toggle door', () => {
    const labels = (props: TabMenuProps) => {
      const flat = groups(mount(props)).flat()
      act(() => root?.unmount())
      return flat.filter((label) => label?.includes('focus') === true || label?.includes('favorites') === true)
    }
    expect(labels(lists({}, null))).toEqual([])
    expect(labels(lists({ menu: at() }))).toEqual([])
    expect(labels(lists({ onToggleFocus: undefined, onToggleFavorite: undefined }))).toEqual([])
  })
})
