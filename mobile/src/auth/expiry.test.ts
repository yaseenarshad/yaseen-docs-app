import { describe, expect, it } from 'vitest'
import { EXPIRY_HEADER, WARN_DAYS, parseEndDate, readTokenEnd, tokenEndWarning } from './expiry'

const DAY = 86_400_000

describe("the token's end date (round 10, item 18)", () => {
  it('reads the end date from the header that GitHub sends with a token that ends', () => {
    const headers = new Headers({ [EXPIRY_HEADER]: '2026-12-31 00:00:00 UTC' })
    expect(readTokenEnd(headers)).toBe('2026-12-31T00:00:00.000Z')
  })

  it('reads the other forms GitHub and the Mac can write', () => {
    expect(parseEndDate('2026-12-31 10:20:30 +0000')).toBe('2026-12-31T10:20:30.000Z')
    expect(parseEndDate('2026-12-31 10:20:30 -0500')).toBe('2026-12-31T15:20:30.000Z')
    expect(parseEndDate('2026-12-31T10:20:30Z')).toBe('2026-12-31T10:20:30.000Z')
    expect(parseEndDate('2026-12-31')).toBe('2026-12-31T00:00:00.000Z')
  })

  it('no header (a token with no end date, or a browser that hides the header): null', () => {
    expect(readTokenEnd(new Headers())).toBeNull()
    expect(parseEndDate('soon')).toBeNull()
    expect(parseEndDate('2026-13-45 00:00:00 UTC')).toBeNull()
  })

  it(`warns ${WARN_DAYS} days before the end, says ended after it, and says nothing before or with no date`, () => {
    const end = '2026-12-31T00:00:00.000Z'
    const at = Date.parse(end)
    expect(tokenEndWarning(null, at)).toEqual({ kind: 'none' })
    expect(tokenEndWarning(end, at - (WARN_DAYS + 1) * DAY)).toEqual({ kind: 'none' })
    expect(tokenEndWarning(end, at - WARN_DAYS * DAY)).toEqual({ kind: 'soon', endsAt: end, daysLeft: WARN_DAYS })
    expect(tokenEndWarning(end, at - DAY / 2)).toEqual({ kind: 'soon', endsAt: end, daysLeft: 1 })
    expect(tokenEndWarning(end, at)).toEqual({ kind: 'ended', endsAt: end })
  })
})
