/**
 * The row hover band in the folder table (YAZ-4538, D9): views.css's one rule, read as text, and its
 * selector run over a real grouped table in jsdom (which has no `:hover`, so the test drops it): it
 * reaches every cell of every data row, never a group header or a spacer, and nothing when the
 * Row band setting is Off or marks only the caret's row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'
import { DEFAULT_FOLDER_PAGES, folderRowBandOn, type TableRowBand } from '@shared/types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: vi.fn(() => []), setViewGroups: vi.fn() } }))

/** The band rule: its selector and its body. */
const BAND = /([^{}]*\.view-table tbody tr[^{}]*:hover > td)\s*\{([^}]*)\}/.exec(viewsCss)

let root: Root | null = null
let app: HTMLElement | null = null

/** `.app` as App draws it: the folder band follows the table block's Row band unless Settings › Folder pages sets its own (YAZ-4585). */
function mount(band: TableRowBand, rows = 'both', own: boolean | null = null): HTMLElement {
  app = document.createElement('div')
  app.className = 'app'
  app.dataset.tableRowBand = band
  app.dataset.folderRowBand = folderRowBandOn({ tableRowBand: band, folderPages: { ...DEFAULT_FOLDER_PAGES, rowBand: own } }) ? 'on' : 'off'
  app.dataset.tableBandRows = rows
  document.body.appendChild(app)
  root = createRoot(app)
  const parsed = parseViews('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.priority\n    groupBy:\n      property: note.status\n')
  act(() => root?.render(<ViewsPane parsed={parsed} onChange={vi.fn()} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={testFolderHost()} onOpenFile={vi.fn()} />))
  return app
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  app?.remove()
  app = null
})

describe('the row hover band (YAZ-4538)', () => {
  it('is the table block’s band colour and strength, as an inset shadow over the fill and a frozen cell', () => {
    expect(BAND).not.toBeNull()
    expect(BAND![2]).toMatch(/box-shadow:\s*inset 0 0 0 100vmax color-mix\(in srgb, var\(--table-band-colour, var\(--accent\)\) var\(--table-band-strength, 10%\), transparent\)/)
    // A shadow, never a background: the fill and the frozen cell's opaque base stay as they are.
    expect(BAND![2]).not.toMatch(/background/)
  })

  it('reaches every cell of the data rows, never a group header, and nothing when Row band is Off', () => {
    // The text before the rule holds its comment: the selector is what follows the comment.
    const selector = BAND![1].split('*/').pop()!.replace(':hover', '').trim()
    for (const band of ['all', 'calendar'] as const) {
      const el = mount(band)
      const dataCells = el.querySelectorAll('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer):not(.view-table__new) > td')
      expect(dataCells.length).toBeGreaterThan(0)
      // From the document: jsdom misses an `.app` ancestor when the query starts at `.app` itself.
      expect(document.querySelectorAll(selector).length).toBe(dataCells.length)
      expect(el.querySelector('.view-table__group')?.matches(selector.replace(/ > td$/, ''))).toBe(false)
      act(() => root?.unmount())
      app?.remove()
    }
    mount('off')
    expect(document.querySelectorAll(selector)).toHaveLength(0)
    act(() => root?.unmount())
    app?.remove()
    // "Rows the band marks: the caret's row" leaves out the mouse's row, as in the table block.
    mount('all', 'caret')
    expect(document.querySelectorAll(selector)).toHaveLength(0)
    act(() => root?.unmount())
    app?.remove()
    // Settings › Folder pages › Row band on hover (YAZ-4585): its own switch beats the table block's either way.
    mount('off', 'both', true)
    expect(document.querySelectorAll(selector).length).toBeGreaterThan(0)
    act(() => root?.unmount())
    app?.remove()
    mount('all', 'both', false)
    expect(document.querySelectorAll(selector)).toHaveLength(0)
  })
})
