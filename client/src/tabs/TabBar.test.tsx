/**
 * The window tab strip (Tabs I2, GRO-2234): tablist semantics per the ViewTabs pattern,
 * extension-stripped labels with full-path tooltips, the `.base` glyph, and the three
 * close affordances (✕, middle-click) vs activation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TabBar, type TabBarProps } from './TabBar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(props: TabBarProps) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<TabBar {...props} />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('TabBar', () => {
  const noop = { onActivate: vi.fn(), onClose: vi.fn() }

  it('renders a labelled tablist: one role=tab per path, extension-stripped label, full path as tooltip', () => {
    const el = mount({ tabs: ['/v/Note.md', '/v/sub/Plan.markdown'], active: '/v/Note.md', ...noop })
    expect(el.querySelector('.tabbar')?.getAttribute('role')).toBe('tablist')
    expect(el.querySelector('.tabbar')?.getAttribute('aria-label')).toBe('Open files')
    const tabsEls = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabsEls.map((t) => t.textContent)).toEqual(['Note', 'Plan'])
    expect(tabsEls.map((t) => t.title)).toEqual(['/v/Note.md', '/v/sub/Plan.markdown'])
  })

  it('marks only the active tab: aria-selected + the underline modifier', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/b.md', ...noop })
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    expect([...el.querySelectorAll('.tabbar__tab')].map((t) => t.classList.contains('tabbar__tab--active'))).toEqual([false, true])
  })

  it('shows the sidebar\'s 2×2 glyph on .base tabs only (rule 14: .base files are tabs like any other)', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/Tasks.base'], active: '/v/a.md', ...noop })
    const tabsEls = [...el.querySelectorAll('[role="tab"]')]
    expect(tabsEls.map((t) => t.querySelector('.tabbar__glyph') !== null)).toEqual([false, true])
    expect(tabsEls[1].textContent).toBe('Tasks')
  })

  it('clicking a tab activates it; the ✕ (labelled per file) closes it without activating', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', onActivate, onClose })
    act(() => el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click())
    expect(onActivate).toHaveBeenCalledWith('/v/b.md')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close b"]')?.click())
    expect(onClose).toHaveBeenCalledWith('/v/b.md')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('middle-click closes a tab (the browser-tab convention); other aux buttons do nothing', () => {
    const onClose = vi.fn()
    const el = mount({ tabs: ['/v/a.md'], active: '/v/a.md', onActivate: vi.fn(), onClose })
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"]')
    act(() => void tab?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true })))
    expect(onClose).toHaveBeenCalledWith('/v/a.md')
    act(() => void tab?.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders an empty strip with no tabs (rule 2: the strip shows whenever a folder is open)', () => {
    const el = mount({ tabs: [], active: null, ...noop })
    expect(el.querySelector('.tabbar')).not.toBeNull()
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(0)
  })
})
