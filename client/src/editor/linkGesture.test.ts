import { describe, expect, it } from 'vitest'
import { linkOpenHint } from './linkGesture'

/** The hover card's open line (YAZ-3935, point 9 of YAZ-3879): the bound gesture, as it is now. */
describe('linkOpenHint', () => {
  it('names the gesture of Open in this tab, else the first action that has one; none bound, no line; a read-only note opens on a click', () => {
    expect(linkOpenHint({}, true)).toBe('⌘-click to open')
    expect(linkOpenHint({ 'links.thisTab': 'Click' }, true)).toBe('Click to open')
    expect(linkOpenHint({ 'links.thisTab': null, 'links.newTab': 'Alt+Click' }, true)).toBe('⌥-click to open in a new tab')
    expect(linkOpenHint({ 'links.thisTab': null }, true)).toBe('⌘⇧-click to open in a background tab')
    expect(linkOpenHint({ 'links.thisTab': null, 'links.backgroundTab': null }, true)).toBeUndefined()
    expect(linkOpenHint({}, false)).toBe('Click to open')
  })
})
