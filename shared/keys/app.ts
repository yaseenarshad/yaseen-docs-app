/**
 * The App keys (YAZ-3564 K1): the menu's and the window's. On a Mac a menu key fires before any page, so an App
 * key blocks the same key in every place (K3) unless it steps aside there (K9). The changeable ones are the
 * commands of `HOTKEY_COMMANDS` (`shared/hotkeyBindings.ts`, YAZ-3397); the rest are built in. The window
 * keys came from `WINDOW_HOTKEYS` (`client/src/settings/hotkeys.ts`).
 */
import { APP_STANDARD_KEYS, HOTKEY_COMMANDS, MENU_FIXED_KEYS, appKeyId } from '../hotkeyBindings'
import type { KeyRow } from './types'

/** The Edit menu's roles (`desktop/src/main/menu.ts`): the page in front gets their key. */
const EDIT_ROLES = new Set(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select all'])

const ANY_VAULT = Array.from({ length: 9 }, (_, i) => `CmdOrCtrl+${i + 1}`)

export const APP_KEYS: readonly KeyRow[] = [
  ...HOTKEY_COMMANDS.map((c): KeyRow => ({
    id: appKeyId(c.id),
    scope: 'app',
    label: c.label,
    ...(c.hint === undefined ? {} : { hint: c.hint }),
    keys: c.key === null ? [] : [c.key],
    changeable: true,
    ...(c.stepsAsideIn === undefined ? {} : { stepsAsideIn: c.stepsAsideIn }),
  })),
  ...MENU_FIXED_KEYS.map((k, i): KeyRow => ({ id: `app.menu${i}`, scope: 'app', label: k.label, keys: [k.accelerator], changeable: false })),
  // The window's own keys (YAZ-1674, YAZ-2555, YAZ-3255, YAZ-3272, GRO-2232, YAZ-2322): built in.
  { id: 'app.vaultNumber', scope: 'app', label: 'Go to the vault with that number', hint: 'Right-click a vault to give it one', keys: ANY_VAULT, changeable: false },
  { id: 'app.cutFiles', scope: 'app', label: 'Cut the selected files and folders', keys: ['CmdOrCtrl+X'], changeable: false, macStandard: true, passesToPages: true },
  { id: 'app.copyFiles', scope: 'app', label: 'Copy the selected files and folders', keys: ['CmdOrCtrl+C'], changeable: false, macStandard: true, passesToPages: true },
  { id: 'app.pasteFiles', scope: 'app', label: 'Paste beside the first selected row', keys: ['CmdOrCtrl+V'], changeable: false, macStandard: true, passesToPages: true },
  { id: 'app.undoMove', scope: 'app', label: 'Undo / redo the last move, delete or rename of files', hint: 'Outside a note, a drawing, a diagram or a field', keys: ['CmdOrCtrl+Z', 'CmdOrCtrl+Shift+Z'], changeable: false, macStandard: true, passesToPages: true },
  { id: 'app.trash', scope: 'app', label: 'Move the selected files and folders to the Trash', hint: 'Outside a note, a drawing, a diagram or a field', keys: ['CmdOrCtrl+Backspace'], changeable: false, passesToPages: true },
  { id: 'app.reviewNext', scope: 'app', label: 'In a review: still relevant, on to the next note', keys: ['CmdOrCtrl+Shift+Enter'], changeable: false },
  { id: 'app.reviewSkip', scope: 'app', label: 'In a review: skip', keys: ['CmdOrCtrl+Shift+S'], changeable: false },
  // The Edit menu's roles hand their key to the page in front (an editor's own Undo, Copy, Select all), so they block no place.
  ...APP_STANDARD_KEYS.map((k): KeyRow => ({ id: `app.mac.${k.label.toLowerCase().replace(/\W+/g, '-')}`, scope: 'app', label: k.label, keys: [k.accelerator], changeable: false, macStandard: true, ...(EDIT_ROLES.has(k.label) ? { passesToPages: true as const } : {}) })),
]
