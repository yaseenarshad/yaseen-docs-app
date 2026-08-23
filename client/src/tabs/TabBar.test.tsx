/**
 * The window tab strip (Tabs I2/I3, GRO-2234/2235): tablist semantics per the ViewTabs
 * pattern, extension-stripped labels with full-path tooltips, the `.base` glyph, the close
 * affordances (✕, middle-click) vs activation, drag-to-reorder with the insertion indicator,
 * and the active tab scrolled into view on activation.
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

/** The history props (YAZ-762) the tab tests don't exercise: nowhere to go, nothing wired. */
const noNav = { canBack: false, canForward: false, onBack: vi.fn(), onForward: vi.fn() }

describe('TabBar', () => {
  const noop = { onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn() }

  it('renders a labelled tablist: one role=tab per path, extension-stripped label, full path as tooltip', () => {
    const el = mount({ tabs: ['/v/Note.md', '/v/sub/Plan.markdown'], active: '/v/Note.md', ...noop, ...noNav })
    expect(el.querySelector('.tabbar')?.getAttribute('role')).toBe('tablist')
    expect(el.querySelector('.tabbar')?.getAttribute('aria-label')).toBe('Open files')
    const tabsEls = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabsEls.map((t) => t.textContent)).toEqual(['Note', 'Plan'])
    expect(tabsEls.map((t) => t.title)).toEqual(['/v/Note.md', '/v/sub/Plan.markdown'])
  })

  it('marks only the active tab: aria-selected + the underline modifier', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/b.md', ...noop, ...noNav })
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    expect([...el.querySelectorAll('.tabbar__tab')].map((t) => t.classList.contains('tabbar__tab--active'))).toEqual([false, true])
  })

  it('shows the sidebar\'s 2×2 glyph on .base tabs only (rule 14: .base files are tabs like any other)', () => {
    const el = mount({ tabs: ['/v/a.md', '/v/Tasks.base'], active: '/v/a.md', ...noop, ...noNav })
    const tabsEls = [...el.querySelectorAll('[role="tab"]')]
    expect(tabsEls.map((t) => t.querySelector('.tabbar__glyph') !== null)).toEqual([false, true])
    expect(tabsEls[1].textContent).toBe('Tasks')
  })

  it('clicking a tab activates it; the ✕ (labelled per file) closes it without activating', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const el = mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', onActivate, onClose, onMove: vi.fn(), ...noNav })
    act(() => el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click())
    expect(onActivate).toHaveBeenCalledWith('/v/b.md')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close b"]')?.click())
    expect(onClose).toHaveBeenCalledWith('/v/b.md')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('middle-click closes a tab (the browser-tab convention); other aux buttons do nothing', () => {
    const onClose = vi.fn()
    const el = mount({ tabs: ['/v/a.md'], active: '/v/a.md', onActivate: vi.fn(), onClose, onMove: vi.fn(), ...noNav })
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"]')
    act(() => void tab?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true })))
    expect(onClose).toHaveBeenCalledWith('/v/a.md')
    act(() => void tab?.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders an empty strip with no tabs (rule 2: the strip shows whenever a folder is open)', () => {
    const el = mount({ tabs: [], active: null, ...noop, ...noNav })
    expect(el.querySelector('.tabbar')).not.toBeNull()
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(0)
  })
})

describe('TabBar drag-to-reorder (I3, GRO-2235)', () => {
  const TABS = ['/v/a.md', '/v/b.md', '/v/c.md']
  const tabAt = (el: HTMLElement, i: number) => [...el.querySelectorAll<HTMLElement>('.tabbar__tab')][i]
  /**
   * Drag events bubble like the real thing; jsdom has no DragEvent, the handlers guard
   * `dataTransfer` (the groupDrag idiom). jsdom rects are all-zero, so the before/after
   * midpoint test reduces to the sign of clientX: negative = before the tab, else after.
   */
  const fire = (target: Element, type: string, clientX = 0) =>
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX })))

  it('dropping past a tab\'s midpoint calls onMove with the final index; grab and indicator classes mark the drag', () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove, ...noNav })
    fire(tabAt(el, 0), 'dragstart')
    expect(tabAt(el, 0).classList.contains('tabbar__tab--dragging')).toBe(true)
    fire(tabAt(el, 2), 'dragover', 5) // right half of c → the end slot: the last tab marks --insert-after
    expect(tabAt(el, 2).classList.contains('tabbar__tab--insert-after')).toBe(true)
    fire(tabAt(el, 2), 'drop', 5)
    expect(onMove).toHaveBeenCalledWith(0, 2) // a lands last
    expect(el.querySelector('.tabbar__tab--dragging')).toBeNull() // drag state cleared
  })

  it('dropping on a tab\'s left half inserts BEFORE it (--insert-before on that tab)', () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove, ...noNav })
    fire(tabAt(el, 0), 'dragstart')
    fire(tabAt(el, 2), 'dragover', -5)
    expect(tabAt(el, 2).classList.contains('tabbar__tab--insert-before')).toBe(true)
    fire(tabAt(el, 2), 'drop', -5)
    expect(onMove).toHaveBeenCalledWith(0, 1) // before c, after the grab point shifted one left
  })

  it('dropping back on the grabbed slot is a no-op; dragend clears an abandoned drag', () => {
    const onMove = vi.fn()
    const el = mount({ tabs: TABS, active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove, ...noNav })
    fire(tabAt(el, 1), 'dragstart')
    fire(tabAt(el, 1), 'drop', -5) // before itself = its own slot
    expect(onMove).not.toHaveBeenCalled()
    fire(tabAt(el, 1), 'dragstart')
    fire(tabAt(el, 1), 'dragend')
    expect(el.querySelector('.tabbar__tab--dragging')).toBeNull()
  })
})

describe('TabBar keeps the active tab in view (I3 overflow polish)', () => {
  it('activation scrolls the ACTIVE tab into view when scrollIntoView exists (jsdom lacks it: the ?. guard is every other test here)', () => {
    const spy = vi.fn()
    ;(HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = spy
    try {
      mount({ tabs: ['/v/a.md', '/v/b.md'], active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn(), ...noNav })
      act(() => root?.render(<TabBar tabs={['/v/a.md', '/v/b.md']} active="/v/b.md" onActivate={vi.fn()} onClose={vi.fn()} onMove={vi.fn()} {...noNav} />))
      const activeTab = spy.mock.contexts.at(-1) as HTMLElement
      expect(activeTab.classList.contains('tabbar__tab--active')).toBe(true)
      expect(activeTab.querySelector('[role="tab"]')?.textContent).toBe('b')
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
    }
  })
})

describe('TabBar history buttons (YAZ-762, LOCKED D2: buttons only — no shortcut, no menu item)', () => {
  const btn = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`.tabbar-nav__btn[aria-label="${label}"]`)
  const tabs = { tabs: ['/v/a.md'], active: '/v/a.md', onActivate: vi.fn(), onClose: vi.fn(), onMove: vi.fn() }

  it('renders ◀ ▶ left of the tablist, each labelled and tooltipped', () => {
    const el = mount({ ...tabs, ...noNav })
    const labels = [...el.querySelectorAll<HTMLButtonElement>('.tabbar-nav__btn')]
    expect(labels.map((b) => b.getAttribute('aria-label'))).toEqual(['Back', 'Forward'])
    expect(labels.map((b) => b.title)).toEqual(['Back', 'Forward'])
    // Outside .tabbar, so the strip's own drop guards (e.target !== e.currentTarget) are untouched.
    expect(el.querySelector('.tabbar .tabbar-nav__btn')).toBeNull()
  })

  it('each button is disabled exactly when its side of the stack has nowhere to go', () => {
    const el = mount({ ...tabs, canBack: true, canForward: false, onBack: vi.fn(), onForward: vi.fn() })
    expect(btn(el, 'Back')?.disabled).toBe(false)
    expect(btn(el, 'Forward')?.disabled).toBe(true)
  })

  it('clicking an enabled button steps that way; a disabled one does nothing', () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    const el = mount({ ...tabs, canBack: true, canForward: true, onBack, onForward })
    act(() => btn(el, 'Back')?.click())
    act(() => btn(el, 'Forward')?.click())
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onForward).toHaveBeenCalledTimes(1)
    act(() => root?.render(<TabBar {...tabs} canBack={false} canForward={false} onBack={onBack} onForward={onForward} />))
    act(() => btn(container as HTMLElement, 'Back')?.click())
    act(() => btn(container as HTMLElement, 'Forward')?.click())
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onForward).toHaveBeenCalledTimes(1)
  })
})
