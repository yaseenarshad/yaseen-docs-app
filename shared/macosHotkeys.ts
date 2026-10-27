/**
 * THE MAC'S OWN KEYS (YAZ-3397 D3): the keys macOS takes before an app hears them, as the Mac ships them.
 * A row with a `symbolic` id is one the user can change or turn off in System Settings › Keyboard ›
 * Keyboard Shortcuts; `desktop/src/main/systemHotkeys.ts` reads this Mac's choices
 * (`com.apple.symbolichotkeys.plist`, keyed by that id) over this table. A row with none is fixed.
 *
 * Settings › Hotkeys lists the result under "Used by macOS", and the recorder will not give one of these
 * keys to a command (D6): a key macOS keeps never reaches the app.
 */

export interface MacosHotkey {
  label: string
  /** An Electron accelerator, as `shared/hotkeyBindings.ts` reads one. */
  accelerator: string
  /** The entry of `AppleSymbolicHotKeys` that holds this Mac's choice; absent = a key nobody can change. */
  symbolic?: number
}

export const MACOS_HOTKEYS: readonly MacosHotkey[] = [
  { label: 'Spotlight', accelerator: 'Command+Space', symbolic: 64 },
  { label: 'Finder search window', accelerator: 'Alt+Command+Space', symbolic: 65 },
  { label: 'Screenshot of the screen', accelerator: 'Command+Shift+3', symbolic: 28 },
  { label: 'Copy a screenshot of the screen', accelerator: 'Control+Command+Shift+3', symbolic: 29 },
  { label: 'Screenshot of an area', accelerator: 'Command+Shift+4', symbolic: 30 },
  { label: 'Copy a screenshot of an area', accelerator: 'Control+Command+Shift+4', symbolic: 31 },
  { label: 'Screenshot and recording tools', accelerator: 'Command+Shift+5', symbolic: 184 },
  { label: 'Next window of the app', accelerator: 'Command+`', symbolic: 27 },
  { label: 'Mission Control', accelerator: 'Control+Up', symbolic: 32 },
  { label: 'Windows of the app', accelerator: 'Control+Down', symbolic: 33 },
  { label: 'Move a space left', accelerator: 'Control+Left', symbolic: 79 },
  { label: 'Move a space right', accelerator: 'Control+Right', symbolic: 81 },
  { label: 'Previous input source', accelerator: 'Control+Space', symbolic: 60 },
  { label: 'Show or hide the Dock', accelerator: 'Alt+Command+D', symbolic: 52 },
  { label: 'Search the Help menu', accelerator: 'Command+Shift+/', symbolic: 98 },
  { label: 'Log out', accelerator: 'Command+Shift+Q' },
  { label: 'Log out now', accelerator: 'Alt+Shift+Command+Q' },
  { label: 'Lock screen', accelerator: 'Control+Command+Q' },
  { label: 'Force quit', accelerator: 'Alt+Command+Escape' },
  { label: 'Switch apps', accelerator: 'Command+Tab' },
  { label: 'Switch apps backwards', accelerator: 'Command+Shift+Tab' },
  { label: 'Emoji and symbols', accelerator: 'Control+Command+Space' },
  { label: 'Full screen', accelerator: 'Control+Command+F' },
]

/** A row of "Used by macOS" (D3, D8): this Mac's key, and whether the user set it on this Mac (not the Mac's default). */
export interface SystemHotkey {
  label: string
  accelerator: string
  changedOnThisMac?: true
}
