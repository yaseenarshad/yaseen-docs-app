/**
 * YAZ-3419 (found by the YAZ-3411 checker): every key the application menu holds for itself must read as TAKEN in Settings › Hotkeys.
 * Otherwise the recorder gives that key to a command, and two menu items share one accelerator.
 */
import { describe, expect, it } from 'vitest'
import { HOTKEY_COMMANDS, ownersOf } from '@shared/hotkeyBindings'
import { MACOS_HOTKEYS } from '@shared/macosHotkeys'
import { BUILT_IN_KEYS } from './hotkeys'

/** The fixed accelerators of `desktop/src/main/menu.ts` (not the 14 changeable ones, not roles). */
const FIXED_MENU_KEYS = [
  'CmdOrCtrl+Shift+E', // Export Image…
  'CmdOrCtrl+Shift+S', // Export Excalidraw Drawing… (EXPORT_DRAWING_ACCELERATOR)
  'CmdOrCtrl+Shift+L', // Share Link
  'CmdOrCtrl+0', // Actual Size
  'CmdOrCtrl+Plus', // Zoom In
  'CmdOrCtrl+=', // Zoom In, hidden twin (menu.view.zoom-in-eq)
  'CmdOrCtrl+-', // Zoom Out
  'CmdOrCtrl+Shift+]', // Next tab, hidden twin
  'CmdOrCtrl+Shift+[', // Previous tab, hidden twin
  'CmdOrCtrl+Shift+V', // Edit › Paste as › Plain text (menu.edit.paste-plain)
]

describe('YAZ-3419: the menu\'s fixed keys are taken on the Hotkeys page', () => {
  it.each(FIXED_MENU_KEYS)('%s has an owner, so the recorder refuses it', (key) => {
    const owners = ownersOf(key, {}, MACOS_HOTKEYS, BUILT_IN_KEYS)
    expect(owners.length, `${key} reads as free`).toBeGreaterThan(0)
  })
  it('no changeable default is one of them', () => {
    expect(HOTKEY_COMMANDS.length).toBe(14)
  })
})
