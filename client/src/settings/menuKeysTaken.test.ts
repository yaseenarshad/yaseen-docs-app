/**
 * YAZ-3419 (found by the YAZ-3411 checker): every key the application menu holds for itself must read as TAKEN in Settings › Hotkeys.
 * Otherwise the recorder gives that key to a command, and two menu items share one accelerator. The recorder asks `clashesOf`
 * over the key list (`shared/keys/`, YAZ-3564 K3), so each fixed key must be a built-in App row there.
 */
import { describe, expect, it } from 'vitest'
import { ALL_KEYS, clashesOf, keyRow } from '@shared/keys'

/** The fixed accelerators of `desktop/src/main/menu.ts` (not the changeable ones, not roles). */
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
  it.each(FIXED_MENU_KEYS)('%s has a built-in App owner, so the recorder refuses it', (key) => {
    const owners = clashesOf(keyRow('app.search')!, key, {}, {})
    expect(owners.some((o) => o.scope === 'app' && !o.changeable), `${key} reads as free`).toBe(true)
  })
  it('no changeable App default is a built-in App key', () => {
    const taken = ALL_KEYS.filter((r) => r.scope === 'app' && r.changeable).flatMap((r) => r.keys.flatMap((key) => clashesOf(r, key, {}, {}).filter((o) => o.scope === 'app' && !o.changeable).map((o) => `${r.id} ${key}: ${o.id}`)))
    expect(taken).toEqual([])
  })
})
