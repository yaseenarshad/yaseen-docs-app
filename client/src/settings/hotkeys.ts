/**
 * The built-in clicks and drags of Settings › Hotkeys (GRO-2067 Q4; a Settings page since YAZ-1679), and `shortLabel`.
 * Every KEY is a row of `shared/keys/` (YAZ-3564 K1); the clicks the user can change are `shared/keys/gestures.ts`
 * (YAZ-3936: "Links in a note" and "Bullet dots"). This file keeps the rest, which are built in: the page shows each
 * on its gesture's card ("Click", "⌘-click", "Drag"…) with its place's tag, as a built-in key is shown.
 */

export interface MouseTip {
  /** The gesture as the page writes it: its card ("Click", "⌘-click", "Right-click", "Drag"). */
  gesture: string
  /** Where it works: the box's tag. */
  place: string
  label: string
}

export const MOUSE_TIPS: readonly MouseTip[] = [
  { gesture: 'Click', place: 'Bullet lines', label: 'Collapse direct children / fully expand their subtree' },
  { gesture: 'Click', place: 'Fold arrows', label: 'Fold / unfold that bullet or heading section' },
  { gesture: 'Drag', place: '6 dots', label: 'Move block — a multi-block selection moves together' },
  { gesture: '/', place: 'Notes', label: 'Block menu, in an empty paragraph' },
  // The sidebar's I3 gesture, and the folder views' (YAZ-1557). Links in a note have their own rows (YAZ-3936).
  { gesture: '⌘-click', place: 'Sidebar, tables and boards', label: 'Open it in a background tab — a file row, a table name or a board card' },
  // YAZ-1557: a board card is a cell — click selects, the title opens — and ⌥ is the right-panel key on both views.
  { gesture: 'Click', place: 'Board cards', label: 'Select it — the title opens the note in the current tab' },
  { gesture: '⌥-click', place: 'Tables and boards', label: 'Open a name or a card in the right panel' },
  // The multi-select gesture (YAZ-1336 🔒 D2, folders too since YAZ-1578) and what it is FOR
  // (YAZ-1337): the two plural menu items and ⌘⇧C above. Shift toggles one row at a time — it
  // never opens anything and never folds a folder.
  { gesture: '⇧-click', place: 'Sidebar', label: 'Add a file or folder to a multi-selection, or remove it — right-click for Copy N paths / Open N in new tabs' },
  { gesture: 'Right-click', place: 'Sidebar', label: 'Cut / Copy / Paste, Copy path, New note…, Open in ▸ (new window, VS Code, default app, Finder)' },
  // The vault menu (YAZ-1798): the sidebar header's vault name, or any vault in the ⌘O switcher.
  { gesture: 'Right-click', place: 'Vaults', label: 'Open in this window, Set display name, Set shortcut, Copy vault name / path, Reveal in Finder, VS Code, Remove from recents' },
  // YAZ-3059 D3: the tab strip's own name gesture — the same field as the tab menu's "Set display name".
  { gesture: 'Double-click', place: 'Tabs', label: 'Set its display name — ⏎ saves, Esc cancels; a preview tab is kept' },
]

/** "Select it — the title opens…" → "Select it": a tip's label in one short line, for its row id. */
export const shortLabel = (label: string): string => label.split(/ — |: | \(/)[0]
