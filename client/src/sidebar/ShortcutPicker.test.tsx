/**
 * The "Add note shortcut" picker (YAZ-2290 D2): the search bar's matcher and result list in a
 * sheet. Pinned here: who is offered (notes the folder does not already show), the keyboard
 * (type, ↑/↓, ⏎, Esc), click-away, and the empty state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { ShortcutPicker } from './ShortcutPicker'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PROJECTS_ID = 'k3m9x2pq7abc'

const rec = (path: string, properties: Record<string, unknown> = {}, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/v/'.length)
  return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases, tags: [], links: [], embeds: [] }
}

/** Path order, as the index gives them: two notes the folder already shows — one living there, one a shortcut — and three it does not. */
const RECORDS = [
  rec('/v/Areas/Health.md', {}, ['Wellbeing']),
  rec('/v/Areas/Linked.md', { also_in: [PROJECTS_ID] }),
  rec('/v/Inbox/Heat pump.md'),
  rec('/v/Projects/Alpha.md'),
  rec('/v/Top.md'),
]
const FOLDERS = [{ ...rec('/v/Projects/.folder.md'), id: PROJECTS_ID }]

let reactRoot: Root | null = null
let container: HTMLElement | null = null

function render(records: IndexRecord[] = RECORDS) {
  const props = { onPick: vi.fn(), onClose: vi.fn() }
  const source = createWikilinkResolveSource()
  /** The next index snapshot, as the window's bridge hands it over. */
  const feed = (next: IndexRecord[]) => act(() => source.update(() => null, next, FOLDERS))
  feed(records)
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  act(() => reactRoot?.render(<StrictMode><ShortcutPicker folder="Projects" source={source} {...props} /></StrictMode>))
  return { el: container, feed, ...props }
}

const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Find a note"]')!
const labels = (el: HTMLElement) => [...el.querySelectorAll('.search-results__label')].map((row) => row.textContent)
const activeLabel = (el: HTMLElement) => el.querySelector('.search-results__row--active .search-results__label')?.textContent
/** Drive the CONTROLLED input like a user: native value setter + input event (Sidebar.test's idiom). */
const type = (el: HTMLElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input(el), value)
    input(el).dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const press = (el: HTMLElement, key: string) => act(() => void input(el).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
})

describe('ShortcutPicker (YAZ-2290 D2)', () => {
  it('opens as a dialog with the input focused, offering every note the folder does not already show', () => {
    const { el } = render()
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Add note shortcut')
    expect(document.activeElement).toBe(input(el))
    // Alpha lives in Projects and Linked is already a shortcut there: neither is offered.
    expect(labels(el)).toEqual(['Health', 'Wellbeing — Health', 'Heat pump', 'Top'])
  })

  it('a note already shown by the folder — one in a subfolder of it, at any depth — is not offered', () => {
    const { el } = render([...RECORDS, rec('/v/Projects/Deep/Beta.md'), rec('/v/Projects/Deep/Deeper/Gamma.md'), rec('/v/Projects-old/Delta.md')])
    expect(labels(el)).toEqual(['Health', 'Wellbeing — Health', 'Heat pump', 'Top', 'Delta'])
  })

  it('typing filters through the search bar’s matcher — basename and alias, ranked', () => {
    const { el } = render()
    type(el, 'hea')
    expect(labels(el)).toEqual(['Health', 'Heat pump'])
    type(el, 'well')
    expect(labels(el)).toEqual(['Wellbeing — Health'])
  })

  it('↑/↓ move the highlight, clamped at both ends, and ⏎ picks the highlighted note', () => {
    const { el, onPick } = render()
    type(el, 'hea')
    expect(activeLabel(el)).toBe('Health')
    press(el, 'ArrowUp')
    expect(activeLabel(el)).toBe('Health')
    press(el, 'ArrowDown')
    press(el, 'ArrowDown')
    expect(activeLabel(el)).toBe('Heat pump')
    press(el, 'Enter')
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Inbox/Heat pump.md')
  })

  it('a click picks its row', () => {
    const { el, onPick } = render()
    act(() => el.querySelectorAll<HTMLElement>('.search-results__row')[3].click())
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Top.md')
  })

  it('Esc closes and picks nothing; so does a click away, while a click inside the sheet does not', () => {
    const { el, onPick, onClose } = render()
    press(el, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => void el.querySelector('[role="dialog"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('follows the index while open: a note that appears is offered, one that became a shortcut here is not', () => {
    const { el, feed } = render()
    feed([...RECORDS.map((r) => (r.path === '/v/Top.md' ? { ...r, properties: { also_in: [PROJECTS_ID] } } : r)), rec('/v/Zeta.md')])
    expect(labels(el)).toEqual(['Health', 'Wellbeing — Health', 'Heat pump', 'Zeta'])
  })

  it('a list that was empty and fills highlights its first row, and ⏎ picks it', () => {
    const { el, feed, onPick } = render([])
    press(el, 'ArrowDown')
    feed(RECORDS)
    expect(activeLabel(el)).toBe('Health')
    press(el, 'Enter')
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Areas/Health.md')
  })

  it('nothing matching says so, and ⏎ then picks nothing', () => {
    const { el, onPick } = render()
    type(el, 'zzz')
    expect(el.querySelector('.search-results')).toBeNull()
    expect(el.querySelector('.sidebar__msg')?.textContent).toBe('No matches')
    press(el, 'Enter')
    expect(onPick).not.toHaveBeenCalled()
  })
})
