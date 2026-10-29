/**
 * The mouse tips of Settings › Hotkeys (GRO-2067 Q4; a Settings page since YAZ-1679), and `shortLabel`. Every KEY
 * is a row of `shared/keys/` (YAZ-3564 K1), grouped by place there; this file keeps only the clicks and drags,
 * which have no key.
 */

export interface HotkeyEntry {
  keys: string
  label: string
}

export const MOUSE_TIPS: readonly HotkeyEntry[] = [
  { keys: 'Click glyph', label: 'Zoom into that bullet' },
  { keys: 'Click line', label: 'Collapse direct children / fully expand their subtree' },
  { keys: 'Click chevron', label: 'Fold / unfold that bullet or heading section' },
  { keys: 'Drag 6 dots', label: 'Move block — a multi-block selection moves together' },
  { keys: '/', label: 'Block menu, in an empty paragraph' },
  // Links C (GRO-2192): the editor's [[wiki link]] click model; the ⌘-click line is SHARED
  // with the sidebar's I3 gesture — one convention, one tip.
  { keys: 'Click link', label: 'Open that wiki link in the current tab — a missing note is created first' },
  { keys: '⌘-click file or link', label: 'Open it in a background tab — a table name or board card too' },
  // YAZ-1557: a board card is a cell — click selects, the title opens — and ⌥ is the right-panel key on both views.
  { keys: 'Click card', label: 'Select it — the title opens the note in the current tab' },
  { keys: '⌥-click name or card', label: 'Open it in the right panel' },
  // The multi-select gesture (YAZ-1336 🔒 D2, folders too since YAZ-1578) and what it is FOR
  // (YAZ-1337): the two plural menu items and ⌘⇧C above. Shift toggles one row at a time — it
  // never opens anything and never folds a folder.
  { keys: '⇧-click file or folder', label: 'Add or remove it from a multi-selection — right-click for Copy N paths / Open N in new tabs' },
  { keys: 'Right-click file', label: 'Cut / Copy / Paste, Copy path, New note…, Open in ▸ (new window, VS Code, default app, Finder)' },
  // The vault menu (YAZ-1798): the sidebar header's vault name, or any vault in the ⌘O switcher.
  { keys: 'Right-click vault', label: 'Open in this window, Set display name, Set shortcut, Copy vault name / path, Reveal in Finder, VS Code, Remove from recents' },
  // YAZ-3059 D3: the tab strip's own name gesture — the same field as the tab menu's "Set display name".
  { keys: 'Double-click tab', label: 'Set its display name — ⏎ saves, Esc cancels; a preview tab is kept' },
]

/** "Select it — the title opens…" → "Select it": a tip's label in one short line, for its row id. */
export const shortLabel = (label: string): string => label.split(/ — |: | \(/)[0]
