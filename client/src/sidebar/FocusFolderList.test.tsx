/**
 * The folder rows of the Focus and Favorites tabs (YAZ-4460; demo YAZ-4471; ideas YAZ-4470): the Delete box and its two
 * answers, the box when "Show it in" takes a folder off the screen, "Open all in tabs", the drag of a folder row,
 * the arrow keys, and the tree's levels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FocusFolder } from '@shared/types'
import { FocusFolderList } from './FocusFolderList'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOTS = ['/x/Notes', '/x/Work']
const folder = (id: string, items: FocusFolder['items']): FocusFolder => ({ id, name: id, created: 1, at: 1, items })
let root: Root | null = null
let el: HTMLDivElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
  document.body.innerHTML = ''
})

function mount(over: Partial<ComponentProps<typeof FocusFolderList>> = {}) {
  const props: ComponentProps<typeof FocusFolderList> = {
    kind: 'focus',
    folders: [folder('Clients', [{ vault: 'Work', path: 'Clients' }, { vault: 'Notes', path: 'a.md' }]), folder('Empty', [])],
    roots: ROOTS,
    renderItems: (_f, paths) => (
      <ul className="tree" role="group">
        {paths.map((p) => (
          <li key={p} role="treeitem">
            <button type="button" className="tree__row" data-path={p}>
              {p}
            </button>
          </li>
        ))}
      </ul>
    ),
    editing: null,
    onEdit: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onGhost: vi.fn(),
    onHideOthers: vi.fn(),
    only: null,
    scopesOf: () => ({ workspace: true, vault: false }),
    onSetScope: vi.fn(),
    scope: 'workspace',
    openableOf: (paths) => paths,
    onOpenAll: vi.fn(),
    onReorderFolders: vi.fn(),
    ...over,
  }
  el = document.createElement('div')
  el.className = 'sidebar__body'
  document.body.append(el)
  root = createRoot(el)
  act(() => root?.render(<FocusFolderList {...props} />))
  return props
}
const row = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('[data-focus-folder]')].find((b) => b.textContent?.trim() === name)!
const menuOf = (name: string) => act(() => row(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })))
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent?.trim() === label)
const sheet = () => document.querySelector('[role="dialog"]')
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === label)!

describe('FocusFolderList', () => {
  it('YAZ-4473: a folder is a level-0 folder row of a tree, with no count (YAZ-4470, 10), and its row walks and sticks', () => {
    mount()
    const list = el.querySelector('ul.focus-folders')
    expect(list?.getAttribute('role')).toBe('tree')
    const li = row('Clients').closest('li')
    expect(li?.getAttribute('role')).toBe('treeitem')
    expect(li?.getAttribute('aria-expanded')).toBe('true')
    expect(row('Clients').hasAttribute('data-walk')).toBe(true)
    expect(row('Clients').classList.contains('tree__row--sticky')).toBe(true)
    expect(row('Clients').querySelector('.tree__count')).toBeNull()
  })

  it('YAZ-4471 M18: the Delete box asks — "Keep items" is the default answer, "Remove items too" the other; an empty folder says only Delete', () => {
    const props = mount()
    menuOf('Clients')
    act(() => item('Delete focus folder')?.click())
    expect(sheet()?.textContent).toContain('Keep its items at the top level of Focus, or remove them from focus with the folder.')
    act(() => button('Keep items').click())
    expect(props.onDelete).toHaveBeenLastCalledWith('Clients', true)
    menuOf('Clients')
    act(() => item('Delete focus folder')?.click())
    act(() => button('Remove items too').click())
    expect(props.onDelete).toHaveBeenLastCalledWith('Clients', false)
    menuOf('Empty')
    act(() => item('Delete focus folder')?.click())
    expect([...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Delete'])
  })

  it('YAZ-4471 M16: "Show it in" off for the list on show asks with a box — a move when the other list holds it, the Delete box when it does not', () => {
    const both = mount({ scopesOf: () => ({ workspace: true, vault: true }) })
    menuOf('Clients')
    act(() => item('Workspace')?.click())
    expect(sheet()?.textContent).toContain('Remove the focus folder "Clients" from the workspace list?')
    act(() => button('Remove').click())
    expect(both.onSetScope).toHaveBeenLastCalledWith('Clients', 'workspace', false)
    act(() => root?.unmount())
    const one = mount()
    menuOf('Clients')
    act(() => item('Workspace')?.click())
    expect(sheet()?.textContent).toContain('Delete the focus folder "Clients"?')
    expect(one.onSetScope).not.toHaveBeenCalled()
  })

  it('YAZ-4470 16, 17: the menu has tooltips on "Show it in", and "Open all in tabs" opens every item the disk holds, a folder too — none for an empty folder', () => {
    const props = mount()
    menuOf('Clients')
    expect(document.querySelector('.ctx-menu__heading')?.getAttribute('title')).toContain('Workspace: a window with two or more vaults')
    expect(item('Vault')?.title).toBe('Show it in a window with this vault alone')
    act(() => item('Open all in tabs')?.click())
    expect(props.onOpenAll).toHaveBeenCalledExactlyOnceWith(['/x/Work/Clients', '/x/Notes/a.md'])
    menuOf('Empty')
    expect(item('Open all in tabs')).toBeUndefined()
  })

  it('YAZ-4470 13: a drag of a folder row lands on the line above or below another, and the click that ends it does not fold', () => {
    const props = mount()
    const from = row('Empty')
    const to = row('Clients')
    to.getBoundingClientRect = () => new DOMRect(0, 0, 200, 26)
    act(() => from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 60 })))
    act(() => to.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 5 })))
    expect(to.classList.contains('focus-folder--before')).toBe(true)
    act(() => to.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 5 })))
    expect(props.onReorderFolders).toHaveBeenCalledExactlyOnceWith(['Empty', 'Clients'])
    act(() => from.click())
    expect(from.closest('li')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('YAZ-4470 4: ↓ walks from a folder row into its items and on to the next folder; ← closes a folder, then goes to the row above', () => {
    mount()
    row('Clients').focus()
    const key = (k: string) => act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
    key('ArrowDown')
    expect(document.activeElement?.textContent).toBe('/x/Work/Clients')
    key('ArrowDown')
    key('ArrowDown')
    expect(document.activeElement).toBe(row('Empty'))
    row('Clients').focus()
    key('ArrowLeft')
    expect(row('Clients').closest('li')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('YAZ-4477 (M5, F6): a ghost — an item of a vault not in this window — has the ghost glyph and a tooltip, and its click asks to add the vault; a name two vaults share opens nothing', () => {
    const props = mount({ folders: [folder('Mixed', [{ vault: 'Research', path: 'Papers/p.md' }, { vault: 'Notes', path: 'a.md' }])] })
    const ghost = el.querySelector<HTMLButtonElement>('.tree__row--ghost')
    expect(ghost?.querySelector('.tree__ghost-icon')).not.toBeNull()
    expect(ghost?.title).toBe('In "Research", which is not in this window')
    act(() => ghost?.click())
    expect(props.onGhost).toHaveBeenCalledExactlyOnceWith('Research', 'Papers/p.md')
    act(() => root?.unmount())
    const clash = mount({ roots: ['/home/Notes', '/work/Notes'], folders: [folder('Twins', [{ vault: 'Notes', path: 'a.md' }])] })
    const twin = el.querySelector<HTMLButtonElement>('.tree__row--ghost')
    expect(twin?.title).toBe('Two vaults in this window are named "Notes": the app cannot tell which one holds it')
    act(() => twin?.click())
    expect(clash.onGhost).not.toHaveBeenCalled()
  })

  it('YAZ-4477 (F8): "Hide all others" asks for this folder alone; the folder shown alone has no such item, and stays open', () => {
    const props = mount()
    menuOf('Clients')
    act(() => item('Hide all others')?.click())
    expect(props.onHideOthers).toHaveBeenCalledExactlyOnceWith('Clients')
    act(() => root?.unmount())
    mount({ folders: [folder('Clients', [{ vault: 'Work', path: 'Clients' }])], only: 'Clients' })
    expect(row('Clients').closest('li')?.getAttribute('aria-expanded')).toBe('true')
    menuOf('Clients')
    expect(item('Hide all others')).toBeUndefined()
  })

  it('YAZ-4477 (YAZ-4470 9): a fold lasts the session — the list that mounts again, after a tab switch, keeps it — and each tab has its own', () => {
    mount({ folders: [folder('Keep shut', [{ vault: 'Notes', path: 'a.md' }])] })
    act(() => row('Keep shut').click())
    expect(row('Keep shut').closest('li')?.getAttribute('aria-expanded')).toBe('false')
    act(() => root?.unmount())
    mount({ folders: [folder('Keep shut', [{ vault: 'Notes', path: 'a.md' }])] })
    expect(row('Keep shut').closest('li')?.getAttribute('aria-expanded')).toBe('false')
    act(() => root?.unmount())
    mount({ kind: 'favorites', folders: [folder('Keep shut', [{ vault: 'Notes', path: 'a.md' }])] })
    expect(row('Keep shut').closest('li')?.getAttribute('aria-expanded')).toBe('true')
  })
})
