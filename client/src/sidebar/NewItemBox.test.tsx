/**
 * The New… box (⌘N, YAZ-3556 D5, D7, D3): it opens on Note, ← → pick the kind (no wrap), ⏎ makes it in the folder on
 * show, Esc closes; a missing default folder says so; "Change…" opens the place picker for this one item.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode } from '@shared/types'
import { NewItemBox } from './NewItemBox'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/treeFeed', () => {
  const tree: TreeNode[] = [{ type: 'dir', name: 'Projects', path: '/v/Projects', children: [] }]
  return { latestTree: (root: string) => ({ root, tree, generatedAt: 1 }), onTree: () => () => undefined, fetchTree: async () => ({ root: '/v', tree, generatedAt: 1 }) }
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(dir = '/v/Inbox', missing: string | null = null) {
  const onMake = vi.fn()
  const onClose = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<StrictMode><NewItemBox vaults={[{ root: '/v', name: 'Notes' }]} dir={dir} missing={missing} onMake={onMake} onClose={onClose} /></StrictMode>))
  return { onMake, onClose }
}

const sheet = () => document.querySelector<HTMLElement>('.new-item')!
const press = (key: string) => act(() => void (document.activeElement ?? sheet()).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
const chosen = () => document.querySelector('.new-item__tile[aria-checked="true"]')?.textContent
const place = () => document.querySelector('.new-item__place')?.textContent

describe('NewItemBox (YAZ-3556 D5, D7)', () => {
  it('opens on Note with the keyboard on the sheet; ← → pick the kind without wrapping; ⏎ makes it in the folder; Esc closes', () => {
    const { onMake, onClose } = render()
    expect([...document.querySelectorAll('.new-item__tile')].map((t) => t.textContent)).toEqual(['Note', 'Excalidraw drawing', 'draw.io diagram'])
    expect(chosen()).toBe('Note')
    expect(document.activeElement).toBe(sheet())
    expect(place()).toBe('Inbox')
    press('ArrowLeft')
    expect(chosen()).toBe('Note')
    press('ArrowRight')
    press('ArrowRight')
    press('ArrowRight')
    expect(chosen()).toBe('draw.io diagram')
    press('ArrowLeft')
    expect(chosen()).toBe('Excalidraw drawing')
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

  it('Change… opens the picker over the box; its pick is the folder for this item, and the box has the keyboard again', () => {
    const { onMake } = render('/v')
    act(() => document.querySelector<HTMLButtonElement>('.new-item__change')?.click())
    const picker = document.querySelector('.place-picker')
    expect(picker).not.toBeNull()
    // Esc in the picker closes the picker alone.
    act(() => void picker?.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(document.querySelector('.place-picker')).toBeNull()
    expect(sheet()).not.toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('.new-item__change')?.click())
    act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__row')].find((r) => r.textContent?.includes('Projects'))?.click())
    act(() => [...document.querySelectorAll<HTMLElement>('.place-picker__row')].find((r) => r.textContent === 'Choose this folder')?.click())
    expect(document.querySelector('.place-picker')).toBeNull()
    expect(place()).toBe('Projects')
    expect(document.activeElement).toBe(sheet())
    press('Enter')
    expect(onMake).toHaveBeenCalledExactlyOnceWith('file', '/v/Projects')
  })
})
