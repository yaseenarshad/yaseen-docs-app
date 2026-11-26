import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MENU_ICONS,
  DEFAULT_MENU_ICON_PICKS,
  isDefaultMenuIcons,
  isMenuIconsSetting,
  patchMenuIconPick,
  resolveMenuIcons,
  sanitizeMenuIcons,
} from './menuIcons'

describe('shared/menuIcons (YAZ-6567)', () => {
  it('validates on, off, and sparse custom objects while rejecting bad keys/values', () => {
    expect(isMenuIconsSetting('on')).toBe(true)
    expect(isMenuIconsSetting('off')).toBe(true)
    expect(isMenuIconsSetting({})).toBe(true)
    expect(isMenuIconsSetting({ newWindow: 'win-arrow', hideOthers: 'none' })).toBe(true)

    expect(isMenuIconsSetting('minimal')).toBe(false)
    expect(isMenuIconsSetting(null)).toBe(false)
    expect(isMenuIconsSetting([])).toBe(false)
    expect(isMenuIconsSetting({ bogus: 'box-arrow' })).toBe(false)
    expect(isMenuIconsSetting({ newWindow: 'invalid' })).toBe(false)
  })

  it('sanitizes partial or corrupt values and collapses all-default objects to on', () => {
    expect(sanitizeMenuIcons(undefined)).toBe(DEFAULT_MENU_ICONS)
    expect(sanitizeMenuIcons('off')).toBe('off')
    expect(sanitizeMenuIcons({ ...DEFAULT_MENU_ICON_PICKS })).toBe('on')
    expect(sanitizeMenuIcons({ newWindow: 'win-plus', duplicateTab: 'bogus', extra: 'x' })).toEqual({
      newWindow: 'win-plus',
    })
  })

  it('resolves approved defaults and tracks patches cleanly', () => {
    expect(resolveMenuIcons('on')).toEqual({
      enabled: true,
      picks: {
        newWindow: 'box-arrow',
        duplicateTab: 'clone-plus',
        openNewTab: 'tab-bar-plus',
        hideOthers: 'isolate',
        showInSidebar: 'panel-highlight',
      },
    })
    expect(resolveMenuIcons('off').enabled).toBe(false)

    const updated = patchMenuIconPick('on', 'newWindow', 'win-arrow')
    expect(updated).toEqual({ newWindow: 'win-arrow' })
    expect(isDefaultMenuIcons(updated)).toBe(false)

    const restored = patchMenuIconPick(updated, 'newWindow', 'box-arrow')
    expect(restored).toBe('on')
    expect(isDefaultMenuIcons(restored)).toBe(true)
  })
})
