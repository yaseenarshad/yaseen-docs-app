/**
 * The Folder column shows the path from the page (YAZ-4801 demo: "how come no folder showing up here?" / "does it hide
 * recipes?"). `rowCell` draws a `file.folder` cell under the page's `FolderPages`:
 * - From this page (default, `path`): starts WITH the page, so a note directly in the page shows the page's name;
 * - Full path (`full`): from the vault's top;
 * - Last folder (`last`): only where the note lives.
 * Each part is a chip that opens that folder's page. `folderColumnOf` reads the view's key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { FolderPages, rowCell, type FolderPagesValue } from './GroupHeader'
import { folderColumnOf } from '../viewSchema'
import type { Row } from '../engine'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const TITLES: Record<string, string> = { '': 'vault', top: 'Top', 'top/recipes': 'Recipes', 'top/recipes/desserts': 'Desserts', 'top/other': 'Other' }
const rowIn = (folder: string): Row => ({ record: { ...TEST_RECORDS[0], folder } as IndexRecord, values: {} }) as unknown as Row

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function cell(folder: string, page: string, folderColumn: FolderPagesValue['folderColumn'], open?: (dir: string) => void): HTMLElement {
  const pages: FolderPagesValue = { folder: page, title: (dir) => TITLES[dir] ?? dir, open, folderColumn, folderIcons: true, folderCounts: false }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<FolderPages.Provider value={pages}>{rowCell(rowIn(folder), 'file.folder')}</FolderPages.Provider>))
  return container
}
const parts = (el: HTMLElement) => [...el.querySelectorAll('.view-folder-path__part')].map((p) => p.textContent)

describe('YAZ-4801 demo: From this page (the default) starts with the page', () => {
  it('YAZ-4801 demo: a note directly in the page shows the page name, never a blank', () => {
    expect(parts(cell('top/recipes', 'top/recipes', 'path'))).toEqual(['Recipes'])
  })

  it('YAZ-4801 demo: a note in a subfolder shows the page, then the subfolder', () => {
    const el = cell('top/recipes/desserts', 'top/recipes', 'path')
    expect(parts(el)).toEqual(['Recipes', 'Desserts'])
    expect(el.querySelector('.view-folder-path')!.getAttribute('title')).toBe('Recipes › Desserts')
    expect(el.querySelector('.view-folder-path__part--last')!.textContent).toBe('Desserts')
  })

  it('YAZ-4801 demo: absent (undefined) reads as From this page', () => {
    expect(parts(cell('top/recipes/desserts', 'top/recipes', undefined))).toEqual(['Recipes', 'Desserts'])
  })

  it('YAZ-4801 demo: a note that lives outside the page (a shortcut) shows its whole path from the vault top, "Lives in"', () => {
    const el = cell('top/other', 'top/recipes', 'path')
    expect(parts(el)).toEqual(['Top', 'Other'])
    expect(el.querySelector('.view-folder-path')!.getAttribute('title')).toBe('Lives in Top › Other')
  })
})

describe('YAZ-4801 demo: Full path and Last folder', () => {
  it('YAZ-4801 demo: Full path starts at the vault top', () => {
    expect(parts(cell('top/recipes/desserts', 'top/recipes', 'full'))).toEqual(['Top', 'Recipes', 'Desserts'])
    expect(parts(cell('top/recipes', 'top/recipes', 'full'))).toEqual(['Top', 'Recipes'])
  })

  it('YAZ-4801 demo: Last folder shows only where the note lives; directly in the page, the page name', () => {
    expect(cell('top/recipes/desserts', 'top/recipes', 'last').textContent).toBe('Desserts')
    act(() => root?.unmount())
    container?.remove()
    expect(cell('top/recipes', 'top/recipes', 'last').textContent).toBe('Recipes')
  })
})

describe('YAZ-4801 demo: each part opens its folder page', () => {
  it('YAZ-4801 demo: a click on a part opens that folder', () => {
    const open = vi.fn()
    const el = cell('top/recipes/desserts', 'top/recipes', 'path', open)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button.view-folder-path__part')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Recipes', 'Desserts'])
    act(() => buttons[0].click())
    expect(open).toHaveBeenCalledWith('top/recipes')
    act(() => buttons[1].click())
    expect(open).toHaveBeenLastCalledWith('top/recipes/desserts')
  })
})

describe('YAZ-4801 demo: folderColumnOf', () => {
  it('YAZ-4801 demo: `last` and `full` read back; absent or anything else is the default path', () => {
    expect(folderColumnOf({ type: 'table', name: 'T' })).toBe('path')
    expect(folderColumnOf({ type: 'table', name: 'T', folderColumn: 'last' })).toBe('last')
    expect(folderColumnOf({ type: 'table', name: 'T', folderColumn: 'full' })).toBe('full')
    expect(folderColumnOf({ type: 'table', name: 'T', folderColumn: 'nonsense' } as never)).toBe('path')
  })
})
