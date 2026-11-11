/**
 * Number and date formats (YAZ-4591 S21/S22): what a cell shows for each format, the tolerant reader
 * that keeps a bad format from costing its column, and the kind switch that drops a format the new
 * kind has no use for.
 */
import { describe, expect, it } from 'vitest'
import { formatDateValue, formatFits, formatNumber, readFormat } from './columnFormat'
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
  })
})
