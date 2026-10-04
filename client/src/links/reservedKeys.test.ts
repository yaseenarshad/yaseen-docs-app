import { describe, expect, it } from 'vitest'
import { REVIEW_KEY, REVIEWS_KEY } from '@shared/reviews'
import { RESERVED_KEYS } from './reservedKeys'

describe('reserved keys: review (YAZ-2322)', () => {
  it('the review log is Reserved: the panel shows it with no editor', () => {
    expect(RESERVED_KEYS.has(REVIEWS_KEY)).toBe(true)
  })

  it('the on/off flag is an ordinary property, the user\'s to edit', () => {
    expect(RESERVED_KEYS.has(REVIEW_KEY)).toBe(false)
  })
})
