/**
 * A folder page row's right-click (`PageContextMenu`):
 * - YAZ-4797 demo: the shortcut items, from the page's `ShortcutActions`. On a shortcut row: "Go to where it lives
 *   (<folder>)" and "Remove shortcut from <page>"; on every page row: "Add shortcut to ›", the vault's folders less the
 *   one the page lives in, with a search box (Enter picks the first match). A read-only page, a folder row, or a page
 *   with no doors (a vault without IDs) gets none.
 * - YAZ-4778 demo: "Open in new window" is its own row, right after "Open in new tab", no longer inside "Open in ›".
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageContextMenu } from './PageContextMenu'
import { ShortcutActions, type ShortcutDoors } from './shortcutDoors'
import { PageActions } from '../../lib/pageActions'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

/** As FolderView hands them: `dir` absolute, `path` from the vault's top. */
const FOLDERS = [
  { dir: '/vault/Recipes/Desserts', name: 'Desserts', path: 'Recipes/Desserts' },
  { dir: '/vault/Recipes/Party menu', name: 'Party menu', path: 'Recipes/Party menu' },
  { dir: '/vault/Tools', name: 'Tools', path: 'Tools' },
]
function doors(over: Partial<ShortcutDoors> = {}): ShortcutDoors {
  return {
    pageName: 'Party menu',
    homeOf: (path) => (path.includes('Tiramisu') ? { dir: '/vault/Recipes/Desserts', name: 'Desserts' } : null),
    goHome: vi.fn(),
    remove: vi.fn(),
    add: vi.fn(),
    folders: () => FOLDERS,
    // Where a row shows already, as FolderView answers: Tiramisu lives in Desserts and is a shortcut on Party menu.
    holders: (path) => new Set(path.includes('Tiramisu') ? ['/vault/Recipes/Desserts', '/vault/Recipes/Party menu'] : [path.slice(0, path.lastIndexOf('/'))]),
    locked: () => false,
    ...over,
  }
}
function menu(path: string, d: ShortcutDoors | null, onClose = vi.fn()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <ShortcutActions.Provider value={d}>
        <PageContextMenu x={0} y={0} path={path} title="page" onOpenBackground={vi.fn()} onClose={onClose} />
      </ShortcutActions.Provider>,
    ),
  )
  return onClose
}
const mainItems = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter((b) => b.closest('.ctx-menu__sub') === null)
const mainText = () => mainItems().map((b) => b.textContent)
const subItems = () => [...host!.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub [role="menuitem"]')]
const openAddShortcut = () => act(() => mainItems().find((b) => b.textContent === 'Add shortcut to')!.click())

const TIRAMISU = '/vault/Recipes/Desserts/Tiramisu.md'
const GARLIC = '/vault/Recipes/Party menu/Garlic bread.md'

describe('YAZ-4797 demo: shortcut items in a folder page row menu', () => {
  it('YAZ-4797 demo: a shortcut row has Go to where it lives (Desserts), Remove shortcut from Party menu, and Add shortcut to', () => {
    const d = doors()
    menu(TIRAMISU, d)
    expect(mainText()).toEqual(expect.arrayContaining(['Go to where it lives (Desserts)', 'Remove shortcut from Party menu', 'Add shortcut to']))
    act(() => mainItems().find((b) => b.textContent === 'Go to where it lives (Desserts)')!.click())
    expect(d.goHome).toHaveBeenCalledExactlyOnceWith('/vault/Recipes/Desserts')
  })

  it('YAZ-4797 demo: Remove shortcut takes the page off this page only', () => {
    const d = doors()
    const onClose = menu(TIRAMISU, d)
    act(() => mainItems().find((b) => b.textContent === 'Remove shortcut from Party menu')!.click())
    expect(d.remove).toHaveBeenCalledExactlyOnceWith(TIRAMISU)
    expect(onClose).toHaveBeenCalled()
  })

  it('YAZ-4797 demo: a page that lives here has only Add shortcut to', () => {
    menu(GARLIC, doors())
    const text = mainText()
    expect(text).toContain('Add shortcut to')
    expect(text.some((t) => t?.startsWith('Go to where it lives'))).toBe(false)
    expect(text.some((t) => t?.startsWith('Remove shortcut'))).toBe(false)
  })

  it('YAZ-4797 demo: Add shortcut to lists the folders less the one the page lives in; a pick adds it there', () => {
    const d = doors()
    menu(GARLIC, d)
    openAddShortcut()
    expect(subItems().map((b) => b.textContent)).toEqual(['Desserts', 'Tools'])
    act(() => subItems()[0].click())
    expect(d.add).toHaveBeenCalledExactlyOnceWith(GARLIC, '/vault/Recipes/Desserts')
  })

  it('YAZ-4797 demo: the search box filters by name or path, and Enter adds the first match', () => {
    const d = doors()
    menu(GARLIC, d)
    openAddShortcut()
    const search = host!.querySelector<HTMLInputElement>('input[aria-label="Search folders"]')!
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      set.call(search, 'too')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(subItems().map((b) => b.textContent)).toEqual(['Tools'])
    act(() => void search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(d.add).toHaveBeenCalledExactlyOnceWith(GARLIC, '/vault/Tools')
    act(() => {
      set.call(search, 'zzz')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host!.querySelector('.ctx-menu__empty')?.textContent).toBe('No folder matches')
  })

  it('YAZ-4797 demo: a read-only page, a folder row, or no doors: no shortcut items', () => {
    const has = () => mainText().some((t) => t === 'Add shortcut to' || t?.startsWith('Remove shortcut') || t?.startsWith('Go to where'))
    menu(TIRAMISU, doors({ locked: () => true }))
    expect(has()).toBe(false)
    act(() => root!.unmount())
    host!.remove()
    // A folder row's path is its `.folder.md`.
    menu('/vault/Recipes/Desserts/.folder.md', doors())
    expect(has()).toBe(false)
    act(() => root!.unmount())
    host!.remove()
    menu(TIRAMISU, null)
    expect(has()).toBe(false)
  })
})

describe('YAZ-4778 demo: Open in new window is its own row', () => {
  it('YAZ-4778 demo: right after Open in new tab, and no longer in Open in ›', () => {
    const openNewWindow = vi.fn()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() =>
      root!.render(
        <PageActions.Provider value={{ openNewWindow, reveal: vi.fn() }}>
          <PageContextMenu x={0} y={0} path="/vault/page.md" title="page" onOpenBackground={vi.fn()} onClose={vi.fn()} />
        </PageActions.Provider>,
      ),
    )
    expect(mainText().slice(0, 3)).toEqual(['Open in new tab', 'Open in new window', 'Open in'])
    act(() => mainItems().find((b) => b.textContent === 'Open in')!.click())
    expect(subItems().map((b) => b.textContent)).not.toContain('New window')
    act(() => mainItems().find((b) => b.textContent === 'Open in new window')!.click())
    expect(openNewWindow).toHaveBeenCalledExactlyOnceWith('/vault/page.md')
  })
})

describe('checker 8A: Add shortcut to never offers this page', () => {
  it('on a shortcut row of Party menu, "Add shortcut to ›" does not list Party menu', () => {
    menu(TIRAMISU, doors())
    openAddShortcut()
    expect(subItems().map((b) => b.textContent)).not.toContain('Party menu')
  })
})
