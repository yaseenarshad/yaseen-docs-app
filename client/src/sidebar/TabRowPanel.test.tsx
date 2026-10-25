import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SIDEBAR_TABS, type SidebarTab, type SidebarTabsPrefs } from '@shared/types'
import { TabRowPanel } from './TabRowPanel'

/** The Tab row panel (YAZ-3273 D4, D5, D9, D10; YAZ-3279). */
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

const ROW_H = 24
function mount(prefs: SidebarTabsPrefs = DEFAULT_SIDEBAR_TABS, focus: SidebarTab | null = null) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<TabRowPanel x={20} y={30} prefs={prefs} focus={focus} autoFocus={false} onChange={onChange} onClose={onClose} />))
  return { el: host, onChange, onClose, rerender: (next: SidebarTabsPrefs) => act(() => root!.render(<TabRowPanel x={20} y={30} prefs={next} focus={focus} autoFocus={false} onChange={onChange} onClose={onClose} />)) }
}
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tab-row-panel__row')]
const box = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="Show ${label}"]`)
const click = (b: Element | null) => act(() => void b?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const pointer = (target: Element | null, type: string, clientY: number) => act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY })))
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

describe('the panel', () => {
  it('S17, D6: a row per tab in the row\'s order, each a grip, a box, the icon and the name — Files\' a folder, as in the menu; Files\' box is off, "always shown"; the right-clicked tab is lit', () => {
    const { el } = mount({ ...DEFAULT_SIDEBAR_TABS, order: ['recents', 'files', 'search', 'focus', 'favorites', 'sessions'], hidden: ['focus'] }, 'search')
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Edit tab row')
    expect(rows(el).map((r) => r.querySelector('.tab-row-panel__name')?.textContent)).toEqual(['Recents', 'Files', 'Search', 'Focus', 'Favorites', 'Sessions'])
    expect(rows(el).map((r) => r.querySelector('[role="checkbox"]')?.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true', 'false', 'true', 'true'])
    expect(rows(el).every((r) => r.querySelector('.tab-row-panel__grip') !== null && r.querySelector('.tab-row-panel__icon svg') !== null)).toBe(true)
    expect([box(el, 'Files')?.disabled, rows(el)[1].querySelector('.tab-row-panel__note')?.textContent]).toEqual([true, 'always shown'])
    expect(rows(el).filter((r) => r.classList.contains('tab-row-panel__row--focus')).map((r) => r.dataset.tab)).toEqual(['search'])
    expect([...el.querySelectorAll('.tab-row-panel__head')].map((h) => h.textContent)).toEqual(['Tabs · drag to reorder', 'Buttons at the right'])
    expect([...el.querySelectorAll('.tab-row-panel__button-row')].map((r) => r.textContent)).toEqual(['✓Sort', '✓Collapse all', '✓More tabs (⋯)'])
  })

  it('S18: untick a tab and it is hidden; tick it and it shows in its place; Files\' box does nothing — one write each', () => {
    const { el, onChange, rerender } = mount()
    click(box(el, 'Focus'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, hidden: ['focus'] })
    rerender({ ...DEFAULT_SIDEBAR_TABS, hidden: ['focus'] })
    onChange.mockClear()
    click(box(el, 'Focus'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(DEFAULT_SIDEBAR_TABS)
    onChange.mockClear()
    click(box(el, 'Files'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('S23, S24: untick Sort, Collapse all or More tabs and the button leaves the bar', () => {
    const { el, onChange } = mount()
    click(box(el, 'Sort'))
    click(box(el, 'More tabs (⋯)'))
    expect(onChange.mock.calls.map(([next]) => next.hiddenButtons)).toEqual([['sort'], ['more']])
  })

  it('S25: "Reset tab row" is the default order with every tab and button shown; at the default it writes nothing', () => {
    const changed = mount({ order: ['sessions', 'files', 'search', 'focus', 'favorites', 'recents'], hidden: ['search'], hiddenButtons: ['fold'] })
    click(changed.el.querySelector('.tab-row-panel__reset'))
    expect(changed.onChange).toHaveBeenCalledExactlyOnceWith(DEFAULT_SIDEBAR_TABS)
    act(() => root?.unmount())
    const plain = mount()
    click(plain.el.querySelector('.tab-row-panel__reset'))
    expect(plain.onChange).not.toHaveBeenCalled()
  })

  it('S26: Esc, a press outside and the window losing focus close it; a press inside does not', () => {
    const { el, onClose } = mount()
    pointer(box(el, 'Focus'), 'pointerdown', 0)
    pointer(el.querySelector('.tab-row-panel__reset'), 'pointerdown', 0)
    expect(onClose).not.toHaveBeenCalled()
    pointer(document.body, 'pointerdown', 0)
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(onClose).toHaveBeenCalledTimes(2)
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('the drag (D5, S19 to S21)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // A fake layout: each row 24 px high, one under the other.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('tab-row-panel__row') ? ROW_H : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('tab-row-panel__row') ? [...this.parentElement!.children].indexOf(this) * ROW_H : 0
    })
  })

  it('S19: after 3 px the row lifts and follows the pointer, the others slide apart; on release it glides into the gap and the order is written once', () => {
    const { el, onChange } = mount()
    const search = rows(el)[1]
    pointer(search, 'pointerdown', 100)
    pointer(search, 'pointermove', 102) // less than 3 px: a press
    expect(search.classList.contains('tab-row-panel__row--lifted')).toBe(false)
    pointer(search, 'pointermove', 150) // 50 px down: past Focus and Favorites
    expect(search.classList.contains('tab-row-panel__row--lifted')).toBe(true)
    expect(search.style.transform).toBe('translateY(50px)')
    expect(rows(el).map((r) => r.style.transform)).toEqual(['', 'translateY(50px)', 'translateY(-24px)', 'translateY(-24px)', '', ''])
    pointer(search, 'pointerup', 150)
    expect(search.style.transform).toBe('translateY(48px)') // the glide into its gap
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(140))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, order: ['files', 'focus', 'favorites', 'search', 'sessions', 'recents'] })
    expect(rows(el).map((r) => r.style.transform)).toEqual(['', '', '', '', '', '']) // drawn plain again
  })

  it('the row is clamped to the list: dragged far past the end it lands last', () => {
    const { el, onChange } = mount()
    pointer(rows(el)[0], 'pointerdown', 0)
    pointer(rows(el)[0], 'pointermove', 900)
    expect(rows(el)[0].style.transform).toBe(`translateY(${5 * ROW_H + ROW_H / 3}px)`)
    pointer(rows(el)[0], 'pointerup', 900)
    act(() => vi.advanceTimersByTime(140))
    expect(onChange.mock.calls[0][0].order).toEqual(['search', 'focus', 'favorites', 'sessions', 'recents', 'files']) // Files moves (D6)
  })

  it('S20: a press on a box does not start a drag; the box toggles', () => {
    const { el, onChange } = mount()
    pointer(box(el, 'Focus'), 'pointerdown', 100)
    pointer(rows(el)[2], 'pointermove', 160)
    expect(el.querySelector('.tab-row-panel__row--lifted')).toBeNull()
    click(box(el, 'Focus'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, hidden: ['focus'] })
  })

  it('S21: Esc during a drag puts the row back and writes nothing; a second Esc closes the panel', () => {
    const { el, onChange, onClose } = mount()
    const focus = rows(el)[2]
    pointer(focus, 'pointerdown', 100)
    pointer(focus, 'pointermove', 60)
    expect(focus.classList.contains('tab-row-panel__row--lifted')).toBe(true)
    key('Escape')
    expect(rows(el).map((r) => r.style.transform)).toEqual(['', '', '', '', '', ''])
    expect(focus.classList.contains('tab-row-panel__row--lifted')).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    pointer(focus, 'pointerup', 60) // the release after Esc does nothing
    act(() => vi.advanceTimersByTime(500))
    expect(onChange).not.toHaveBeenCalled()
    key('Escape')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('YAZ-3301 S19: a row grabbed during the 140 ms glide of the last drag is the row that moves', () => {
    const { el, onChange, rerender } = mount()
    const search = rows(el)[1]
    pointer(search, 'pointerdown', 100)
    pointer(search, 'pointermove', 150) // Search down past Focus and Favorites
    pointer(search, 'pointerup', 150) // the glide starts; nothing is written yet
    const favorites = el.querySelector<HTMLElement>('.tab-row-panel__row[data-tab="favorites"]')!
    pointer(favorites, 'pointerdown', 200) // the reader grabs Favorites at once
    act(() => vi.advanceTimersByTime(140)) // the first drag writes
    const first = onChange.mock.calls[0][0] as SidebarTabsPrefs
    expect(first.order).toEqual(['files', 'focus', 'favorites', 'search', 'sessions', 'recents'])
    rerender(first) // App draws the new order
    pointer(favorites, 'pointermove', 100) // Favorites up, to the top
    pointer(favorites, 'pointerup', 100)
    act(() => vi.advanceTimersByTime(140))
    expect((onChange.mock.calls[1][0] as SidebarTabsPrefs).order[0]).toBe('favorites')
  })

  it('YAZ-3301 S19: a press during the glide writes the last drop at once, and only once; the new drag starts from the settled rows', () => {
    const { el, onChange } = mount()
    const search = rows(el)[1]
    pointer(search, 'pointerdown', 100)
    pointer(search, 'pointermove', 150)
    pointer(search, 'pointerup', 150)
    expect(onChange).not.toHaveBeenCalled() // the glide is on
    const favorites = el.querySelector<HTMLElement>('.tab-row-panel__row[data-tab="favorites"]')!
    pointer(favorites, 'pointerdown', 200)
    expect(onChange).toHaveBeenCalledOnce() // the press finished the glide
    expect(rows(el).map((r) => r.style.transform)).toEqual(['', '', '', '', '', ''])
    expect(el.querySelector('.tab-row-panel__row--settling')).toBeNull()
    act(() => vi.advanceTimersByTime(500))
    expect(onChange).toHaveBeenCalledOnce() // the glide's own timer does not write it again
    pointer(favorites, 'pointermove', 160)
    expect(favorites.classList.contains('tab-row-panel__row--lifted')).toBe(true)
  })

  it('S26: the panel closing in the glide writes the drop at once, and its timer does not fire after', () => {
    const { el, onChange } = mount()
    const search = rows(el)[1]
    pointer(search, 'pointerdown', 100)
    pointer(search, 'pointermove', 150)
    pointer(search, 'pointerup', 150) // the glide starts
    const errors = vi.spyOn(console, 'error')
    act(() => root?.unmount())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SIDEBAR_TABS, order: ['files', 'focus', 'favorites', 'search', 'sessions', 'recents'] })
    act(() => vi.advanceTimersByTime(500))
    expect(onChange).toHaveBeenCalledOnce()
    expect(errors.mock.calls.flat().filter((m) => String(m).includes('flushSync'))).toEqual([]) // no flushSync in the unmount
    expect(search.style.transform).toBe('')
  })

  it('S26: the panel closing in a drag ends it: the row lets go of the pointer, and a later move or release does nothing', () => {
    const { el, onChange } = mount()
    const focus = rows(el)[2]
    pointer(focus, 'pointerdown', 100)
    pointer(focus, 'pointermove', 160)
    expect(focus.classList.contains('tab-row-panel__row--lifted')).toBe(true)
    act(() => root?.unmount())
    expect([focus.classList.contains('tab-row-panel__row--lifted'), focus.style.transform]).toEqual([false, ''])
    pointer(focus, 'pointermove', 200)
    pointer(focus, 'pointerup', 200)
    act(() => vi.advanceTimersByTime(500))
    expect(onChange).not.toHaveBeenCalled()
    expect(focus.style.transform).toBe('')
  })

  it('a release with no move is no drag and writes nothing', () => {
    const { el, onChange } = mount()
    pointer(rows(el)[3], 'pointerdown', 100)
    pointer(rows(el)[3], 'pointerup', 100)
    act(() => vi.advanceTimersByTime(500))
    expect(onChange).not.toHaveBeenCalled()
  })
})
