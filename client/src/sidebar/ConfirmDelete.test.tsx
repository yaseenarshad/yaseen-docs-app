/** The confirm sheet's copy and keyboard behaviour (GRO-2272 `C2-`). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { pathTitles } from '../lib/pageLabel'
import { ConfirmDelete, deleteConfirmMessage, type DeleteTarget } from './ConfirmDelete'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NONE = pathTitles([], [])

describe('deleteConfirmMessage', () => {
  it('E: the delete sheet names a note and a folder by their titles; a file the index does not hold by its file name (YAZ-2420 D14)', () => {
    const titled = (path: string, title: string) => ({ path, title }) as IndexRecord
    const titles = pathTitles([titled('/v/up-001-abdul-k3m9x2pq7abc.md', 'UP-001 - Abdul')], [titled('/v/upwork/.folder.md', 'Upwork 2026')])
    expect(deleteConfirmMessage({ path: '/v/up-001-abdul-k3m9x2pq7abc.md', kind: 'file' }, titles)).toBe('Delete "UP-001 - Abdul"? It moves to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/upwork', kind: 'dir' }, titles)).toBe('Delete "Upwork 2026"? It moves to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/scan.pdf', kind: 'file' }, titles)).toBe('Delete "scan.pdf"? It moves to the Trash.')
  })

  it('a file with no backlinks says only what happens', () => {
    expect(deleteConfirmMessage({ path: '/v/Roadmap.md', kind: 'file', backlinks: 0 }, NONE)).toBe('Delete "Roadmap"? It moves to the Trash.')
  })

  it('a file with backlinks appends the count, pluralised', () => {
    expect(deleteConfirmMessage({ path: '/v/Roadmap.md', kind: 'file', backlinks: 3 }, NONE)).toBe('Delete "Roadmap"? It moves to the Trash. 3 notes link to this.')
    expect(deleteConfirmMessage({ path: '/v/Roadmap.md', kind: 'file', backlinks: 1 }, NONE)).toBe('Delete "Roadmap"? It moves to the Trash. 1 note links to this.')
  })

  it('an unavailable backlink count prints no count line at all', () => {
    expect(deleteConfirmMessage({ path: '/v/Roadmap.md', kind: 'file' }, NONE)).toBe('Delete "Roadmap"? It moves to the Trash.')
  })

  it('a folder reports its contents, pluralised on each half', () => {
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { notes: 12, folders: 2 } }, NONE)).toBe('Delete "Docs"? 12 notes and 2 folders move to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { notes: 1, folders: 1 } }, NONE)).toBe('Delete "Docs"? 1 note and 1 folder move to the Trash.')
    // A single item takes a singular verb: "1 note moves", not "1 note move".
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { notes: 1, folders: 0 } }, NONE)).toBe('Delete "Docs"? 1 note moves to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { notes: 0, folders: 1 } }, NONE)).toBe('Delete "Docs"? 1 folder moves to the Trash.')
  })

  it('a folder with only notes, or only subfolders, omits the empty half', () => {
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { notes: 4, folders: 0 } }, NONE)).toBe('Delete "Docs"? 4 notes move to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { notes: 0, folders: 3 } }, NONE)).toBe('Delete "Docs"? 3 folders move to the Trash.')
  })

  it('an EMPTY folder never prints "0 notes and 0 folders"', () => {
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { notes: 0, folders: 0 } }, NONE)).toBe('Delete "Docs"? It moves to the Trash.')
  })
})

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(target: DeleteTarget, over: { onConfirm?: (d: boolean) => void; onCancel?: () => void } = {}) {
  const onConfirm = vi.fn(over.onConfirm)
  const onCancel = vi.fn(over.onCancel)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConfirmDelete target={target} titles={NONE} onConfirm={onConfirm} onCancel={onCancel} />))
  return { el: container, onConfirm, onCancel }
}

const FILE: DeleteTarget = { path: '/v/a.md', kind: 'file', backlinks: 0 }
const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

describe('ConfirmDelete', () => {
  it('E: names the note by its title (YAZ-2420 D14)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<ConfirmDelete target={FILE} titles={new Map([['/v/a.md', 'UP-001 - Abdul']])} onConfirm={vi.fn()} onCancel={vi.fn()} />))
    expect(container.querySelector('.confirm__text')?.textContent).toBe('Delete "UP-001 - Abdul"? It moves to the Trash.')
  })

  it('focuses CANCEL, not Delete — a stray Enter from the tree must destroy nothing', () => {
    const { el } = mount(FILE)
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
  })

  it('Escape cancels and deletes nothing', () => {
    const { onConfirm, onCancel } = mount(FILE)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('click-away cancels and deletes nothing', () => {
    const { el, onConfirm, onCancel } = mount(FILE)
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a click inside the sheet does NOT cancel it', () => {
    const { el, onCancel } = mount(FILE)
    act(() => void el.querySelector('.confirm')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Enter confirms', () => {
    const { onConfirm } = mount(FILE)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('reports the "Don\'t ask me again" checkbox state to onConfirm', () => {
    const { el, onConfirm } = mount(FILE)
    const box = el.querySelector<HTMLInputElement>('.confirm__ask input')
    act(() => void box?.click())
    act(() => btn(el, 'Delete')?.click())
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('is an in-app dialog, labelled by its own text — never a native one', () => {
    const { el } = mount(FILE)
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(el.querySelector('#confirm-delete-text')?.textContent).toContain('moves to the Trash')
  })
})
