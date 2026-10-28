import { describe, expect, it } from 'vitest'
import { HOTKEY_COMMANDS, sameKey, toDisplay } from '@shared/hotkeyBindings'
import { BUILT_IN_KEYS, CANVAS_HOTKEYS, DRAWIO_HOTKEYS, HOTKEY_GROUPS, VIEW_HOTKEYS, HOTKEYS, MOUSE_TIPS, WINDOW_HOTKEYS } from './hotkeys'

describe('HOTKEYS source of truth', () => {
  it('covers every shipped keyboard binding', () => {
    const keys = HOTKEYS.map((h) => h.keys)
    // One entry per binding shipped by hotkeys.ts / zoom.ts / marks + history (GRO-2067 Q4).
    for (const expected of ['⌘↑ / ⌘↓', '⌘⇧U', '⌘⇧I', '⌘Z', '⌘⇧Z', '⌘.', '⌘⇧.', '⌘J', '⌘+ / ⌘− / ⌘0', '⌘⏎', '⌘U', '⌘⇧H', '⌘⇧X', 'Tab / ⇧Tab', '⇧↑ / ⇧↓']) {
      expect(keys).toContain(expected)
    }
    expect(HOTKEYS.find((h) => h.keys === '⌘⇧U')?.label).toMatch(/bullets and headings/i)
    expect(HOTKEYS.find((h) => h.keys === '⌘⇧I')?.label).toMatch(/bullets and headings/i)
    // ⌘J (YAZ-2700): right below the zoom pair, and the label names the feature as the app does.
    expect(keys[keys.indexOf('⌘⇧.') + 1]).toBe('⌘J')
    expect(HOTKEYS.find((h) => h.keys === '⌘J')?.label).toMatch(/^Table of contents/)
  })

  it('covers the folder view bindings', () => {
    const keys = VIEW_HOTKEYS.map((h) => h.keys)
    // Table cell navigation (4B), cell editors (5B), board drag cancel (5C) — 7B, GRO-2148.
    for (const expected of ['↑ ↓ ← →', '⌘⏎ / ⌥⏎', '⏎ / Esc', 'Esc']) {
      expect(keys).toContain(expected)
    }
    // YAZ-1557: arrows walk board cards too, and the modifier-Enter pair names both targets in order.
    expect(VIEW_HOTKEYS.find((h) => h.keys === '↑ ↓ ← →')?.label).toMatch(/board cards/i)
    expect(VIEW_HOTKEYS.find((h) => h.keys === '⌘⏎ / ⌥⏎')?.label).toMatch(/background tab.*right panel/i)
  })

  it('covers the window & tab shortcuts from the application menu (B3 + Tabs): the changeable ones in HOTKEY_COMMANDS, the built-in ones here, none twice (YAZ-3397 D2)', () => {
    const keys = WINDOW_HOTKEYS.map((h) => h.keys)
    // The menu's changeable keys (menu.ts, GRO-2161/2232) live in `HOTKEY_COMMANDS` and are listed above these.
    expect(HOTKEY_COMMANDS.map((c) => [c.id, toDisplay(c.key)])).toEqual([
      ['newTab', '⌘T'],
      ['newWindow', '⌘⇧N'],
      ['newFilesWindow', '⌘⇧W'],
      ['newItem', '⌘N'],
      ['goTo', '⌘D'],
      ['closeTab', '⌘W'],
      ['closeWindow', ''],
      ['switchVault', '⌘O'],
      ['openFolder', '⌘⇧O'],
      ['search', '⌘K'],
      ['settings', '⌘,'],
      ['toggleSidebar', '⌘⇧B'],
      ['copyPath', '⌘⇧C'],
      ['tabOverview', '⌘⇧M'],
      ['nextTab', '⌃Tab'],
      ['prevTab', '⌃⇧Tab'],
    ])
    expect(HOTKEY_COMMANDS.filter((c) => c.macStandard === true).map((c) => c.id)).toEqual(['newTab', 'newWindow', 'newItem', 'closeTab', 'switchVault', 'settings'])
    for (const command of HOTKEY_COMMANDS) if (command.key !== null) expect(keys, command.id).not.toContain(toDisplay(command.key))
    for (const expected of ['⌘1 … ⌘9', '⌘X / ⌘C', '⌘V', '⌘⇧] / ⌘⇧[']) expect(keys).toContain(expected)
    expect(keys).not.toContain('⌥ Open Recent')
    // ⌘O (YAZ-1767 D8): the switcher's two verbs, filter then open — in a NEW window, never in place.
    expect(HOTKEY_COMMANDS.find((c) => c.id === 'switchVault')?.hint).toMatch(/filter.*new window/i)
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘1 … ⌘9')?.label).toMatch(/vault with that number.*right-click a vault/i)
    // ⌘⇧C (🔒 D4, YAZ-1338): the multi-selection FIRST, the open file as the fallback.
    expect(HOTKEY_COMMANDS.find((c) => c.id === 'copyPath')?.hint).toMatch(/selection.*else the open file/i)
    // A menu key since YAZ-3564 D10: it works inside every editor too.
    expect(HOTKEY_COMMANDS.find((c) => c.id === 'toggleSidebar')?.hint).toMatch(/note, a drawing, a diagram and code/i)
    // A move's undo (YAZ-3255 D10, audit 11): right after the file clipboard, and it says where a page keeps the keys.
    expect(keys[keys.indexOf('⌘V') + 1]).toBe('⌘Z / ⌘⇧Z')
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘Z / ⌘⇧Z')?.label).toMatch(/undo.*redo.*move.*outside a note/i)
    // ⌘⌫ (YAZ-3272 D20): right after the undo, which takes a delete back; plain ⌫ is not the key.
    expect(keys[keys.indexOf('⌘Z / ⌘⇧Z') + 1]).toBe('⌘⌫')
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘⌫')?.label).toMatch(/selected files and folders to the Trash.*outside a note/i)
  })

  it('BUILT_IN_KEYS reads every table back into keys (YAZ-3397 D6): no changeable default is a key the app has built in, but ⌘B, which draw.io leaves to the sidebar', () => {
    const builtIn = (accelerator: string) => BUILT_IN_KEYS.filter((k) => sameKey(k.accelerator, accelerator)).map((k) => k.label)
    expect(builtIn('CmdOrCtrl+J')).toEqual(['Table of contents'])
    expect(builtIn('CmdOrCtrl+Q')).toEqual(['Quit'])
    expect(builtIn('CmdOrCtrl+9')).toHaveLength(1)
    for (const command of HOTKEY_COMMANDS) if (command.key !== null && command.id !== 'toggleSidebar') expect(builtIn(command.key), command.id).toEqual([])
    expect(BUILT_IN_KEYS.some((k) => k.label.startsWith('Click'))).toBe(false)
  })

  it('covers the board keys from Draw (YAZ-3037): the menu\'s three board items and ⌘S, and the draw.io tables, between Window and Mouse', () => {
    expect(CANVAS_HOTKEYS.map((h) => h.keys)).toEqual(['⌘⇧E', '⌘⇧S', '⌘⇧L', '⌘S', '⌘F', '⌘C'])
    expect(CANVAS_HOTKEYS.find((h) => h.keys === '⌘C')?.label).toMatch(/components tab.*nothing is selected/i)
    expect(DRAWIO_HOTKEYS.map((h) => h.keys)).toContain('R / O / T')
    // YAZ-3397 D8: Window first (the changeable keys head it), App standard after Mouse; "Used by macOS" is the page's, after them.
    expect(HOTKEY_GROUPS.map((g) => g.title)).toEqual(['Window', 'Keyboard', 'Views', 'Excalidraw canvas', 'draw.io diagram', 'Mouse', 'App standard'])
    // ⌘⇧S keeps both meanings: Skip in a review (the Window table), Export on a drawing tab.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘⇧S')?.label).toMatch(/review.*skip/i)
    expect(CANVAS_HOTKEYS.find((h) => h.keys === '⌘⇧S')?.label).toMatch(/export excalidraw drawing/i)
  })

  it('covers the review session\'s keys (YAZ-2322): the two answers and the way out', () => {
    const byKeys = (keys: string) => WINDOW_HOTKEYS.find((h) => h.keys === keys)
    expect(byKeys('⌘⇧⏎')?.label).toMatch(/review.*still relevant/i)
    expect(byKeys('⌘⇧S')?.label).toMatch(/review.*skip/i)
    expect(byKeys('Esc')?.label).toMatch(/close the review/i)
  })

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

  it('every entry is renderable (non-empty keys and label)', () => {
    for (const entry of [...HOTKEYS, ...VIEW_HOTKEYS, ...WINDOW_HOTKEYS, ...MOUSE_TIPS]) {
      expect(entry.keys.length).toBeGreaterThan(0)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})
