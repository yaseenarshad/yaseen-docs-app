import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEB_LINKS,
  WEB_LINK_PRESETS,
  cleanWebLinkCustomMark,
  isDefaultWebLinks,
  isWebLinksStyle,
  sameWebLinks,
  sanitizeWebLinks,
  webLinkVars,
  type WebLinksStyle,
} from './webLinks'

describe('shared/webLinks (YAZ-6580)', () => {
  it('defaults to empty sparse object and emits zero CSS vars unless resetDefaults is true', () => {
    expect(isDefaultWebLinks(DEFAULT_WEB_LINKS)).toBe(true)
    expect(webLinkVars(DEFAULT_WEB_LINKS)).toEqual({})
    const reset = webLinkVars(DEFAULT_WEB_LINKS, { resetDefaults: true })
    expect(reset['--ext-link-decoration']).toBe('initial')
    expect(reset['--ext-link-mark-place']).toBe('initial')
    expect(reset['--ext-link-hover-mode']).toBe('initial')
  })

  it('validates and round-trips every built-in preset cleanly', () => {
    for (const preset of WEB_LINK_PRESETS) {
      expect(isWebLinksStyle(preset.style), preset.id).toBe(true)
      expect(sanitizeWebLinks(preset.style), preset.id).toEqual(preset.style)
    }
    expect(sameWebLinks(WEB_LINK_PRESETS[0]!.style, DEFAULT_WEB_LINKS)).toBe(true)
  })

  it('sanitizes corrupt input, strips default values, and rejects bad fields in strict validator', () => {
    expect(sanitizeWebLinks(null)).toEqual(DEFAULT_WEB_LINKS)
    expect(sanitizeWebLinks('nope')).toEqual(DEFAULT_WEB_LINKS)
    expect(
      sanitizeWebLinks({
        bold: false,
        italic: true,
        underline: true,
        color: 'accent',
        box: { shape: 'none', fill: 'red' },
        mark: { place: 'after', icon: 'arrow-up-right', color: 'same', size: 'small' },
        hover: { style: 'wash', strength: 'light' },
      }),
    ).toEqual({
      italic: true,
      mark: { place: 'after' },
    })

    expect(isWebLinksStyle({ unknownKey: 1 })).toBe(false)
    expect(isWebLinksStyle({ underline: true })).toBe(false)
    expect(isWebLinksStyle({ color: 'accent' })).toBe(false)
    expect(isWebLinksStyle({ color: '#123' })).toBe(false)
    expect(isWebLinksStyle({ mark: { place: 'after', icon: 'arrow-up-right' } })).toBe(false)
    expect(isWebLinksStyle({ mark: { place: 'after', custom: 'a'.repeat(9) } })).toBe(false)
    expect(isWebLinksStyle({ mark: { place: 'after', custom: 'hi\nthere' } })).toBe(false)
    expect(isWebLinksStyle({ box: { shape: 'round', fill: '#1D4ED8' } })).toBe(true)
  })

  it('cleans custom emoji and short text marks safely', () => {
    expect(cleanWebLinkCustomMark('  🔗  ')).toBe('🔗')
    expect(cleanWebLinkCustomMark('[web]')).toBe('[web]')
    expect(cleanWebLinkCustomMark('')).toBeUndefined()
    expect(cleanWebLinkCustomMark('   ')).toBeUndefined()
    expect(cleanWebLinkCustomMark('a\nb')).toBeUndefined()
    expect(cleanWebLinkCustomMark('123456789')).toBeUndefined()
  })

  it('emits expected CSS vars for Clean + arrow, Custom emoji, and Subtle pill', () => {
    const arrow = webLinkVars(WEB_LINK_PRESETS.find((p) => p.id === 'arrow')!.style)
    expect(arrow['--ext-link-decoration']).toBe('none')
    expect(arrow['--ext-link-mark-place']).toBe('after')
    expect(arrow['--ext-link-mark-kind']).toBe('svg')
    expect(arrow['--ext-link-mark-icon']).toContain('data:image/svg+xml,')
    expect(arrow['--ext-link-mark-fg']).toBe('var(--fg-muted)')
    expect(arrow['--ext-link-hover-mode']).toBe('underline')

    const emoji = webLinkVars({ underline: false, mark: { place: 'after', custom: 'a"b\\c' } } as WebLinksStyle)
    expect(emoji['--ext-link-mark-kind']).toBe('text')
    expect(emoji['--ext-link-mark-text']).toBe('"a\\"b\\\\c"')

    const pill = webLinkVars(WEB_LINK_PRESETS.find((p) => p.id === 'pill')!.style)
    expect(pill['--ext-link-bg']).toBe('color-mix(in srgb, var(--accent) 10%, transparent)')
    expect(pill['--ext-link-radius']).toBe('4px')
    expect(pill['--ext-link-hover-overhang']).toBe('0')
  })
})
