import { describe, expect, it } from 'vitest'
import { BASES_HOTKEYS, HOTKEYS, MOUSE_TIPS } from './HotkeysPanel'

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

  it('every entry is renderable (non-empty keys and label)', () => {
    for (const entry of [...HOTKEYS, ...BASES_HOTKEYS, ...MOUSE_TIPS]) {
      expect(entry.keys.length).toBeGreaterThan(0)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})
