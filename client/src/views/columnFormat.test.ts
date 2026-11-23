/**
 * Number and date formats (YAZ-4591 S21/S22): what a cell shows for each format, the tolerant reader
 * that keeps a bad format from costing its column, and the kind switch that drops a format the new
 * kind has no use for.
 */
import { describe, expect, it } from 'vitest'
import { formatCustomDate, formatDateValue, formatFits, formatNumber, propertyFormatOf, readFormat, setPropertyFormat } from './columnFormat'
import type { ViewSet } from './viewSchema'
import { folderSettings } from './folderSettings'
import { declarationForKind } from './view/declarationForKind'
import type { IndexRecord } from '@shared/types'

const settingsWith = (columns: Record<string, unknown>) =>
  folderSettings({ path: '/v/.folder.md', properties: { folder_settings: { columns } } } as unknown as IndexRecord, true)

describe('S21: number formats', () => {
  it.each([
    [{ style: 'plain' as const }, 1234.5, '1234.5'],
    [{ style: 'plain' as const, decimals: 2 }, 1234.5, '1234.50'],
    [{ style: 'grouped' as const }, 1234567, '1,234,567'],
    [{ style: 'grouped' as const, decimals: 0 }, 1234.56, '1,235'],
    [{ style: 'currency' as const, currency: 'USD' }, 1234.5, '$1,234.50'],
    [{ style: 'currency' as const, currency: 'EUR', decimals: 0 }, 99.6, '€100'],
    [{ style: 'currency' as const }, 3, '$3.00'],
    [{ style: 'percent' as const }, 0.25, '25%'],
    [{ style: 'percent' as const, decimals: 1 }, 0.1234, '12.3%'],
    [{ style: 'grouped' as const, decimals: 4 }, 1.5, '1.5000'],
  ])('%j shows %s as %s', (format, n, shown) => {
    expect(formatNumber(n, format)).toBe(shown)
  })
})

describe('S22: date formats', () => {
  const now = new Date(2026, 10, 7, 12, 0).getTime()
  const day = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime()

  it('ISO is the caller’s own rendering, as before', () => {
    expect(formatDateValue(day(7), false, { style: 'iso' }, now)).toBeNull()
  })

  it('"Nov 7, 2026", with the time when the value has one', () => {
    expect(formatDateValue(day(7), false, { style: 'medium' }, now)).toBe('Nov 7, 2026')
    expect(formatDateValue(day(7, 15, 30), true, { style: 'medium' }, now)).toMatch(/^Nov 7, 2026, 3:30\sPM$/)
  })

  it.each([
    [day(7), false, 'today'],
    [day(8), false, 'tomorrow'],
    [day(6), false, 'yesterday'],
    [day(10), false, 'in 3 days'],
    [day(2), false, '5 days ago'],
    [day(21), false, 'in 2 weeks'],
    [day(7, 15), true, 'in 3 hours'],
    [day(6, 23), true, 'yesterday'],
  ])('relative: %s (time %s) reads "%s"', (ms, hasTime, shown) => {
    expect(formatDateValue(ms, hasTime, { style: 'relative' }, now)).toBe(shown)
  })

  it('YAZ-6167: custom date patterns support all tokens and [literal] escapes', () => {
    // 2026-11-07 is a Saturday
    const pm = new Date(2026, 10, 7, 15, 5, 9).getTime()
    const midnight = new Date(2026, 0, 5, 0, 7, 0).getTime()
    const noon = new Date(2026, 6, 4, 12, 30, 45).getTime()
    expect(formatCustomDate(pm, 'ddd MMM D')).toBe('Sat Nov 7')
    expect(formatCustomDate(pm, 'dddd, MMMM DD, YYYY (YY)')).toBe('Saturday, November 07, 2026 (26)')
    expect(formatCustomDate(pm, 'M/D/YY HH:mm:ss')).toBe('11/7/26 15:05:09')
    expect(formatCustomDate(pm, 'H:mm h:mm A hh:mm a')).toBe('15:05 3:05 PM 03:05 pm')
    expect(formatCustomDate(midnight, 'YYYY-MM-DD hh:mm A H:mm')).toBe('2026-01-05 12:07 AM 0:07')
    expect(formatCustomDate(noon, 'h:mm:ss a')).toBe('12:30:45 pm')
    expect(formatCustomDate(pm, '[Created on] ddd MMM D [at] h:mm A')).toBe('Created on Sat Nov 7 at 3:05 PM')
    expect(formatDateValue(pm, false, { style: 'custom', pattern: 'ddd MMM D' }, now)).toBe('Sat Nov 7')
    // Missing or empty pattern falls back to null (ISO rendering).
    expect(formatDateValue(pm, false, { style: 'custom' }, now)).toBeNull()
    expect(formatDateValue(pm, false, { style: 'custom', pattern: '   ' }, now)).toBeNull()
    // Capped pattern cache handles >64 distinct patterns cleanly.
    for (let i = 0; i < 80; i++) expect(formatCustomDate(pm, `[p${i}] YYYY`)).toBe(`p${i} 2026`)
  })
})

describe('the declaration', () => {
  it('readColumns keeps a good format', () => {
    const s = settingsWith({
      amount: { kind: 'number', format: { style: 'currency', currency: 'GBP', decimals: 2 } },
      due: { kind: 'date', format: { style: 'relative' } },
    })
    expect(s.columns.amount).toEqual({ kind: 'number', format: { style: 'currency', currency: 'GBP', decimals: 2 } })
    expect(s.columns.due).toEqual({ kind: 'date', format: { style: 'relative' } })
    expect(s.problems).toEqual([])
  })

  it('a bad format costs the format, or only its bad part, never the column', () => {
    const s = settingsWith({
      a: { kind: 'number', format: { style: 'relative' } },
      b: { kind: 'number', format: { style: 'grouped', decimals: 9 } },
      c: { kind: 'date', format: { style: 'medium', decimals: 2 } },
      d: { kind: 'number', format: { style: 'grouped', currency: 'USD' } },
      e: { kind: 'text', format: { style: 'plain' } },
    })
    expect(s.columns).toEqual({
      a: { kind: 'number' },
      b: { kind: 'number', format: { style: 'grouped' } },
      c: { kind: 'date', format: { style: 'medium' } },
      d: { kind: 'number', format: { style: 'grouped' } },
      e: { kind: 'text' },
    })
    expect(s.problems).toHaveLength(5)
  })

  it('readFormat refuses a lower-case currency code', () => {
    const problems: string[] = []
    expect(readFormat('number', { style: 'currency', currency: 'usd' }, problems, 'x')).toEqual({ style: 'currency' })
    expect(problems).toHaveLength(1)
  })

  it('a kind switch drops a format the new kind does not have, and keeps one it does', () => {
    expect(declarationForKind({ kind: 'number', format: { style: 'grouped' } }, 'date')).toEqual({ kind: 'date' })
    expect(declarationForKind({ kind: 'number', format: { style: 'grouped' } }, 'link')).toEqual({ kind: 'link' })
    expect(declarationForKind({ kind: 'date', format: { style: 'medium' } }, 'date')).toEqual({ kind: 'date', format: { style: 'medium' } })
    expect(formatFits('number', { style: 'percent' })).toBe(true)
    expect(formatFits('date', { style: 'custom', pattern: 'ddd MMM D' })).toBe(true)
  })

  it('YAZ-6167: readFormat validates custom date pattern and folderSettings reads properties[key].format', () => {
    const problems: string[] = []
    expect(readFormat('date', { style: 'custom', pattern: 'ddd MMM D' }, problems, 'x')).toEqual({ style: 'custom', pattern: 'ddd MMM D' })
    expect(problems).toEqual([])
    expect(readFormat('date', { style: 'custom', pattern: '' }, problems, 'x')).toEqual({ style: 'custom' })
    expect(readFormat('date', { style: 'custom', pattern: 'Y'.repeat(65) }, problems, 'x')).toEqual({ style: 'custom' })
    expect(readFormat('date', { style: 'medium', pattern: 'YYYY' }, problems, 'x')).toEqual({ style: 'medium' })
    expect(problems).toHaveLength(3)

    const s = folderSettings(
      {
        path: '/v/.folder.md',
        properties: {
          folder_settings: {
            properties: {
              'file.ctime': { displayName: 'Added', format: { style: 'custom', pattern: 'ddd MMM D' } },
              'file.mtime': { format: { style: 'relative' } },
              'card.created': { displayName: 'Born', format: { style: 'bogus' } },
            },
          },
        },
      } as unknown as IndexRecord,
      true,
    )
    expect(s.properties).toEqual({
      'file.ctime': { displayName: 'Added', format: { style: 'custom', pattern: 'ddd MMM D' } },
      'file.mtime': { format: { style: 'relative' } },
      'card.created': { displayName: 'Born' },
    })
    expect(s.problems).toHaveLength(1)

    const def: ViewSet = { views: [{ type: 'table', name: 'T' }], properties: { 'file.ctime': { displayName: 'Added' } } }
    setPropertyFormat(def, 'file.ctime', { style: 'custom', pattern: 'ddd MMM D' })
    expect(propertyFormatOf(def.properties, 'file.ctime')).toEqual({ style: 'custom', pattern: 'ddd MMM D' })
    expect(def.properties?.['file.ctime']?.displayName).toBe('Added')
    setPropertyFormat(def, 'file.ctime', { style: 'iso' })
    expect(def.properties).toEqual({ 'file.ctime': { displayName: 'Added' } })
    delete def.properties!['file.ctime'].displayName
    setPropertyFormat(def, 'file.ctime', undefined)
    expect(def.properties).toBeUndefined()
  })
})
