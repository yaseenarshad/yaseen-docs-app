import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { cardTextVars } from './cardText'

describe('YAZ-5387: Card text size and Card title size as variables on `.app`', () => {
  it('the default: no card text size (Same as pages), the title at Medium, 1.125× the card text', () => {
    expect(cardTextVars(DEFAULT_SETTINGS)).toEqual({ '--card-title-scale': 1.125 })
  })
  it('Custom sets its px; each title step its scale', () => {
    expect(cardTextVars({ ...DEFAULT_SETTINGS, cardTextSize: 20, cardTitleSize: 'small' })).toEqual({ '--card-text-size': '20px', '--card-title-scale': 1 })
    expect(cardTextVars({ ...DEFAULT_SETTINGS, cardTitleSize: 'large' })['--card-title-scale']).toBe(1.375)
  })
  it('a main process older than the fields (absent) or a wrong value reads the defaults, never "undefinedpx"', () => {
    const { cardTextSize: _s, cardTitleSize: _t, ...old } = DEFAULT_SETTINGS
    expect(cardTextVars(old as SettingsState)).toEqual({ '--card-title-scale': 1.125 })
    expect(cardTextVars({ ...DEFAULT_SETTINGS, cardTextSize: 99, cardTitleSize: 'huge' as never })).toEqual({ '--card-title-scale': 1.125 })
  })
})
