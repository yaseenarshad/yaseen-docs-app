import { describe, expect, it } from 'vitest'
import { BASES_HOTKEYS, HOTKEYS, MOUSE_TIPS, WINDOW_HOTKEYS } from './HotkeysPanel'

describe('HOTKEYS source of truth', () => {
  it('covers every shipped keyboard binding', () => {
    const keys = HOTKEYS.map((h) => h.keys)
    // One entry per binding shipped by hotkeys.ts / zoom.ts / marks + history (GRO-2067 Q4).
    for (const expected of ['⌘↑ / ⌘↓', '⌘⇧U', '⌘⇧I', '⌘Z', '⌘⇧Z', '⌘.', '⌘⇧.', '⌘⏎', '⌘U', '⌘⇧X', 'Tab / ⇧Tab']) {
      expect(keys).toContain(expected)
    }
  })

  it('covers the Bases view bindings', () => {
    const keys = BASES_HOTKEYS.map((h) => h.keys)
    // Table cell navigation (4B), cell editors (5B), board drag cancel (5C) — 7B, GRO-2148.
    for (const expected of ['↑ ↓ ← →', '⏎ / Esc', 'Esc']) {
      expect(keys).toContain(expected)
    }
  })

  it('covers the window & tab shortcuts from the application menu (B3 + Tabs) plus the open-beside tip', () => {
    const keys = WINDOW_HOTKEYS.map((h) => h.keys)
    // ⌘⇧N / ⌘⇧O / ⌘W (Close Tab) / ⌘⇧W (Close Window) and the tab-switch pairs live in the
    // menu (menu.ts, GRO-2161/2232); ⌥-click Open Recent = open beside (GRO-2211).
    for (const expected of ['⌘⇧N', '⌘⇧O', '⌘K', '⌘W', '⌘⇧W', '⌃Tab / ⌃⇧Tab', '⌘⇧] / ⌘⇧[', '⌥ Open Recent']) {
      expect(keys).toContain(expected)
    }
    // The ⌘W ladder swap (GRO-2232, locked): ⌘W closes the TAB, ⌘⇧W the window — never the reverse.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘W')?.label).toMatch(/close tab/i)
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘⇧W')?.label).toMatch(/close window/i)
  })

  it('the mouse tips carry the I3 + Links C click rulings: link click = current tab (create-on-missing), shared ⌘-click = background tab, right-click = new window', () => {
    const byKeys = (keys: string) => MOUSE_TIPS.find((t) => t.keys === keys)
    // GRO-2192: editor wiki links — click opens in the current tab, an unresolved link creates first.
    expect(byKeys('Click link')?.label).toMatch(/current tab/i)
    expect(byKeys('Click link')?.label).toMatch(/created/i)
    // ONE shared ⌘-click convention: sidebar file rows (I3) AND editor wiki links (Links C).
    expect(byKeys('⌘-click file or link')?.label).toMatch(/background tab/i)
    expect(byKeys('Right-click file')?.label).toMatch(/new window/i)
  })

  it('every entry is renderable (non-empty keys and label)', () => {
    for (const entry of [...HOTKEYS, ...BASES_HOTKEYS, ...WINDOW_HOTKEYS, ...MOUSE_TIPS]) {
      expect(entry.keys.length).toBeGreaterThan(0)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})
