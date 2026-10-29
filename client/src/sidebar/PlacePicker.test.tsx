/**
 * The place picker (YAZ-3556 D6): it opens on the folders of the vault in front; a folder row goes in, the path bar goes
 * back, "Choose this folder" picks; typing filters every folder of that vault; files mode picks a file; two vaults put
 * "Vaults" first in the bar; the keyboard (↑ ↓ ⏎ ⌫ Esc) and the cap on rows drawn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode } from '@shared/types'
import { PLACE_ROWS, PlacePicker, type PlaceVault } from './PlacePicker'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const trees = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../lib/treeFeed', () => ({
  latestTree: (root: string) => (trees.has(root) ? { root, tree: trees.get(root), generatedAt: 1 } : null),
  onTree: () => () => undefined,
  fetchTree: async () => ({ root: '', tree: [], generatedAt: 1 }),
}))

const note = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
trees.set('/v', [
  note('/v/top.md'),
  folder('/v/Projects', [folder('/v/Projects/Alpha', [note('/v/Projects/Alpha/plan.md')]), folder('/v/Projects/Beta', [])]),
  folder('/v/Areas', [folder('/v/Areas/Health', [])]),
])
trees.set('/w', [folder('/w/Work', [])])
const V: PlaceVault = { root: '/v', name: 'Notes' }
const W: PlaceVault = { root: '/w', name: 'Work vault' }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(props: Partial<Parameters<typeof PlacePicker>[0]> = {}) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<StrictMode><PlacePicker vaults={[V]} label="Choose a folder" onPick={onPick} onClose={onClose} {...props} /></StrictMode>))
  return { onPick, onClose }
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.place-picker__row')]
const names = () => rows().map((r) => r.querySelector('.place-picker__name')?.textContent)
const crumbs = () => [...document.querySelectorAll<HTMLButtonElement>('.place-picker__crumb')]
const rowNamed = (name: string) => rows().find((r) => r.querySelector('.place-picker__name')?.textContent === name)
const click = (el: Element | undefined) => act(() => void el?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const input = () => document.querySelector<HTMLInputElement>('.place-picker input')!
const type = (value: string) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const press = (key: string) => act(() => void input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))

describe('PlacePicker (YAZ-3556 D6)', () => {
  it('opens on the vault folder: "Choose this folder", then its folders by name, no files; a folder row goes in, the path bar goes back, Choose picks', () => {
    const { onPick } = render()
    expect(names()).toEqual(['Choose this folder', 'Areas', 'Projects'])
    expect(crumbs().map((c) => c.textContent)).toEqual(['Notes'])
    click(rowNamed('Projects'))
    expect(names()).toEqual(['Choose this folder', 'Alpha', 'Beta'])
    expect(crumbs().map((c) => c.textContent)).toEqual(['Notes', 'Projects'])
    click(rowNamed('Alpha'))
    expect(names()).toEqual(['Choose this folder'])
    // The bar goes back to any folder above.
    click(crumbs()[1])
    expect(crumbs().map((c) => c.textContent)).toEqual(['Notes', 'Projects'])
    click(rowNamed('Choose this folder'))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Projects', '/v')
  })

  it('opens on `start`; typing filters every folder of that vault, name matches first, with the folder above; a click picks the match', () => {
    const { onPick } = render({ start: '/v/Projects/Alpha' })
    expect(crumbs().map((c) => c.textContent)).toEqual(['Notes', 'Projects', 'Alpha'])
    type('a')
    // "Alpha" and "Areas" start with "a", "Beta" and "Health" have one inside, each in the tree's order; "Projects" has none.
    expect(names()).toEqual(['Alpha', 'Areas', 'Beta', 'Health'])
    expect(crumbs()).toEqual([]) // the bar steps away while the text filters
    type('heal')
    expect(names()).toEqual(['Health'])
    expect(rows()[0].querySelector('.place-picker__where')?.textContent).toBe('Areas')
    click(rows()[0])
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Areas/Health', '/v')
  })

  it('the keyboard: ↓ ⏎ goes in, ⌫ in an empty field goes back, ⏎ on Choose picks; Esc clears the text, then closes', () => {
    const { onPick, onClose } = render()
    press('ArrowDown') // Areas
    press('Enter')
    expect(crumbs().map((c) => c.textContent)).toEqual(['Notes', 'Areas'])
    press('Backspace')
    expect(crumbs().map((c) => c.textContent)).toEqual(['Notes'])
    press('Enter')
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v', '/v')
    type('x')
    press('Escape')
    expect(input().value).toBe('')
    expect(onClose).not.toHaveBeenCalled()
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('files mode: folders then files, no "Choose this folder"; a folder goes in, a file picks; typing finds files', () => {
    const { onPick } = render({ mode: 'files', label: 'Choose a file' })
    expect(names()).toEqual(['Areas', 'Projects', 'top.md'])
    click(rowNamed('Projects'))
    click(rowNamed('Alpha'))
    expect(names()).toEqual(['plan.md'])
    type('pla')
    expect(names()).toEqual(['plan.md'])
    click(rows()[0])
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v/Projects/Alpha/plan.md', '/v')
  })

  it('two vaults: the one in front opens, "Vaults" leads the bar and lists both in their order; the other vault opens from there', () => {
    const { onPick } = render({ vaults: [W, V] })
    expect(crumbs().map((c) => c.textContent)).toEqual(['Vaults', 'Work vault'])
    expect(names()).toEqual(['Choose this folder', 'Work'])
    click(crumbs()[0])
    expect(names()).toEqual(['Work vault', 'Notes'])
    click(rowNamed('Notes'))
    click(rowNamed('Choose this folder'))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('/v', '/v')
  })

  it(`draws at most ${PLACE_ROWS} rows and says how many more`, () => {
    trees.set('/big', Array.from({ length: 70 }, (_, i) => folder(`/big/f${String(i).padStart(2, '0')}`, [])))
    render({ vaults: [{ root: '/big', name: 'Big' }] })
    expect(rows()).toHaveLength(PLACE_ROWS)
    expect(document.querySelector('.place-picker__more')?.textContent).toMatch(/^21 more/)
  })
})
