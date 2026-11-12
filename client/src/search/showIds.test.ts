/** "Show IDs in search" (YAZ-4940): the vault file's shape, and which ID a row shows under each rule. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SHOW_IDS, sanitizeShowIds, shownId } from './showIds'

describe('Show IDs in search', () => {
  it('reads the vault file; Always is the default, and anything else reads as Always', () => {
    expect(DEFAULT_SHOW_IDS).toEqual({ search: 'always' })
    expect(sanitizeShowIds({ search: 'match' })).toEqual({ search: 'match' })
    expect(sanitizeShowIds({ search: 'always' })).toEqual({ search: 'always' })
    expect(sanitizeShowIds({ search: 'sometimes' })).toEqual({ search: 'always' })
    expect(sanitizeShowIds(null)).toEqual({ search: 'always' })
  })

  it('a row shows its ID always, or only when the search found it by its ID (`searchRows` put "ID — " in front of its label); a row with no ID shows none', () => {
    const byTitle = { id: 'WIKI-38', label: 'S3 (AWS)' }
    const byId = { id: 'WIKI-38', label: 'WIKI-38 — S3 (AWS)' }
    expect(shownId(byTitle, 'always')).toBe('WIKI-38')
    expect(shownId(byTitle, 'match')).toBeNull()
    expect(shownId(byId, 'always')).toBe('WIKI-38')
    expect(shownId(byId, 'match')).toBe('WIKI-38')
    expect(shownId({ label: 'Plain' }, 'always')).toBeNull()
  })
})
