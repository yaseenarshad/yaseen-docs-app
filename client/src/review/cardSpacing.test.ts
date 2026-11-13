/** Settings › Review › Card spacing (YAZ-5050): Same as pages sets nothing (the card reads the pages' values); Custom sets the card's four. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { cardSpacingFromPages, cardSpacingVars } from './cardSpacing'

describe('card spacing', () => {
  it('Same as pages: no card variable, so the card falls back to the pages\' own', () => {
    expect(cardSpacingVars({ ...DEFAULT_SETTINGS, cardLineSpacing: 2 })).toEqual({})
  })
  it('Custom: the four card variables, in the pages\' units', () => {
    expect(cardSpacingVars({ ...DEFAULT_SETTINGS, cardSpacing: 'custom', cardLineSpacing: 2, cardBlockGap: 8, cardBulletIndent: 40, cardBulletGap: 12 })).toEqual({
      '--card-line-height': 2,
      '--card-block-gap': '8px',
      '--card-bullet-indent': '40px',
      '--card-bullet-gap': '12px',
    })
  })
  it('Custom starts from the pages\' values (an old settings file with no bullet values: their defaults)', () => {
    expect(cardSpacingFromPages({ ...DEFAULT_SETTINGS, lineSpacing: 1.15, blockGap: 2, noteBulletIndent: 30, noteBulletGap: 8 })).toEqual({ cardLineSpacing: 1.15, cardBlockGap: 2, cardBulletIndent: 30, cardBulletGap: 8 })
    expect(cardSpacingFromPages({ ...DEFAULT_SETTINGS, noteBulletIndent: undefined as never, noteBulletGap: undefined as never })).toMatchObject({ cardBulletIndent: 34, cardBulletGap: 10 })
  })
})
