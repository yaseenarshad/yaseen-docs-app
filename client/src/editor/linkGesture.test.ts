import { describe, expect, it } from 'vitest'
import { linkOpenHint } from './linkGesture'

/** The hover card's open line (YAZ-3935, point 9 of YAZ-3879): the bound gesture, as it is now. */
describe('linkOpenHint', () => {
  it('names Open in this tab\'s gesture, else a background tab\'s, else a new tab\'s; none bound, no line; a read-only note opens on a click', () => {
    // The defaults, browser style (YAZ-3747 demo): no click for this tab, ⌘-click behind.
    expect(linkOpenHint({}, true)).toBe('⌘-click to open in a background tab')
    expect(linkOpenHint({ 'links.thisTab': 'Click' }, true)).toBe('Click to open')
    expect(linkOpenHint({ 'links.backgroundTab': null }, true)).toBe('⌘⇧-click to open in a new tab')
    expect(linkOpenHint({ 'links.backgroundTab': null, 'links.newTab': 'Alt+Click' }, true)).toBe('⌥-click to open in a new tab')
    expect(linkOpenHint({ 'links.backgroundTab': null, 'links.newTab': null }, true)).toBeUndefined()
    expect(linkOpenHint({}, false)).toBe('Click to open')
  })
})
