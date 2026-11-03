/**
 * The New… box (⌘N, YAZ-3556 D5, D7, D3; YAZ-4252): it opens on Note, ← → pick the kind (no wrap), ⏎ moves to the
 * place row and ⏎ there makes it in the folder on show, Esc closes; a missing default folder says so; "Choose…" opens
 * the place picker for this one item. The Folder tile, the vault's place shortcuts and the keys `1`, `3`, ⏎.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode } from '@shared/types'
import { NewItemBox } from './NewItemBox'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/treeFeed', () => {
  const trees: Record<string, TreeNode[]> = {
    '/v': [{ type: 'dir', name: 'Projects', path: '/v/Projects', children: [] }, { type: 'dir', name: 'Inbox', path: '/v/Inbox', children: [] }],
    '/w': [{ type: 'dir', name: 'Work', path: '/w/Work', children: [] }],
  }
  return { latestTree: (root: string) => ({ root, tree: trees[root] ?? [], generatedAt: 1 }), onTree: () => () => undefined, fetchTree: async (root: string) => ({ root, tree: trees[root] ?? [], generatedAt: 1 }) }
})

/** The vaults' new-places.json files, as main keeps them (YAZ-4252 D3). */
const stored = new Map<string, Array<string | null>>()
const changed = new Set<(c: { root: string }) => void>()
vi.mock('../api', () => ({
  api: {
    newPlaces: {
      get: async (root: string) => stored.get(root) ?? [null, null, null],
      set: async (root: string, places: Array<string | null>) => {
        stored.set(root, [...places])
        for (const listener of changed) listener({ root })
      },
      onChanged: (listener: (c: { root: string }) => void) => {
        changed.add(listener)
        return () => changed.delete(listener)
      },
    },
  },
}))
const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  stored.clear()
  localStorage.clear()
})

function render(dir = '/v/Inbox', missing: string | null = null, vaults = [{ root: '/v', name: 'Notes' }]) {
  const onMake = vi.fn()
  const onClose = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<StrictMode><NewItemBox vaults={vaults} dir={dir} missing={missing} onMake={onMake} onClose={onClose} /></StrictMode>))
  return { onMake, onClose }
}

const sheet = () => document.querySelector<HTMLElement>('.new-item')!
const press = (key: string) => act(() => void (document.activeElement ?? sheet()).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
const chosen = () => document.querySelector('.new-item__tile[aria-checked="true"] .new-item__label')?.textContent
const slots = () => [...document.querySelectorAll<HTMLButtonElement>('.new-item__slot')]
const slotNames = () => slots().map((b) => b.querySelector('.new-item__slot-name')?.textContent ?? b.textContent?.replace(/^\d/, ''))
const pick = (label: string) => act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__row')].find((r) => r.textContent?.includes(label))?.click())
const chooseHere = () => act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__row')].find((r) => r.textContent === 'Choose this folder')?.click())
const activeRow = () => [...document.querySelectorAll('.new-item__row')].findIndex((r) => r.classList.contains('new-item__row--active'))
const place = () => document.querySelector('.new-item__place')?.textContent

describe('NewItemBox (YAZ-3556 D5, D7)', () => {
  it('opens on Note with the keyboard on the sheet; ← → pick the kind without wrapping; ⏎ makes it in the folder; Esc closes', () => {
    const { onMake, onClose } = render()
    expect([...document.querySelectorAll('.new-item__tile .new-item__label')].map((t) => t.textContent)).toEqual(['Note', 'Excalidraw drawing', 'draw.io diagram', 'Folder'])
    expect(chosen()).toBe('Note')
    expect(document.activeElement).toBe(sheet())
    expect(place()).toBe('Inbox')
    press('ArrowLeft')
    expect(chosen()).toBe('Note')
    press('ArrowRight')
    press('ArrowRight')
    press('ArrowRight')
    press('ArrowRight')
    expect(chosen()).toBe('Folder')
    press('ArrowLeft')
    press('ArrowLeft')
    expect(chosen()).toBe('Excalidraw drawing')
    // ⏎ on the kinds moves to the places; ⏎ there makes it.
    expect(activeRow()).toBe(0)
    press('Enter')
    expect(activeRow()).toBe(1)
    expect(onMake).not.toHaveBeenCalled()
    press('Enter')
    expect(onMake).toHaveBeenCalledExactlyOnceWith('drawing', '/v/Inbox')
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click picks a tile, a double click makes it; Create makes the one picked', () => {
    const { onMake } = render('/v')
    const tiles = [...document.querySelectorAll<HTMLButtonElement>('.new-item__tile')]
    act(() => tiles[2].click())
    expect(chosen()).toBe('draw.io diagram')
    act(() => document.querySelector<HTMLButtonElement>('.new-item__make')?.click())
    expect(onMake).toHaveBeenLastCalledWith('diagram', '/v')
    act(() => void tiles[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(onMake).toHaveBeenLastCalledWith('file', '/v')
  })

  it('a default folder the vault does not have: the vault folder, and it says so (D3)', () => {
    render('/v', 'Inbox')
    expect(place()).toBe('Notes')
    expect(document.querySelector('.new-item .confirm__status')?.textContent).toMatch(/“Inbox” is not in this vault/)
  })

  it('Choose… opens the picker over the box; its pick is the folder for this item, and the box has the keyboard again', () => {
    const { onMake } = render('/v')
    act(() => document.querySelector<HTMLButtonElement>('.new-item__choose')?.click())
    const picker = document.querySelector('.place-picker')
    expect(picker).not.toBeNull()
    // Esc in the picker closes the picker alone.
    act(() => void picker?.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(document.querySelector('.place-picker')).toBeNull()
    expect(sheet()).not.toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('.new-item__choose')?.click())
    act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__row')].find((r) => r.textContent?.includes('Projects'))?.click())
    act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__row')].find((r) => r.textContent === 'Choose this folder')?.click())
    expect(document.querySelector('.place-picker')).toBeNull()
    expect(place()).toBe('Projects')
    expect(document.activeElement).toBe(sheet())
    press('Enter')
    press('Enter')
    expect(onMake).toHaveBeenCalledExactlyOnceWith('file', '/v/Projects')
  })
})

describe('the New… box\'s folders, place shortcuts and keys (YAZ-4252)', () => {
  it('D1: the Folder tile makes a folder in the place', () => {
    const { onMake } = render()
    press('4')
    expect(chosen()).toBe('Folder')
    press('Enter')
    expect(onMake).toHaveBeenCalledExactlyOnceWith('dir', '/v/Inbox')
  })

  it('D2, D3: "+ Add place" saves a pick in the vault file; a click uses it; right-click changes and removes it', async () => {
    const { onMake } = render('/v')
    await flush()
    expect(slotNames()).toEqual(['+ Add place', '+ Add place', '+ Add place'])
    act(() => slots()[2]!.click())
    pick('Projects')
    chooseHere()
    await flush()
    expect(stored.get('/v')).toEqual([null, null, '/v/Projects'])
    expect(slotNames()[2]).toBe('Projects')
    expect(place()).toBe('Projects')
    // Change place: the picker opens on the shortcut's folder.
    act(() => void slots()[2]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })))
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Change place')?.click())
    act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__crumb')].find((c) => c.textContent === 'Notes')?.click())
    pick('Inbox')
    chooseHere()
    await flush()
    expect(stored.get('/v')).toEqual([null, null, '/v/Inbox'])
    // Remove.
    act(() => void slots()[2]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })))
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Remove')?.click())
    await flush()
    expect(stored.get('/v')).toEqual([null, null, null])
    expect(onMake).not.toHaveBeenCalled()
  })

  it('the demo: a right-click on a shortcut shows its two items over the box; Esc closes the menu first, then the box', async () => {
    stored.set('/v', ['/v/Inbox', null, null])
    const { onClose } = render('/v')
    await flush()
    act(() => void slots()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })))
    expect([...document.querySelectorAll('.new-item__menu-layer [role="menuitem"]')].map((b) => b.textContent)).toEqual(['Change place', 'Remove'])
    press('Escape')
    expect(document.querySelector('.ctx-menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the demo: a pencil changes a shortcut; the tooltip names the whole place; two of one name show their parents; a folder another shortcut holds is not saved', async () => {
    stored.set('/v', ['/v/Projects', '/v/Inbox', null])
    render('/v')
    await flush()
    expect(slots()[0]!.title).toBe('Projects')
    act(() => document.querySelector<HTMLButtonElement>('.new-item__slot-edit')!.click())
    act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__crumb')].find((c) => c.textContent === 'Notes')?.click())
    pick('Inbox')
    chooseHere()
    await flush()
    expect(document.querySelector('.new-item__already')?.textContent).toBe('Already in shortcut 2')
    expect(stored.get('/v')).toEqual(['/v/Projects', '/v/Inbox', null])
  })

  it('the demo: a roving focus; a click, an arrow and a number move the choice and the focus together', () => {
    render('/v')
    const tiles = () => [...document.querySelectorAll<HTMLButtonElement>('.new-item__tile')]
    act(() => tiles()[2]!.click())
    expect(document.activeElement).toBe(tiles()[2])
    expect(tiles().map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1])
    press('ArrowRight')
    expect(document.activeElement).toBe(tiles()[3])
    expect(document.querySelectorAll('.new-item__tile[aria-checked="true"]')).toHaveLength(1)
    // A number moves the choice and the bar to the places: the tile no longer holds the focus.
    press('2')
    expect(chosen()).toBe('Excalidraw drawing')
    expect(tiles().includes(document.activeElement as HTMLButtonElement)).toBe(false)
  })

  it('the demo: two shortcuts of one name show their parent folders; a window of two vaults names the vault in the tooltip', async () => {
    stored.set('/v', ['/v/Projects/2026/folder2', '/v/Inbox/folder2', '/v/Inbox'])
    render('/v', null, [{ root: '/v', name: 'Notes' }, { root: '/w', name: 'Work vault' }])
    await flush()
    expect(slots().map((b) => b.querySelector('.new-item__slot-parent')?.textContent ?? null)).toEqual(['2026', 'Inbox', null])
    expect(slots()[0]!.title).toBe('Notes / Projects / 2026 / folder2')
  })

  it('keys: `1`, `3`, ⏎ makes a note in the third place; ↑ goes back to the kinds', async () => {
    stored.set('/v', ['/v/Inbox', null, '/v/Projects'])
    const { onMake } = render('/v')
    await flush()
    press('1')
    expect(activeRow()).toBe(1)
    press('ArrowUp')
    expect(activeRow()).toBe(0)
    press('1')
    press('3')
    expect(place()).toBe('Projects')
    expect(document.querySelector('.new-item__slot[aria-checked="true"] .new-item__slot-name')?.textContent).toBe('Projects')
    press('Enter')
    expect(onMake).toHaveBeenCalledExactlyOnceWith('file', '/v/Projects')
  })

  it('a workspace: the shortcuts are those of the vault the folder is in; a pick in another vault shows that vault\'s', async () => {
    stored.set('/v', ['/v/Inbox', null, null])
    stored.set('/w', [null, '/w/Work', null])
    render('/v', null, [{ root: '/v', name: 'Notes' }, { root: '/w', name: 'Work vault' }])
    await flush()
    expect(slotNames()).toEqual(['Inbox', '+ Add place', '+ Add place'])
    act(() => document.querySelector<HTMLButtonElement>('.new-item__choose')?.click())
    act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__crumb')].find((c) => c.textContent === 'Vaults')?.click())
    pick('Work vault')
    pick('Work')
    chooseHere()
    await flush()
    expect(slotNames()).toEqual(['+ Add place', 'Work', '+ Add place'])
  })

  it('D4: Choose… offers the last places used at the top', async () => {
    const first = render()
    await flush()
    press('Enter')
    press('Enter')
    expect(first.onMake).toHaveBeenCalledWith('file', '/v/Inbox')
    act(() => root?.unmount())
    render('/v')
    act(() => document.querySelector<HTMLButtonElement>('.new-item__choose')?.click())
    const rows = [...document.querySelectorAll<HTMLElement>('.place-picker__row')]
    expect(rows[0]?.textContent).toContain('Inbox')
    expect(rows[0]?.textContent).toContain('Recent')
    act(() => rows[0]!.click())
    expect(place()).toBe('Inbox')
  })
})
