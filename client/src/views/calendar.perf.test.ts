import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { budgetMs, timeMedian } from '../test-perf'
import { bucketByDay } from './calendar'
import type { Row } from './engine'
import { FileValue } from './expr'

describe('calendar perf (YAZ-4540)', () => {
  function row(i: number): Row {
    const day = String((i % 28) + 1).padStart(2, '0')
    // A mix the demo has: bare dates, times, a zone, and no date at all.
    const due = i % 10 === 0 ? undefined : i % 3 === 0 ? `2026-12-${day}T10:30Z` : i % 2 ? `2026-12-${day} 09:00` : `2026-12-${day}`
    const record: IndexRecord = {
      path: `/vault/Tasks/Note ${i}.md`,
      name: `Note ${i}.md`,
      basename: `Note ${i}`,
      title: `Note ${i}`,
      folder: 'Tasks',
      ext: 'md',
      size: 0,
      ctime: 0,
      mtime: 0,
      properties: due === undefined ? {} : { due },
      aliases: [],
      tags: [],
      links: [],
      embeds: [],
    }
    return { record, file: new FileValue(record), values: {} }
  }

  it('buckets 1000 records into days in under 16 ms', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row(i))
    bucketByDay(rows, 'due') // warm up
    const { median, worst, result } = timeMedian(9, () => bucketByDay(rows, 'due'))
    console.log(`calendar bucket 1000: median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`)
    expect(result.undated).toHaveLength(100)
    expect([...result.days.values()].reduce((n, d) => n + d.length, 0)).toBe(900)
    expect(median).toBeLessThan(budgetMs(16))
  })
})
