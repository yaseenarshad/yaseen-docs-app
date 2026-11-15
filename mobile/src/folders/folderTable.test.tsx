// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_FILES } from '../dev/folderVault'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { forgetFolderTabs } from './FolderBody'
import type { Harness } from '../screens/testing'
import { openFolder, waitFor } from './folderTesting'

/**
 * YAZ-5460, the table view: the Mac's engine runs the view, so the phone shows the Mac's rows and columns (order,
 * labels, formats, sort, filter, groups), in the phone's table look (sticky header and Name column, ⤢); a tap on a
 * row opens its page, a subfolder's row its folder's page.
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

const grid = (x: Harness) => [...x.host.querySelectorAll<HTMLTableRowElement>('.folder-table table tr')].map((tr) => [...tr.cells].map((c) => c.textContent?.trim()).join(' | '))
const tab = async (x: Harness, name: string) => {
  await act(async () => [...x.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === name)!.click())
  await x.settle()
}

describe('the folder table (YAZ-5460)', () => {
  it('the Mac table: its columns, labels, formats and sort; Other files out; the phone table look', async () => {
    h = await openFolder()
    await waitFor(h, () => h!.host.querySelector('.folder-table table') !== null)
    expect(grid(h)).toEqual([
      'Name | Status | Due | Budget | Owner',
      'Bike repair | Done | Nov 2, 2026 | $85.50 | Sam',
      'Lisbon weekend | Doing | Nov 14, 2026 | $640.00 | Lee',
      'Garden shed | Doing | Nov 20, 2026 | $1,200.00 | Sam',
      'Photo album | Idea | Nov 28, 2026 | $60.00 | Lee',
      'Kitchen paint | Idea | Dec 5, 2026 | $300.00 | Ana',
    ])
    expect(h.host.querySelector('.folder-view__count')?.textContent).toBe('5 pages')
    const table = h.host.querySelector('.folder-table table')!
    // YAZ-5471/5480: in its own box with ⤢, the header row frozen, the Name column sticky; the view's widths and alignment.
    expect(table.closest('.page-table-box')?.querySelector('[data-table-open]')).not.toBeNull()
    expect(table.getAttribute('data-pin-rows')).toBe('1')
    expect(table.getAttribute('data-pin-cols')).toBe('1')
    expect(table.getAttribute('data-widths')).toBe('220 auto auto auto 140')
    expect(table.querySelector('tbody tr td:nth-child(4)')?.getAttribute('align')).toBe('right')
    // A tap on a row opens its page.
    await act(async () => (table.querySelectorAll('tbody tr')[2] as HTMLElement).querySelector('td')!.click())
    await h.waitText('Build the shed before winter.')
  })

  it('YAZ-5532: a finger bands the row, its frozen Name cell too; it stays after the lift; a tap still opens the row', async () => {
    h = await openFolder()
    await waitFor(h, () => h!.host.querySelector('.folder-table table') !== null)
    const table = h.host.querySelector('.folder-table table')!
    const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')]
    const fire = (el: Element, type: string) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 })
      el.dispatchEvent(e)
      return e
    }
    const down = fire(rows[1].cells[3], 'pointerdown')
    expect(down.defaultPrevented).toBe(false)
    expect([...table.querySelectorAll('tr[data-band]')]).toEqual([rows[1]])
    expect(rows[1].cells[0].hasAttribute('data-pin-col')).toBe(true)
    fire(rows[1].cells[3], 'pointerup')
    expect([...table.querySelectorAll('tr[data-band]')]).toEqual([rows[1]])
    // Another row: the band moves; its tap opens its page, through the same handler as before.
    fire(rows[2].cells[0], 'pointerdown')
    expect(rows[2].hasAttribute('data-band')).toBe(true)
    expect(rows[1].hasAttribute('data-band')).toBe(false)
    await act(async () => {
      fire(rows[2].cells[0], 'pointerup')
      rows[2].cells[0].click()
    })
    await h.waitText('Build the shed before winter.')
  })

  it('a grouped view: its filter, its groups in the option order with their counts, the empty one kept', async () => {
    h = await openFolder()
    await tab(h, 'By status')
    expect(grid(h)).toEqual(['Name | Due | Owner', 'Idea 2 |  | ', 'Kitchen paint | Dec 5, 2026 | Ana', 'Photo album | Nov 28, 2026 | Lee', 'Doing 2 |  | ', 'Garden shed | Nov 20, 2026 | Sam', 'Lisbon weekend | Nov 14, 2026 | Lee', 'Done 0 |  | '])
    expect(h.host.querySelector('.folder-view__count')?.textContent).toBe('4 pages')
    expect(h.host.querySelectorAll('.folder-table__group')).toHaveLength(3)
  })

  it('"Subfolders: As rows": a row for the subfolder, which opens its folder page', async () => {
    const files = { ...FOLDER_FILES, 'Projects/.folder.md': (FOLDER_FILES['Projects/.folder.md'] as string).replace('      name: Table\n', '      name: Table\n      subfolders: rows\n') }
    h = await openFolder('Projects', files)
    await waitFor(h, () => h!.host.querySelector('.folder-table tr[data-folder]') !== null)
    // The folder's own pages and the subfolder's row; its pages are in its own page.
    expect(grid(h).map((line) => line.split(' | ')[0])).toEqual(['Name', 'Trips', 'Bike repair', 'Garden shed', 'Photo album', 'Kitchen paint'])
    expect(h.host.querySelector('.folder-view__count')?.textContent).toBe('4 pages · 1 folder')
    await act(async () => h!.host.querySelector<HTMLElement>('.folder-table tr[data-folder] td')!.click())
    await waitFor(h, () => h!.host.querySelector('.folder-page .reader__title')?.textContent === 'Trips')
    // Trips declares no view: the Mac's default table, the columns it takes from Projects (C2) in their sorted order.
    expect(grid(h)).toEqual(['Name | Budget | Due | Owner | Status', 'Lisbon weekend | $640.00 | Nov 14, 2026 | Lee | Doing'])
  })
})
