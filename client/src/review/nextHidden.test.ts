/** Settings › Review › Mark the next hidden word (YAZ-5053 round 3): what App puts on `.app`. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { nextHiddenAttrs, nextHiddenVars } from './nextHidden'

describe('mark the next hidden word', () => {
  it('On (the default): the attribute; the default colour is the theme\'s token, so no variable', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ markNextHidden: true, nextHiddenColour: null })
    expect(nextHiddenAttrs(DEFAULT_SETTINGS)).toEqual({ 'data-mark-next-hidden': '' })
    expect(nextHiddenVars(DEFAULT_SETTINGS)).toEqual({})
  })
  it('a picked colour is the variable, in light and dark alike', () => {
    expect(nextHiddenVars({ ...DEFAULT_SETTINGS, nextHiddenColour: '#aa3399' })).toEqual({ '--next-hidden': '#aa3399' })
  })
  it('Off: nothing on `.app`, so no word is marked', () => {
    const off = { ...DEFAULT_SETTINGS, markNextHidden: false, nextHiddenColour: '#aa3399' }
    expect(nextHiddenAttrs(off)).toEqual({})
    expect(nextHiddenVars(off)).toEqual({})
  })
  it('settings from a main process older than these fields (the app not restarted): On, in the default colour', () => {
    const { markNextHidden: _a, nextHiddenColour: _b, ...old } = DEFAULT_SETTINGS
    expect(nextHiddenAttrs(old as typeof DEFAULT_SETTINGS)).toEqual({ 'data-mark-next-hidden': '' })
    expect(nextHiddenVars(old as typeof DEFAULT_SETTINGS)).toEqual({})
  })
})
