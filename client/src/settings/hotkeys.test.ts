import { describe, expect, it } from 'vitest'
import { MOUSE_TIPS, shortLabel } from './hotkeys'

/** The built-in clicks of Settings › Hotkeys: no key, and not the user's to change. The changeable ones are `shared/keys/gestures.ts` (YAZ-3936). */
describe('MOUSE_TIPS', () => {
  it('the built-in tips carry the I3 and folder-view click rulings; links in a note and bullet dots are rows of their own now (YAZ-3936)', () => {
    const tip = (gesture: string, place: string) => MOUSE_TIPS.find((t) => t.gesture === gesture && t.place === place)
    // The sidebar's ⌘-click (I3) and the folder views' (YAZ-1557) stay built in; a link in a note is no longer this tip's (C4).
    expect(tip('⌘-click', 'Sidebar, tables and boards')?.label).toMatch(/background tab/i)
    expect(MOUSE_TIPS.some((t) => /link/i.test(t.place) || /bullet dot|glyph/i.test(t.place))).toBe(false)
    expect(tip('Right-click', 'Sidebar')?.label).toMatch(/new window/i)
    // Copy path is that menu's one copy item (YAZ-2420 🔒 D22, D31), so the tip names no other.
    expect(tip('Right-click', 'Sidebar')?.label).toMatch(/Copy path, New note/)
    // The vault menu (YAZ-1798): the one in-place open lives there, so the tip names it — and the display name (YAZ-1974 D5) and the number (YAZ-2555 D2).
    expect(tip('Right-click', 'Vaults')?.label).toMatch(/Open in this window/)
    expect(tip('Right-click', 'Vaults')?.label).toMatch(/Set display name, Set shortcut/)
    // A tab's double-click opens its name field (YAZ-3059 D3, S16).
    expect(tip('Double-click', 'Tabs')?.label).toMatch(/Set its display name/)
    // Multi-select (YAZ-1336 🔒 D2 → YAZ-1337): ⇧-click toggles rows, and the tip has to say what
    // that is FOR — the two plural items a right-click then offers.
    expect(tip('⇧-click', 'Sidebar')?.label).toMatch(/multi-selection/i)
    expect(tip('⇧-click', 'Sidebar')?.label).toMatch(/Copy N paths/)
    expect(tip('⇧-click', 'Sidebar')?.label).toMatch(/Open N in new tabs/)
    // YAZ-1557 (D1/D2): click = select on a board card, ⌥ = the right panel on both folder views.
    expect(tip('Click', 'Board cards')?.label).toMatch(/select/i)
    expect(tip('⌥-click', 'Tables and boards')?.label).toMatch(/right panel/i)
    expect(tip('Drag', '6 dots')?.label).toMatch(/Move block/)
  })

  it('every tip is renderable, and its short label is the text before " — "', () => {
    for (const tip of MOUSE_TIPS) {
      expect(tip.gesture.length).toBeGreaterThan(0)
      expect(tip.place.length).toBeGreaterThan(0)
      expect(tip.label.length).toBeGreaterThan(0)
    }
    expect(shortLabel('Select it — the title opens the note in the current tab')).toBe('Select it')
  })
})
