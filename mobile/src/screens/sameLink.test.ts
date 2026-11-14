import { describe, expect, it } from 'vitest'
import type { ReviewLink } from '../review/link'
import { sameLink } from './Review'

/** YAZ-5224 (the checker's M2): a new link object with the same engine, list, store and media keeps the session. */
describe('sameLink', () => {
  const parts = { engine: {}, answers: {}, store: {} } as unknown as ReviewLink
  it('the same parts in a new object are the same link; a changed part, or none, is not', () => {
    expect(sameLink(parts, { ...parts })).toBe(true)
    expect(sameLink(null, null)).toBe(true)
    expect(sameLink(parts, { ...parts, answers: {} as ReviewLink['answers'] })).toBe(false)
    expect(sameLink(parts, { ...parts, engine: {} as ReviewLink['engine'] })).toBe(false)
    expect(sameLink(parts, null)).toBe(false)
  })
})
