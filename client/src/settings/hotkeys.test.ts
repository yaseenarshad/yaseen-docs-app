import { describe, expect, it } from 'vitest'
import { MOUSE_TIPS, shortLabel } from './hotkeys'

/** The mouse tips of Settings › Hotkeys: the clicks and drags, which have no key. Every key is a row of `shared/keys/` (YAZ-3564 K1). */
describe('MOUSE_TIPS', () => {
  it('the mouse tips carry the I3 + Links C click rulings: link click = current tab (create-on-missing), shared ⌘-click = background tab, right-click = new window', () => {
    const byKeys = (keys: string) => MOUSE_TIPS.find((t) => t.keys === keys)
    // GRO-2192: editor wiki links — click opens in the current tab, an unresolved link creates first.
    expect(byKeys('Click link')?.label).toMatch(/current tab/i)
    expect(byKeys('Click link')?.label).toMatch(/created/i)
    // ONE shared ⌘-click convention: sidebar file rows (I3) AND editor wiki links (Links C).
    expect(byKeys('⌘-click file or link')?.label).toMatch(/background tab/i)
    expect(byKeys('Right-click file')?.label).toMatch(/new window/i)
    // Copy path is that menu's one copy item (YAZ-2420 🔒 D22, D31), so the tip names no other.
    expect(byKeys('Right-click file')?.label).toMatch(/Copy path, New note/)
    // The vault menu (YAZ-1798): the one in-place open lives there, so the tip names it — and the display name (YAZ-1974 D5) and the number (YAZ-2555 D2).
    expect(byKeys('Right-click vault')?.label).toMatch(/Open in this window/)
    expect(byKeys('Right-click vault')?.label).toMatch(/Set display name, Set shortcut/)
    // A tab's double-click opens its name field (YAZ-3059 D3, S16).
    expect(byKeys('Double-click tab')?.label).toMatch(/Set its display name/)
    // Multi-select (YAZ-1336 🔒 D2 → YAZ-1337): ⇧-click toggles rows, and the tip has to say what
    // that is FOR — the two plural items a right-click then offers.
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/multi-selection/i)
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/Copy N paths/)
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/Open N in new tabs/)
    // YAZ-1557 (D1/D2): click = select on a board card, ⌥ = the right panel on both folder views.
    expect(byKeys('Click card')?.label).toMatch(/select/i)
    expect(byKeys('⌥-click name or card')?.label).toMatch(/right panel/i)
  })

  it('every tip is renderable, and its short label is the text before " — "', () => {
    for (const tip of MOUSE_TIPS) {
      expect(tip.keys.length).toBeGreaterThan(0)
      expect(tip.label.length).toBeGreaterThan(0)
    }
    expect(shortLabel('Select it — the title opens the note in the current tab')).toBe('Select it')
  })
})
