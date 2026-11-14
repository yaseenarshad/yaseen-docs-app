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
  it('YAZ-5133: settings from a main process older than a card field (no `cardBulletSpace`, the app not restarted) give the field\'s Custom start, never "undefinedpx": an invalid variable empties the list rows\' padding, and the markers sit on the text', () => {
    const { cardBulletSpace: _gone, ...old } = { ...DEFAULT_SETTINGS, cardSpacing: 'custom' as const, cardLineSpacing: 1.15, cardBlockGap: 4 }
    const vars = cardSpacingVars(old as typeof DEFAULT_SETTINGS)
    expect(vars).toEqual({ '--card-line-height': 1.15, '--card-block-gap': '4px', '--card-bullet-indent': '34px', '--card-bullet-gap': '10px', '--card-bullet-space': '0px' })
    for (const v of Object.values(vars)) expect(String(v)).not.toMatch(/undefined|NaN|null/)
    // Every field missing, or not a number: Custom's start for each.
    const bare = { ...DEFAULT_SETTINGS, cardSpacing: 'custom' as const, cardLineSpacing: undefined, cardBlockGap: 'x', cardBulletIndent: null, cardBulletGap: Number.NaN, cardBulletSpace: undefined } as unknown as typeof DEFAULT_SETTINGS
    expect(cardSpacingVars(bare)).toEqual({ '--card-line-height': 1.5, '--card-block-gap': '8px', '--card-bullet-indent': '34px', '--card-bullet-gap': '10px', '--card-bullet-space': '0px' })
  })
})
