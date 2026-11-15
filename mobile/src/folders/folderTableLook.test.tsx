// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_FILES } from '../dev/folderVault'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import type { Harness } from '../screens/testing'
import { forgetFolderTabs } from './FolderBody'
import { openFolder, waitFor } from './folderTesting'

/**
 * YAZ-5549: the phone's folder table draws the row height, the row numbers and a subfolder's "N inside" as the Mac's
 * folder page does, from the vault's `.yaseendocs/folder-pages.json` (a view's own key first; no file: the Mac's
 * defaults: Short rows, numbers on, no count). The numbers start again from 1 under each group. The Name cell keeps its
 * 44 px tap (YAZ-5532): a taller row height wins, a shorter one leaves the Name cell at 44. Made-up vault.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  forgetFolderTabs()
  document.body.replaceChildren()
})

/** The Projects folder with "Subfolders: As rows" on its Table and Cards views; `table` adds keys to the Table view. */
const files = (vault: object | null, table = '') => {
  const settings = (FOLDER_FILES['Projects/.folder.md'] as string)
    .replace('      name: Table\n', `      name: Table\n      subfolders: rows\n${table}`)
    .replace('      name: Cards\n', '      name: Cards\n      subfolders: rows\n')
  return { ...FOLDER_FILES, 'Projects/.folder.md': settings, ...(vault !== null && { '.yaseendocs/folder-pages.json': JSON.stringify({ version: 1, ...vault }) }) }
}
const opened = async (vault: object | null, table = ''): Promise<HTMLTableElement> => {
  h = await openFolder('Projects', files(vault, table))
  await waitFor(h, () => h!.host.querySelector('.folder-table tr[data-folder]') !== null)
  return h.host.querySelector<HTMLTableElement>('.folder-table table')!
}
const firstColumn = (table: HTMLTableElement) => [...table.rows].map((tr) => tr.cells[0]!.textContent)
const tab = async (name: string) => {
  await act(async () => [...h!.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === name)!.click())
  await h!.settle()
}

describe("the folder table wears the vault's folder page defaults (YAZ-5549)", () => {
  it("no file: the Mac's defaults: Short rows (28 px), a # column numbered from 1, no count", async () => {
    const table = await opened(null)
    expect(table.dataset.rowHeight).toBe('28')
    expect(table.style.getPropertyValue('--folder-row-h')).toBe('28px')
    expect(firstColumn(table)).toEqual(['#', '1', '2', '3', '4', '5'])
    expect(table.querySelector('tr[data-folder] td[data-name]')?.textContent).toBe('Trips')
    expect(h!.host.querySelector('.folder-inside')).toBeNull()
  })

  it('the vault says Tall rows, no row numbers, "Pages inside count" on: 68 px, no # column, "1 inside" on the subfolder row and its card', async () => {
    const table = await opened({ rowHeight: 'tall', rowNumbers: false, folderCounts: true })
    expect(table.dataset.rowHeight).toBe('68')
    expect(table.style.getPropertyValue('--folder-row-h')).toBe('68px')
    expect(table.querySelector('.folder-table__num')).toBeNull()
    expect(table.rows[0]!.cells[0]!.textContent).toBe('Name')
    expect(table.getAttribute('data-freeze-cols')).toBe('1')
    expect(table.querySelector('tr[data-folder] td[data-name]')?.textContent).toBe('Trips1 inside')
    expect(table.querySelector('tr[data-folder] .folder-inside')?.textContent).toBe('1 inside')
    // A page's row has no count.
    expect(table.querySelectorAll('.folder-inside')).toHaveLength(1)
    // The Cards view: the subfolder's card says it too, after its title.
    await tab('Cards')
    await waitFor(h!, () => h!.host.querySelector('.folder-card .folder-inside') !== null)
    expect([...h!.host.querySelectorAll('.folder-card__title')].map((t) => t.textContent)).toContain('Trips1 inside')
  })

  it("Medium rows (44 px); a view's own keys win over the vault's", async () => {
    const table = await opened({ rowHeight: 'medium', rowNumbers: false, folderCounts: true }, '      rowHeight: short\n      rowNumbers: true\n      folderCounts: false\n')
    expect(table.dataset.rowHeight).toBe('28')
    expect(firstColumn(table)[0]).toBe('#')
    expect(h!.host.querySelector('.folder-inside')).toBeNull()
    await tab('By status')
    const grouped = h!.host.querySelector<HTMLTableElement>('.folder-table table')!
    expect(grouped.dataset.rowHeight).toBe('44')
    expect(grouped.querySelector('.folder-table__num')).toBeNull()
  })

  it('the Name cell keeps a 44 px tap: the larger of the tap and the row height; the other cells take the row height', () => {
    const css = readFileSync(resolve(import.meta.dirname, 'folders.css'), 'utf8')
    expect(css).toMatch(/\.folder-table tbody td\[data-name\] \{\s*height: max\(var\(--tap\), var\(--folder-row-h, 28px\)\);/)
    expect(css).toMatch(/\.folder-table tbody tr:not\(\.folder-table__group\) > td \{\s*height: var\(--folder-row-h, 28px\);/)
  })
})
