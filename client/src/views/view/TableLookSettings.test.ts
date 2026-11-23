/**
 * A folder table's header row writer (YAZ-4794): the View tab's and the column header's "Header row ›" one door.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_HEADER_ROW } from '@shared/types'
import { setHeaderRowSetting } from '../../editor/table/timeFormatSetting'
import type { ViewDef } from '../viewSchema'
import { plainHeaderRow, setHeaderRowPart, shownHeaderRow, toggleHeaderRowPlain } from './TableLookSettings'

const table = (parts: Partial<ViewDef> = {}): ViewDef => ({ type: 'table', name: 'T', ...parts }) as ViewDef

afterEach(() => setHeaderRowSetting(DEFAULT_HEADER_ROW))

describe('setHeaderRowPart (YAZ-4794)', () => {
  it('a text colour and an align become the view own parts; a pick equal to Settings removes the part, and the last one the key', () => {
    const view = table()
    setHeaderRowPart(view, 'text', 'blue')
    setHeaderRowPart(view, 'align', 'center')
    expect(view.headerRow).toEqual({ text: 'blue', align: 'center' })
    expect(shownHeaderRow(view)).toEqual({ ...DEFAULT_HEADER_ROW, text: 'blue', align: 'center' })
    setHeaderRowPart(view, 'align', 'follow')
    setHeaderRowPart(view, 'text', 'muted')
    expect(view.headerRow).toBeUndefined()
  })

  it('Settings with a text colour: no own text shows it, and picking it again saves nothing', () => {
    setHeaderRowSetting({ ...DEFAULT_HEADER_ROW, text: 'green', align: 'right' })
    const view = table({ headerRow: { text: 'full' } })
    expect(shownHeaderRow(table())).toMatchObject({ text: 'green', align: 'right' })
    setHeaderRowPart(view, 'text', 'green')
    expect(view.headerRow).toBeUndefined()
  })

  it('Plain sets Off, Regular and Full, keeps align, and a second pick hands the three back', () => {
    const view = table({ headerRow: { align: 'left' }, shadedHeader: true } as Partial<ViewDef>)
    toggleHeaderRowPlain(view)
    expect(view.headerRow).toEqual({ align: 'left', strength: 'off', weight: 'regular', text: 'full' })
    expect(plainHeaderRow(shownHeaderRow(view))).toBe(true)
    expect(view.shadedHeader).toBeUndefined()
    toggleHeaderRowPlain(view)
    expect(view.headerRow).toEqual({ align: 'left' })
  })
})
