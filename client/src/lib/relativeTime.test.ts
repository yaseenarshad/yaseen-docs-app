import { describe, expect, it } from 'vitest'
import { relativeTime, shortRelativeTime } from './relativeTime'

const NOW = 1_800_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('shortRelativeTime', () => {
  it('S1 to S3 (YAZ-2740 D1): "now" under a minute and for a time in the future, then the largest whole unit in a few letters, at the limits of each unit', () => {
    const limits: Array<[ago: number, text: string]> = [
      [0, 'now'],
      [59_999, 'now'],
      [-HOUR, 'now'], // the clock changed
      [MINUTE, '1m'],
      [59 * MINUTE, '59m'],
      [60 * MINUTE, '1h'],
      [23 * HOUR, '23h'],
      [24 * HOUR, '1d'],
      [6 * DAY, '6d'],
      [7 * DAY, '1w'],
      [29 * DAY, '4w'],
      [30 * DAY, '1mo'],
      [364 * DAY, '12mo'],
      [365 * DAY, '1y'],
      [800 * DAY, '2y'],
    ]
    expect(limits.map(([ago]) => shortRelativeTime(NOW - ago, NOW))).toEqual(limits.map(([, text]) => text))
    // S5: the Welcome screen and the comment stream keep the words.
    expect(relativeTime(NOW - 2 * HOUR, NOW)).toBe('2 hours ago')
  })
})
