/**
 * The icon picker (YAZ-3440 D8): "Suggested" first, then every icon A to Z; the search box filters both by name;
 * ArrowDown from the search box goes to the first icon and the arrows move in the grid; Enter picks (the first match
 * from the search box); the footer names the icon under the mouse or the keyboard, else the current one.
 * Escape, × and the outside click are in SettingsDialog.test.tsx.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IconPicker } from './IconPicker'
import { PICKER_COLUMNS } from './iconSuggestions'
import { loadMaterialIcons } from './materialIcons'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let el: HTMLElement | null = null

function mount(current: string | null = null) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  el = document.body.appendChild(document.createElement('div'))
  root = createRoot(el)
  act(() => root?.render(<IconPicker x={10} y={10} title="Icon for this file: a.ts" current={current} suggested={['typescript', 'javascript', 'markdown']} onPick={onPick} onClose={onClose} />))
  return { onPick, onClose }
}
const search = () => el?.querySelector<HTMLInputElement>('.icon-picker__search') as HTMLInputElement
const sectionIds = (title: string) => [...(el?.querySelectorAll<HTMLButtonElement>(`[role="listbox"][aria-label="${title}"] .icon-picker__icon`) ?? [])].map((b) => b.getAttribute('aria-label'))
const icons = () => [...(el?.querySelectorAll<HTMLButtonElement>('.icon-picker__icon') ?? [])]
const foot = () => el?.querySelector('.icon-picker__foot')?.textContent?.trim()
const key = (target: Element, k: string) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeAll(() => loadMaterialIcons())
afterEach(() => {
  act(() => root?.unmount())
  el?.remove()
  root = null
  el = null
})

describe('IconPicker (YAZ-3440 D8)', () => {
  it('lists the suggestions first, then every icon A to Z; the search filters both by every word of the name', () => {
    mount()
    expect(sectionIds('Suggested')).toEqual(['typescript', 'javascript', 'markdown'])
    const all = sectionIds('All icons')
    expect(all.length).toBeGreaterThan(500)
    expect(all).toEqual([...all].sort())
    type(search(), 'script java')
    expect(sectionIds('Suggested')).toEqual(['javascript'])
    expect(sectionIds('All icons').every((id) => id?.includes('script') && id.includes('java'))).toBe(true)
    type(search(), 'no-such-icon-zz')
    expect(icons()).toEqual([])
    expect(el?.querySelector('.icon-picker__empty')?.textContent).toBe('No icon has that name.')
  })

  it('Enter in the search box picks the first match and closes', () => {
    const { onPick, onClose } = mount()
    type(search(), 'markdown')
    key(search(), 'Enter')
    expect(onPick).toHaveBeenCalledWith('markdown')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ArrowDown from the search box goes to the first icon; the arrows move in the grid and from one section to the next; Enter picks the focused icon', () => {
    const { onPick } = mount()
    key(search(), 'ArrowDown')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('typescript')
    key(document.activeElement as Element, 'ArrowRight')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('javascript')
    key(document.activeElement as Element, 'ArrowLeft')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('typescript')
    // The Suggested row is shorter than a grid row: ArrowDown goes to the first icon of "All icons".
    key(document.activeElement as Element, 'ArrowDown')
    const all = sectionIds('All icons')
    expect(document.activeElement?.getAttribute('aria-label')).toBe(all[0])
    key(document.activeElement as Element, 'ArrowDown')
    expect(document.activeElement?.getAttribute('aria-label')).toBe(all[PICKER_COLUMNS])
    key(document.activeElement as Element, 'ArrowUp')
    expect(document.activeElement?.getAttribute('aria-label')).toBe(all[0])
    // Up from the first row of a section: the last icon of the section before.
    key(document.activeElement as Element, 'ArrowUp')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('markdown')
    // ArrowUp from the first row goes back to the search box.
    key(document.activeElement as Element, 'ArrowUp')
    expect(document.activeElement).toBe(search())
    key(search(), 'ArrowDown')
    key(document.activeElement as Element, 'Enter')
    expect(onPick).toHaveBeenCalledWith('typescript')
  })

  it('the footer names the icon under the mouse, else the one the keyboard is on, else the current one; the current one is marked', () => {
    mount('markdown')
    expect(foot()).toBe('markdown')
    expect(el?.querySelector('.icon-picker__icon--current')?.getAttribute('aria-label')).toBe('markdown')
    key(search(), 'ArrowDown')
    expect(foot()).toBe('typescript')
    const js = icons().find((b) => b.getAttribute('aria-label') === 'javascript') as HTMLButtonElement
    // React's onMouseEnter listens to `mouseover`.
    act(() => void js.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(foot()).toBe('javascript')
    act(() => void js.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(foot()).toBe('typescript')
  })
})
