import { describe, expect, it } from 'vitest'
import { recentlyClosed } from './recentlyClosed'

describe('recentlyClosed (YAZ-3487 D8, D10)', () => {
  it('S31, S40: every vault\'s closed notes, merged, the newest first, each with when it closed', () => {
    const records: { closed: Record<string, number> }[] = [{ closed: { '/v/a.md': 10, '/v/b.md': 30 } }, { closed: { '/w/x.md': 20 } }]
    expect(recentlyClosed(records, new Set())).toEqual([
      { path: '/v/b.md', last: 30 },
      { path: '/w/x.md', last: 20 },
      { path: '/v/a.md', last: 10 },
    ])
  })

  it('S35 to S37: a note a tab shows now is left out', () => {
    expect(recentlyClosed([{ closed: { '/v/a.md': 10, '/v/b.md': 30 } }], new Set(['/v/b.md']))).toEqual([{ path: '/v/a.md', last: 10 }])
  })

  it('S41: no closed note, no row', () => {
    expect(recentlyClosed([{ closed: {} }], new Set())).toEqual([])
  })
})
