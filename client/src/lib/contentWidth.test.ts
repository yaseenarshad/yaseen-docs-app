import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { columnMax, contentWidthVars } from './contentWidth'

const vars = (over: Partial<SettingsState>) => contentWidthVars({ ...DEFAULT_SETTINGS, ...over })

describe('Content width and Card width (YAZ-5144)', () => {
  it('each Content width step is clearly wider than the one before: 640 px, 900 px, the window', () => {
    expect(['narrow', 'medium', 'full'].map((contentWidth) => vars({ contentWidth: contentWidth as SettingsState['contentWidth'] })['--content-text-width'])).toEqual(['640px', '900px', '100vw'])
    // The pages' column, sides in: what the table of contents makes room for.
    expect([columnMax('narrow'), columnMax('medium'), columnMax('full')]).toEqual([736, 996, Infinity])
  })

  it('Card width Same as pages follows Content width; a step of its own does not', () => {
    expect(vars({ contentWidth: 'medium', cardWidth: 'pages' })['--card-text-width']).toBe('900px')
    expect(vars({ contentWidth: 'full', cardWidth: 'narrow' })['--card-text-width']).toBe('640px')
    expect(vars({ contentWidth: 'narrow', cardWidth: 'full' })['--card-text-width']).toBe('100vw')
  })

  it('a field a main process older than it did not send, or a value that is not a step, reads the default', () => {
    const { cardWidth: _gone, ...older } = DEFAULT_SETTINGS
    expect(contentWidthVars({ ...older, contentWidth: 'medium' } as SettingsState)['--card-text-width']).toBe('900px')
    expect(vars({ contentWidth: 'wide' as never, cardWidth: 'huge' as never })).toEqual({ '--content-text-width': '640px', '--card-text-width': '640px' })
  })
})
