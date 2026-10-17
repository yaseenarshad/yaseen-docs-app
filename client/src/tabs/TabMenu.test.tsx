/** The tab menu's groups (YAZ-2949 D3, D6): four groups in the sidebar menu's order, the display-name items, and what hides. */
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
      ['Move to new window', 'Duplicate tab', 'Move to right panel'],
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
