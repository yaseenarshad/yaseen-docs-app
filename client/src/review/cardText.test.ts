import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { cardTextVars } from './cardText'

describe('YAZ-5387: Card text size and Card title size as variables on `.app`', () => {
  it('the defaults set none: the card reads its page, the title its card text × 1.125 (the CSS)', () => {
    expect(cardTextVars(DEFAULT_SETTINGS)).toEqual({})
  })
  it('round 2: each Custom sets its own px; the title px stands alone, not a step of the text', () => {
    expect(cardTextVars({ ...DEFAULT_SETTINGS, cardTextSize: 20, cardTitleSize: 14 })).toEqual({ '--card-text-size': '20px', '--card-title-size': '14px' })
    expect(cardTextVars({ ...DEFAULT_SETTINGS, cardTitleSize: 40 })).toEqual({ '--card-title-size': '40px' })
  })
  it('a main process older than the fields (absent), round 1\'s steps, or a wrong value read the defaults, never "undefinedpx"', () => {
    const { cardTextSize: _s, cardTitleSize: _t, ...old } = DEFAULT_SETTINGS
    expect(cardTextVars(old as SettingsState)).toEqual({})
    expect(cardTextVars({ ...DEFAULT_SETTINGS, cardTextSize: 99, cardTitleSize: 'large' as never })).toEqual({})
    expect(cardTextVars({ ...DEFAULT_SETTINGS, cardTitleSize: 41 })).toEqual({})
  })
})
