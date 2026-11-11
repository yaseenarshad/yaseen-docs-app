import { describe, expect, it } from 'vitest'
import { cellRange, indicesOf, inSelection, parseTsv, pickLine, toTsv, valueFromText } from './tableSelection'

describe('the folder table selection (YAZ-4593)', () => {
  it('a range is the rectangle between two cells, either way round; one cell is no selection', () => {
    const sel = cellRange({ r: 3, c: 2 }, { r: 1, c: 0 })!
    expect(indicesOf(sel.rows, 10)).toEqual([1, 2, 3])
    expect(indicesOf(sel.cols, 10)).toEqual([0, 1, 2])
    expect(inSelection(sel, 2, 1)).toBe(true)
    expect(inSelection(sel, 4, 1)).toBe(false)
    expect(cellRange({ r: 1, c: 1 }, { r: 1, c: 1 })).toBeNull()
  })

  it('rows: plain picks one, ⇧ extends from the anchor, ⌘ adds or removes one', () => {
    let sel = pickLine(null, 'rows', 2, 'plain')
    expect(indicesOf(sel!.rows, 10)).toEqual([2])
    sel = pickLine(sel, 'rows', 5, 'shift')
    expect(indicesOf(sel!.rows, 10)).toEqual([2, 3, 4, 5])
    sel = pickLine(sel, 'rows', 0, 'shift')
    expect(indicesOf(sel!.rows, 10)).toEqual([0, 1, 2])
    sel = pickLine(sel, 'rows', 1, 'meta')
    expect(indicesOf(sel!.rows, 10)).toEqual([0, 2])
    expect(sel!.cols).toBeNull()
    expect(pickLine(pickLine(null, 'rows', 4, 'plain'), 'rows', 4, 'meta')).toBeNull()
  })

  it('columns: the same rules, every row', () => {
    let sel = pickLine(null, 'cols', 1, 'shift')
    expect(indicesOf(sel!.cols, 5)).toEqual([1])
    sel = pickLine(sel, 'cols', 3, 'shift')
    expect(indicesOf(sel!.cols, 5)).toEqual([1, 2, 3])
    sel = pickLine(sel, 'cols', 0, 'meta')
    expect(indicesOf(sel!.cols, 5)).toEqual([0, 1, 2, 3])
    expect(sel!.rows).toBeNull()
    expect(indicesOf(sel!.rows, 3)).toEqual([0, 1, 2])
  })

  it('tab-separated text out and in', () => {
    expect(toTsv([['a', 'b\tc'], ['d\ne', '']])).toBe('a\tb c\nd e\t')
    expect(parseTsv('1\t2\r\n3\t4\n')).toEqual([['1', '2'], ['3', '4']])
    expect(parseTsv('one')).toEqual([['one']])
  })

  it('a text becomes a value of the cell kind; a text that is no such value is skipped', () => {
    expect(valueFromText(' 1,234.5 ', 'number')).toBe(1234.5)
    expect(valueFromText('abc', 'number')).toBeUndefined()
    expect(valueFromText('yes', 'checkbox')).toBe(true)
    expect(valueFromText('FALSE', 'checkbox')).toBe(false)
    expect(valueFromText('maybe', 'checkbox')).toBeUndefined()
    expect(valueFromText('a, b,, c', 'multi-select')).toEqual(['a', 'b', 'c'])
    expect(valueFromText('2026-11-07', 'date')).toBe('2026-11-07')
    expect(valueFromText('  ', 'text')).toBeNull()
  })
})
