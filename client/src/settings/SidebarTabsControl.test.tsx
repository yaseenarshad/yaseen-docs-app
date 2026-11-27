import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SIDEBAR_TABS, type SidebarTabsPrefs } from '@shared/types'
import SidebarTabsControl, { type SidebarTabsControlProps } from './SidebarTabsControl'

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(props: Partial<SidebarTabsControlProps> = {}) {
  const onChange = vi.fn()
  const onJumpToActive = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const renderWith = (next: Partial<SidebarTabsControlProps>) => {
    act(() =>
      root!.render(
        <SidebarTabsControl
          value={DEFAULT_SIDEBAR_TABS}
          onChange={onChange}
          {...props}
          {...next}
        />,
      ),
    )
  }
  renderWith({})
  return { el: host, onChange, onJumpToActive, rerender: renderWith }
}

const click = (el: Element | null) => act(() => void el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const checkbox = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="Show ${label}"]`)
const moveBtn = (el: HTMLElement, label: string, dir: 'up' | 'down') => el.querySelector<HTMLButtonElement>(`button[aria-label="Move ${label} ${dir}"]`)

describe('SidebarTabsControl (YAZ-6593)', () => {
  it('reorders tabs via accessible up/down buttons and respects list bounds', () => {
    const { el, onChange } = mount({ scopeLabel: 'My Vault' })
    expect(el.querySelector('.sidebar-tabs-control__scope')?.textContent).toBe('Tabs for: My Vault')
    expect(moveBtn(el, 'Files', 'up')?.disabled).toBe(true)
    expect(moveBtn(el, 'Recents', 'down')?.disabled).toBe(true)

    click(moveBtn(el, 'Search', 'up'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...DEFAULT_SIDEBAR_TABS,
      order: ['search', 'files', 'focus', 'favorites', 'sessions', 'recents'],
    })

    onChange.mockClear()
    click(moveBtn(el, 'Search', 'down'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...DEFAULT_SIDEBAR_TABS,
      order: ['files', 'focus', 'search', 'favorites', 'sessions', 'recents'],
    })
  })

  it('toggles tab visibility (keeping Files disabled) and right-hand buttons', () => {
    const { el, onChange } = mount()
    expect(checkbox(el, 'Files')?.disabled).toBe(true)
    click(checkbox(el, 'Files'))
    expect(onChange).not.toHaveBeenCalled()

    click(checkbox(el, 'Focus'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, hidden: ['focus'] })

    onChange.mockClear()
    click(checkbox(el, 'Sort'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, hiddenButtons: ['sort'] })

    onChange.mockClear()
    click(checkbox(el, 'Collapse all'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, hiddenButtons: ['fold'] })

    onChange.mockClear()
    click(checkbox(el, 'More tabs (⋯)'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, hiddenButtons: ['more'] })
  })

  it('shows "Reset to default" only when customized and restores DEFAULT_SIDEBAR_TABS on click', () => {
    const custom: SidebarTabsPrefs = {
      order: ['recents', 'files', 'search', 'focus', 'favorites', 'sessions'],
      hidden: ['sessions'],
      hiddenButtons: ['sort'],
    }
    const { el, onChange, rerender } = mount({ value: DEFAULT_SIDEBAR_TABS })
    expect(el.textContent).not.toContain('Reset to default')

    rerender({ value: custom })
    const resetBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Reset to default') ?? null
    expect(resetBtn).not.toBeNull()
    click(resetBtn)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(DEFAULT_SIDEBAR_TABS)
  })

  it('renders a 1-line redirect in Global scope and invokes onJumpToActive when clicking the target button', () => {
    const onJumpToActive = vi.fn()
    const { el } = mount({
      isGlobal: true,
      activeTargetLabel: 'Work (workspace)',
      onJumpToActive,
    })
    expect(el.querySelector('.sidebar-tabs-redirect')?.textContent).toContain('Tab row is set per vault or per workspace — never globally.')
    expect(el.querySelector('.sidebar-tabs-editor')).toBeNull()
    const jumpBtn = el.querySelector<HTMLButtonElement>('.setting__scope-jump')
    expect(jumpBtn?.textContent).toBe('Edit Work (workspace)')
    click(jumpBtn)
    expect(onJumpToActive).toHaveBeenCalledTimes(1)
  })
})
