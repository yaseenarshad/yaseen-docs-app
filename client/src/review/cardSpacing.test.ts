/** Settings › Review › Card spacing (YAZ-5050): Same as pages sets nothing (the card reads the pages' values); Custom sets the card's own five. */
import { describe, expect, it } from 'vitest'
import { CARD_SPACING_CUSTOM_START, DEFAULT_SETTINGS } from '@shared/types'
import { cardSpacingVars } from './cardSpacing'

describe('card spacing', () => {
  it('Same as pages: no card variable, so the card falls back to the pages\' own', () => {
    expect(cardSpacingVars({ ...DEFAULT_SETTINGS, cardLineSpacing: 2 })).toEqual({})
  })
  it('Custom: the five card variables, in the pages\' units', () => {
    expect(cardSpacingVars({ ...DEFAULT_SETTINGS, cardSpacing: 'custom', cardLineSpacing: 2, cardBlockGap: 8, cardBulletIndent: 40, cardBulletGap: 12, cardBulletSpace: 0 })).toEqual({
      '--card-line-height': 2,
      '--card-block-gap': '8px',
      '--card-bullet-indent': '40px',
      '--card-bullet-gap': '12px',
      '--card-bullet-space': '0px',
    })
  })
  it('round 3: Custom starts at Mochi\'s clean values (line spacing 1.5, 8 px between blocks, bullets close), not at the pages\' values', () => {
    expect(CARD_SPACING_CUSTOM_START).toEqual({ cardLineSpacing: 1.5, cardBlockGap: 8, cardBulletIndent: 34, cardBulletGap: 10, cardBulletSpace: 0 })
    // The settings file's defaults for the card's own values are the same start; the app's look does not change (Same as pages).
    expect(DEFAULT_SETTINGS).toMatchObject({ cardSpacing: 'pages', ...CARD_SPACING_CUSTOM_START })
    expect(DEFAULT_SETTINGS).toMatchObject({ lineSpacing: 1.5, blockGap: 4 })
  })
})
