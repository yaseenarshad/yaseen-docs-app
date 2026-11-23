import { describe, expect, it } from 'vitest'
import { indexRecord, type IndexRecordMeta } from '@shared/indexRecord'
import { CREATED_KEY, parseCreatedMs } from '@shared/pageCreated'

const META: IndexRecordMeta = {
  path: '/v/note.md',
  name: 'note.md',
  basename: 'note',
  folder: '',
  ext: 'md',
  size: 100,
  ctime: 1_700_000_000_000,
  mtime: 1_700_000_005_000,
}

describe('parseCreatedMs (YAZ-6165)', () => {
  it('parses full UTC ISO timestamps, offsets, seconds-free ISO, and space separators', () => {
    expect(parseCreatedMs('2026-11-21T16:05:31.204Z')).toBe(Date.UTC(2026, 10, 21, 16, 5, 31, 204))
    expect(parseCreatedMs('2026-11-21T16:05:31Z')).toBe(Date.UTC(2026, 10, 21, 16, 5, 31))
    expect(parseCreatedMs('2026-11-21T16:05Z')).toBe(Date.UTC(2026, 10, 21, 16, 5, 0))
    expect(parseCreatedMs('2026-11-21T18:05:31+02:00')).toBe(Date.UTC(2026, 10, 21, 16, 5, 31))
    expect(parseCreatedMs('2026-11-21 16:05:31.204Z')).toBe(Date.UTC(2026, 10, 21, 16, 5, 31, 204))
    expect(parseCreatedMs('  2026-11-21T16:05:31.204Z  ')).toBe(Date.UTC(2026, 10, 21, 16, 5, 31, 204))
  })

  it('parses YYYY-MM-DD dates as local midnight and Date objects', () => {
    expect(parseCreatedMs('2026-11-21')).toBe(new Date(2026, 10, 21).getTime())
    expect(parseCreatedMs('2024-02-29')).toBe(new Date(2024, 1, 29).getTime())
    const ms = parseCreatedMs('2025-09-12')!
    const local = new Date(ms)
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate()]).toEqual([2025, 9, 12])
    const d = new Date(Date.UTC(2026, 5, 15, 10, 20, 30, 400))
    expect(parseCreatedMs(d)).toBe(d.getTime())
  })

  it('rejects impossible calendar days, invalid strings, NaN Dates, and non-date types', () => {
    for (const bad of [
      '2026-02-30',
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-02-30T12:00:00.000Z',
      'not-a-date',
      '',
      '   ',
      new Date(Number.NaN),
      null,
      undefined,
      123456,
      true,
      {},
      [],
    ]) {
      expect(parseCreatedMs(bad), `expected null for ${String(bad)}`).toBeNull()
    }
  })
})

describe('indexRecord created -> ctime (YAZ-6165)', () => {
  it('overrides meta.ctime with frontmatter `created:` when valid', () => {
    const rec = indexRecord(META, `---\n${CREATED_KEY}: 2025-03-10T08:15:30.500Z\n---\nHello\n`)
    expect(rec.ctime).toBe(Date.UTC(2025, 2, 10, 8, 15, 30, 500))
  })

  it('accepts date-only frontmatter `created:` as local midnight', () => {
    const rec = indexRecord(META, `---\n${CREATED_KEY}: 2025-09-12\n---\nHello\n`)
    expect(rec.ctime).toBe(new Date(2025, 8, 12).getTime())
    const local = new Date(rec.ctime)
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate()]).toEqual([2025, 9, 12])
  })

  it('accepts date-only card line `created YYYY-MM-DD` as local midnight on card files', () => {
    const rec = indexRecord(META, '---\nkind: card\n---\n```card\nQ\n---\nA\n```\n<!-- card: YAZ-1, created 2025-09-12 -->\n')
    expect(rec.kind).toBe('card')
    expect(rec.ctime).toBe(new Date(2025, 8, 12).getTime())
    const local = new Date(rec.ctime)
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate()]).toEqual([2025, 9, 12])
  })

  it('falls back to meta.ctime when `created:` is absent or invalid', () => {
    expect(indexRecord(META, '---\ntitle: Plain\n---\n').ctime).toBe(META.ctime)
    expect(indexRecord(META, '---\ncreated: 2026-02-30\n---\n').ctime).toBe(META.ctime)
    expect(indexRecord(META, null).ctime).toBe(META.ctime)
  })

  it('for card files, falls back to frontmatter `created:` then `meta.ctime` when card line has no created', () => {
    const withFm = indexRecord(META, '---\nkind: card\ncreated: 2025-04-01T12:00:00.000Z\n---\n```card\nQ\n---\nA\n```\n<!-- card: YAZ-1 -->\n')
    expect(withFm.kind).toBe('card')
    expect(withFm.ctime).toBe(Date.UTC(2025, 3, 1, 12, 0, 0))

    const withoutFm = indexRecord(META, '---\nkind: card\n---\n```card\nQ\n---\nA\n```\n<!-- card: YAZ-1 -->\n')
    expect(withoutFm.ctime).toBe(META.ctime)
  })
})
