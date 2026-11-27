import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_ROW_DATES, type RowDates } from '@shared/types'
import { RowDatesControl } from './RowDatesControl'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(value: RowDates) {
  const onChange = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<RowDatesControl value={value} onChange={onChange} />)
  })
  return { el: container, onChange }
}

const buttonsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button')]

describe('RowDatesControl (YAZ-6593)', () => {
  it('renders all 5 sidebar tab toggles inside an accessible group and defaults omitted recents to on', () => {
    const { el } = mount({ ...DEFAULT_ROW_DATES })
    const group = el.querySelector('[role="group"][aria-label="Show last updated"]')
    expect(group).not.toBeNull()

    const btns = buttonsOf(el)
    expect(btns.map((b) => b.textContent)).toEqual(['Files', 'Focus', 'Favorites', 'Search', 'Recents'])
    expect(btns.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'true'])
    expect(btns.map((b) => b.classList.contains('settings__option--active'))).toEqual([false, false, false, true, true])
  })

  it('toggles Files, Focus, Favorites, Search, and Recents while preserving RowDates shape', () => {
    const { el, onChange } = mount({ ...DEFAULT_ROW_DATES })
    const click = (label: string) => {
      const btn = buttonsOf(el).find((b) => b.textContent === label)
      act(() => btn?.click())
    }

    click('Files')
    expect(onChange).toHaveBeenLastCalledWith({ files: true, focus: false, favorites: false, search: true })

    click('Focus')
    expect(onChange).toHaveBeenLastCalledWith({ files: false, focus: true, favorites: false, search: true })

    click('Favorites')
    expect(onChange).toHaveBeenLastCalledWith({ files: false, focus: false, favorites: true, search: true })

    click('Search')
    expect(onChange).toHaveBeenLastCalledWith({ files: false, focus: false, favorites: false, search: false })

    click('Recents')
    expect(onChange).toHaveBeenLastCalledWith({ files: false, focus: false, favorites: false, search: true, recents: false })
  })

  it('shows Recents as off when recents is false and toggles it back on', () => {
    const { el, onChange } = mount({ ...DEFAULT_ROW_DATES, recents: false })
    const recentsBtn = buttonsOf(el).find((b) => b.textContent === 'Recents')!
    expect(recentsBtn.getAttribute('aria-pressed')).toBe('false')
    expect(recentsBtn.classList.contains('settings__option--active')).toBe(false)

    act(() => recentsBtn.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_DATES, recents: true })
  })
})
