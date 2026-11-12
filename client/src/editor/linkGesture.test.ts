import { describe, expect, it } from 'vitest'
import { linkClickAction, linkOpenHint } from './linkGesture'

const PLAIN = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
const META = { ...PLAIN, metaKey: true }
const ALT = { ...PLAIN, altKey: true }
const yes = () => true
const no = () => false

/** What a primary click on a link does (YAZ-3936; the vault's "Clicking a link" since YAZ-4936, on every page since YAZ-4939). */
describe('linkClickAction', () => {
  it('a bound gesture wins; an editable page keeps a plain click as text; a read-only page opens on a plain click', () => {
    expect(linkClickAction({ editable: true }, META, undefined)).toBe('backgroundTab')
    expect(linkClickAction({ editable: true }, PLAIN, undefined)).toBeNull()
    expect(linkClickAction({ editable: false }, PLAIN, undefined)).toBe('thisTab')
    expect(linkClickAction({ editable: false }, ALT, undefined)).toBeNull()
  })

  it('a plain click follows the vault\'s Explore choice on an editable page AND on a read-only page (YAZ-4939)', () => {
    expect(linkClickAction({ editable: true }, PLAIN, undefined, yes)).toBe('explore')
    expect(linkClickAction({ editable: false }, PLAIN, undefined, yes)).toBe('explore')
    expect(linkClickAction({ editable: false }, PLAIN, undefined, no)).toBe('thisTab')
  })

  it('a bound gesture still wins over Explore, and a modified click no gesture has is never Explore', () => {
    expect(linkClickAction({ editable: false }, META, undefined, yes)).toBe('backgroundTab')
    expect(linkClickAction({ editable: false }, PLAIN, { 'links.thisTab': 'Click' }, yes)).toBe('thisTab')
    expect(linkClickAction({ editable: true }, PLAIN, { 'links.newTab': 'Click' }, yes)).toBe('newTab')
    expect(linkClickAction({ editable: true }, ALT, undefined, yes)).toBeNull()
    expect(linkClickAction({ editable: false }, ALT, undefined, yes)).toBeNull()
  })
})

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

  it('says "Click to open in Explore" while the vault\'s choice is Explore, on an editable and on a read-only page; a plain click that is bound wins (YAZ-4939)', () => {
    expect(linkOpenHint({}, true, true)).toBe('Click to open in Explore')
    expect(linkOpenHint({}, false, true)).toBe('Click to open in Explore')
    expect(linkOpenHint({ 'links.thisTab': 'Click' }, false, true)).toBe('Click to open')
    expect(linkOpenHint({ 'links.thisTab': 'Click' }, true, true)).toBe('Click to open')
    expect(linkOpenHint({}, false, false)).toBe('Click to open')
  })
})
