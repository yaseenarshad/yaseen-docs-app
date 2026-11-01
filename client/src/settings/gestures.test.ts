import { describe, expect, it } from 'vitest'
import { GESTURE_ROWS, gestureAction, gestureClashes, gestureDisplay, gestureFor, gestureOf, gestureOfEvent, gestureRow, isDefaultGesture, isGestureEntry, parseGesture, sameGesture, withGesture } from '@shared/keys'

/** YAZ-3936 (demo round 1 C4 of YAZ-3879): the clicks of "Links in a note" and "Bullet dots", stored with the keys' changes. */
const mods = (held: string) => ({ metaKey: held.includes('⌘'), ctrlKey: held.includes('⌃'), altKey: held.includes('⌥'), shiftKey: held.includes('⇧') })
const row = (id: string) => {
  const found = gestureRow(id)
  if (found === undefined) throw new Error(id)
  return found
}

describe('the gesture rows (C4)', () => {
  it('has two places with three actions each, and the defaults of the decision (links browser style, YAZ-3747 demo)', () => {
    expect(GESTURE_ROWS.map((r) => [r.id, gestureDisplay(r.gesture)])).toEqual([
      ['links.thisTab', ''],
      ['links.newTab', '⌘⇧-click'],
      ['links.backgroundTab', '⌘-click'],
      ['bullets.thisTab', 'Click'],
      ['bullets.newTab', '⇧-click'],
      ['bullets.backgroundTab', '⌘-click'],
    ])
  })

  it('reads a gesture in any spelling, and writes it as the menu writes keys', () => {
    expect(parseGesture('Shift+CmdOrCtrl+Click')).toEqual({ cmd: true, ctrl: false, alt: false, shift: true })
    expect(sameGesture('Command+Shift+Click', 'CmdOrCtrl+Shift+Click')).toBe(true)
    expect(sameGesture('Click', 'Shift+Click')).toBe(false)
    for (const bad of ['CmdOrCtrl+K', 'Click+Shift', 'Shift+Shift+Click', '']) expect(parseGesture(bad), bad).toBeNull()
    expect(gestureOfEvent(mods('⌥⇧'))).toBe('Alt+Shift+Click')
    expect(gestureDisplay('Control+Alt+CmdOrCtrl+Shift+Click')).toBe('⌃⌥⌘⇧-click')
    expect(gestureDisplay(null)).toBe('')
  })
})

describe('a click reads its binding (C4)', () => {
  it('the defaults: ⌘-click opens a link behind, ⌘⇧-click in a new tab in front; a plain click opens none; a dot zooms, ⇧ in front, ⌘ behind', () => {
    expect(gestureAction('links', mods('⌘'), {})).toBe('backgroundTab')
    expect(gestureAction('links', mods('⌘⇧'), {})).toBe('newTab')
    expect(gestureAction('links', mods(''), {})).toBeNull()
    expect(gestureAction('links', mods('⇧'), {})).toBeNull()
    expect(gestureAction('bullets', mods(''), undefined)).toBe('thisTab')
    expect(gestureAction('bullets', mods('⇧'), undefined)).toBe('newTab')
    expect(gestureAction('bullets', mods('⌘'), undefined)).toBe('backgroundTab')
    expect(gestureAction('bullets', mods('⌥'), undefined)).toBeNull()
  })

  it('"the old way" (#11) is a binding: Links › Open in this tab on Click; "No gesture" opens nothing', () => {
    const old = withGesture({}, row('links.thisTab'), 'Click')
    expect(old).toEqual({ 'links.thisTab': 'Click' })
    expect(gestureAction('links', mods(''), old)).toBe('thisTab')
    expect(gestureAction('links', mods('⌘'), old)).toBe('backgroundTab')
    const none = withGesture({}, row('links.backgroundTab'), null)
    expect(gestureAction('links', mods('⌘'), none)).toBeNull()
    expect(gestureFor('links', 'backgroundTab', none)).toBeNull()
  })

  it('only a change is stored: the default deletes the entry, so `{}` is every default', () => {
    const changed = withGesture({ 'app.search': 'CmdOrCtrl+J' }, row('links.thisTab'), 'Alt+Click')
    expect(changed).toEqual({ 'app.search': 'CmdOrCtrl+J', 'links.thisTab': 'Alt+Click' })
    expect(withGesture(changed, row('links.thisTab'), null)).toEqual({ 'app.search': 'CmdOrCtrl+J' })
    expect(withGesture({ 'links.backgroundTab': 'Click' }, row('links.backgroundTab'), 'Command+Click')).toEqual({})
    expect(gestureOf(row('links.thisTab'), changed)).toBe('Alt+Click')
    expect(isDefaultGesture('links.backgroundTab', 'CmdOrCtrl+Click')).toBe(true)
    expect(isGestureEntry('links.thisTab', 'Shift+Click')).toBe(true)
    expect(isGestureEntry('links.thisTab', 'CmdOrCtrl+K')).toBe(false)
    expect(isGestureEntry('links.window', 'Click')).toBe(false)
  })

  it('a clash is two rows of ONE place on one gesture: ⌘-click on a link and on a dot is no clash', () => {
    expect(gestureClashes(row('links.thisTab'), 'CmdOrCtrl+Click', {}).map((r) => r.id)).toEqual(['links.backgroundTab'])
    expect(gestureClashes(row('bullets.thisTab'), 'CmdOrCtrl+Click', {}).map((r) => r.id)).toEqual(['bullets.backgroundTab'])
    expect(gestureClashes(row('links.thisTab'), 'Click', {}).map((r) => r.id)).toEqual([])
    // A stored clash (no page writes one) is read in the rows' order: the first row wins.
    expect(gestureAction('links', mods('⌘'), { 'links.thisTab': 'CmdOrCtrl+Click' })).toBe('thisTab')
  })
})
