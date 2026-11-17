// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import type { Harness } from '../screens/testing'
import { forgetFolderTabs } from './FolderBody'
import { openFolder, waitFor } from './folderTesting'

/**
 * YAZ-5599: a grouped folder table's group row is one cell across the whole row, as the Mac's: the name on one line
 * however narrow the Name column, cut with "…" only at the table's visible edge, the count after it, held at the left
 * while the table scrolls sideways; the arrow (YAZ-5598) and the grid (YAZ-5595) still there. Made-up vault.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  localStorage.clear()
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  forgetFolderTabs()
  document.body.replaceChildren()
  localStorage.clear()
})

describe("a group row spans the folder table's whole row (YAZ-5599)", () => {
  it('one cell across every column, the # too: the arrow, the name, the count, in one line', async () => {
    h = await openFolder('Projects')
    await act(async () => [...h!.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === 'By status')!.click())
    await h.settle()
    await waitFor(h, () => h!.host.querySelector('.folder-table tr.folder-table__group') !== null)
    const table = h.host.querySelector<HTMLTableElement>('.folder-table table')!
    const width = table.tHead!.rows[0]!.cells.length
    const groups = [...table.querySelectorAll<HTMLTableRowElement>('tr.folder-table__group')]
    expect(groups.length).toBeGreaterThan(1)
    for (const g of groups) {
      expect(g.cells).toHaveLength(1)
      const th = g.cells[0]!
      expect(th.scope).toBe('rowgroup')
      expect(th.colSpan).toBe(width)
      const line = th.querySelector('.folder-table__group-line')!
      expect([...line.children].map((c) => c.className)).toEqual(['folder-table__fold', 'folder-table__label', 'folder-table__count'])
    }
    expect(groups.map((g) => g.querySelector('.folder-table__label')!.textContent)).toEqual(['Idea', 'Doing', 'Done'])
    expect(groups.map((g) => g.querySelector('.folder-table__count')!.textContent)).toEqual([' 2', ' 2', ' 0'])
    // The body rows keep their columns, numbered from 1 in each group.
    const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row]')]
    expect(rows.every((tr) => tr.cells.length === width)).toBe(true)
    expect(rows.map((tr) => tr.cells[0]!.textContent)).toEqual(['1', '2', '1', '2'])
  })

  it('the line: as wide as the visible table, at the left while it scrolls, one line, the name cut with "…", the count kept', () => {
    const css = readFileSync(resolve(import.meta.dirname, 'folders.css'), 'utf8')
    const rule = (selector: string) => {
      const at = css.indexOf(`\n${selector} {`)
      return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    }
    const line = rule('.folder-table__group-line')
    expect(line).toMatch(/position: sticky;/)
    expect(line).toMatch(/left: 0;/)
    expect(line).toMatch(/width: var\(--folder-group-w, 100%\);/)
    expect(line).toMatch(/white-space: nowrap;/)
    expect(rule('.folder-table__label')).toMatch(/text-overflow: ellipsis;/)
    expect(rule('.folder-table__count')).toMatch(/flex: none;/)
    // Clip, not hidden: a hidden cell would be the line's scroll box.
    expect(rule('.folder-table .page-table-box .page-table-frame .page-table table tr.folder-table__group > th')).toMatch(/overflow: clip;/)
  })
})
