/**
 * YAZ-5647 item 2: a bare number on a card line that a double cannot hold (not finite, or not exact) reads as text,
 * its bytes unchanged, so the property shows what the line says and no write changes or drops it. Made-up data only.
 */
import { describe, expect, it } from 'vitest'
import { cardPropertiesOf, formatCardLine, parseCardLine, withCardReview } from '@shared/cardLine'

const props = (body: string) => cardPropertiesOf(parseCardLine(`<!-- card: GEO-1, ${body} -->`)!)
const afterAnswer = (line: string): string => formatCardLine(withCardReview(parseCardLine(line)!, { at: '2026-11-15T10:00Z', rating: 'good' }))!

describe('a card line number a double cannot hold reads as text (YAZ-5647 item 2)', () => {
  it('a number too large for a double (`1e400`, `-1e400`) reads as its text, not Infinity', () => {
    expect(props('size 1e400')).toEqual({ size: '1e400' })
    expect(props('size -1e400')).toEqual({ size: '-1e400' })
  })

  it('a whole number beyond 2^53 that a double changes reads as its digits', () => {
    expect(props('code 12345678901234567890')).toEqual({ code: '12345678901234567890' })
    expect(props('code 9007199254740993')).toEqual({ code: '9007199254740993' })
  })

  it('a decimal with more digits than a double keeps reads as text; in a list too', () => {
    expect(props('pi 3.14159265358979323846')).toEqual({ pi: '3.14159265358979323846' })
    expect(props('xs 1 1e400 "a"')).toEqual({ xs: [1, '1e400', 'a'] })
  })

  it('a number a double holds exactly stays a number, in any of its forms', () => {
    expect(props('a 3, b -2.5, c 2.50, d 1e-7, e 1e+21, f 1E5, g 9007199254740992, h 0.1, i -0, j 1.2345678901234568e+21')).toEqual({
      a: 3, b: -2.5, c: 2.5, d: 1e-7, e: 1e21, f: 1e5, g: 9007199254740992, h: 0.1, i: -0, j: 1.2345678901234568e21,
    })
  })

  it('an answer writes such a part back byte for byte, and it is still a property', () => {
    for (const part of ['size 1e400', 'code 12345678901234567890', 'pi 3.14159265358979323846']) {
      const next = afterAnswer(`<!-- card: GEO-1, ${part} -->`)
      expect(next).toContain(`, ${part},`)
      expect(next).not.toContain('Infinity')
      expect(Object.keys(cardPropertiesOf(parseCardLine(next)!))).toEqual([part.split(' ')[0]])
    }
  })
})
