/**
 * `view.columnAlign` (YAZ-3746 13Y): the one reader and the one writer behind the header menu's Text › Align items,
 * the column editor's Align row and the table's cells. A key in any spelling; a value that is not left / center /
 * right reads as Auto; Auto deletes the entry and an emptied map.
 */
import { describe, expect, it } from 'vitest'
import type { ViewDef } from '../viewSchema'
import { alignClass, columnAlignOf, setColumnAlign } from './columnAlign'

const view = (columnAlign?: unknown): ViewDef => ({ type: 'table', name: 'T', ...(columnAlign === undefined ? {} : { columnAlign }) }) as ViewDef

describe('columnAlignOf (13Y)', () => {
  it('no map, or no entry for the column, is Auto (null)', () => {
    expect(columnAlignOf(view(), 'note.status')).toBeNull()
    expect(columnAlignOf(view({ 'note.owner': 'center' }), 'note.status')).toBeNull()
  })

  it('reads the entry under the key in any spelling, for a key asked in any spelling', () => {
    expect(columnAlignOf(view({ status: 'center' }), 'note.status')).toBe('center')
    expect(columnAlignOf(view({ 'note.status': 'right' }), 'status')).toBe('right')
    expect(columnAlignOf(view({ 'file.name': 'left' }), 'file.name')).toBe('left')
  })

  it('a value that is not left / center / right, or a map that is not a map, reads as Auto', () => {
    expect(columnAlignOf(view({ 'note.status': 'middle' }), 'note.status')).toBeNull()
    expect(columnAlignOf(view({ 'note.status': true }), 'note.status')).toBeNull()
    expect(columnAlignOf(view('center'), 'note.status')).toBeNull()
    expect(columnAlignOf(view(null), 'note.status')).toBeNull()
  })
})

describe('setColumnAlign (13Y)', () => {
  it('writes the canonical key; a second pick replaces the entry in any spelling', () => {
    const v = view({ status: 'left', 'note.owner': 'right' })
    setColumnAlign(v, 'status', 'center')
    expect(v.columnAlign).toEqual({ 'note.owner': 'right', 'note.status': 'center' })
  })

  it('Auto removes the entry in any spelling, and the emptied map deletes itself', () => {
    const v = view({ status: 'left', 'note.owner': 'right' })
    setColumnAlign(v, 'note.status', null)
    expect(v.columnAlign).toEqual({ 'note.owner': 'right' })
    setColumnAlign(v, 'owner', null)
    expect('columnAlign' in v).toBe(false)
  })

  it('Auto on a view with no map writes nothing', () => {
    const v = view()
    setColumnAlign(v, 'note.status', null)
    expect('columnAlign' in v).toBe(false)
  })
})

describe('alignClass (13Y)', () => {
  it('names the cell class per alignment, and none for Auto', () => {
    expect(alignClass(null)).toBeUndefined()
    expect(alignClass('left')).toBe('view-table__cell--align-left')
    expect(alignClass('center')).toBe('view-table__cell--align-center')
    expect(alignClass('right')).toBe('view-table__cell--align-right')
  })
})
