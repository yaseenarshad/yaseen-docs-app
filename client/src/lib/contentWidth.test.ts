import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { columnMax, columnStart, contentTextWidth, contentWidthVars, tablePositionVars } from './contentWidth'

const vars = (over: Partial<SettingsState>) => contentWidthVars({ ...DEFAULT_SETTINGS, ...over })

describe('Content width and Card width (YAZ-5144)', () => {
  it('each Content width step is clearly wider than the one before: 640 px, 900 px, the window', () => {
    // Full is the window at every page zoom: the column grows with the zoom, from 50% (YAZ-5640).
    expect(['narrow', 'medium', 'full'].map((contentWidth) => vars({ contentWidth: contentWidth as SettingsState['contentWidth'] })['--content-text-width'])).toEqual(['640px', '900px', '200vw'])
    // The pages' column, sides in: what the table of contents makes room for. The text grows with the page zoom, the sides do not.
    expect([columnMax('narrow'), columnMax('medium'), columnMax('full')]).toEqual([736, 996, Infinity])
    expect([columnMax('narrow', 2), columnMax('medium', 0.5), columnMax('full', 0.5)]).toEqual([1280 + 96, 450 + 96, Infinity])
  })

  it('round 2: Card width Same as pages (null) follows Content width; Custom is its own px', () => {
    expect(vars({ contentWidth: 'medium', cardWidth: null })['--card-text-width']).toBe('900px')
    expect(vars({ contentWidth: 'full', cardWidth: null })['--card-text-width']).toBe('100vw')
    expect(vars({ contentWidth: 'full', cardWidth: 720 })['--card-text-width']).toBe('720px')
  })

  it('YAZ-5136 rounds 2 and 3: Table position Centre sets the pages\' variable; Card tables sets the cards\' only when not Same as pages', () => {
    const tp = (over: Partial<SettingsState>) => tablePositionVars({ ...DEFAULT_SETTINGS, ...over })
    expect(tp({})).toEqual({})
    expect(tp({ tablePosition: 'center' })).toEqual({ '--page-table-inline': 'auto' })
    expect(tp({ tablePosition: 'center', cardTablePosition: 'left' })).toEqual({ '--page-table-inline': 'auto', '--card-table-inline': '0' })
    expect(tp({ cardTablePosition: 'center' })).toEqual({ '--card-table-inline': 'auto' })
    // From a main process older than the fields: nothing, the look before.
    const { tablePosition: _a, cardTablePosition: _b, ...older } = DEFAULT_SETTINGS
    expect(tablePositionVars(older as SettingsState)).toEqual({})
  })

  it('a field a main process older than it did not send, or a value it would not take, reads the default', () => {
    const { cardWidth: _gone, ...older } = DEFAULT_SETTINGS
    expect(contentWidthVars({ ...older, contentWidth: 'medium' } as SettingsState)['--card-text-width']).toBe('900px')
    expect(vars({ contentWidth: 'wide' as never, cardWidth: 'narrow' as never })).toEqual({ '--content-text-width': '640px', '--card-text-width': '640px', '--column-start': 'auto' })
  })
})

describe('Custom px and Page position (YAZ-5871)', () => {
  it('D1: Custom px is the text width everywhere a step is: the column, a card that is Same as pages, the table of contents', () => {
    expect(vars({ contentWidth: 760 })).toMatchObject({ '--content-text-width': '760px', '--card-text-width': '760px' })
    expect(contentTextWidth(1200)).toBe('1200px')
    expect([columnMax(760), columnMax(760, 2)]).toEqual([856, 1616])
    // Out of range, not whole, or text: the default, Narrow.
    for (const bad of [399, 2401, 760.5, '760', 'wide']) expect(vars({ contentWidth: bad as never })['--content-text-width']).toBe('640px')
    expect([vars({ contentWidth: 400 })['--content-text-width'], vars({ contentWidth: 2400 })['--content-text-width']]).toEqual(['400px', '2400px'])
  })

  it('D2: `--column-start` is 0 for Left and auto for Centre; Full has no position; an unknown or missing value is Centre', () => {
    expect(vars({})['--column-start']).toBe('auto')
    expect(vars({ contentPosition: 'left' })['--column-start']).toBe('0')
    expect(vars({ contentPosition: 'left', contentWidth: 900 })['--column-start']).toBe('0')
    expect(vars({ contentPosition: 'left', contentWidth: 'full' })['--column-start']).toBe('auto')
    expect(vars({ contentPosition: 'right' as never })['--column-start']).toBe('auto')
    const { contentPosition: _gone, ...older } = DEFAULT_SETTINGS
    expect(contentWidthVars(older as SettingsState)['--column-start']).toBe('auto')
    expect([columnStart('left', 'medium'), columnStart('center', 'narrow'), columnStart('left', 'full')]).toEqual(['0', 'auto', 'auto'])
  })
})
