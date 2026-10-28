/**
 * Hotkey reference (GRO-2067 Q4; a Settings page since YAZ-1679): the display tables of the BUILT-IN keys.
 * The keys the user can change are not here: they live in `shared/hotkeyBindings.ts` (YAZ-3397 D2, below).
 * Settings › Hotkeys renders these tables one row per key, and the settings search indexes every label and
 * key, so "close tab" finds the ROW (YAZ-3397 D5). When a keymap changes anywhere (editor/outline/hotkeys.ts,
 * foldAllHotkeys.ts, headingHotkeys.ts, zoom.ts, toc/TableOfContents.tsx, marks/underline.ts, marks/highlight.ts,
 * listCommands.ts, lineSelection.ts, views/view/*, the application menu in desktop/src/main/menu.ts), update HOTKEYS
 * (or VIEW_HOTKEYS / WINDOW_HOTKEYS) with it — `VIEW_HOTKEYS` is the folder view surface's own
 * set (table / cards / outline bindings); it was `BASES_HOTKEYS` under the heading "Bases" until
 * YAZ-861 renamed both to what they describe. hotkeys.test.ts pins the expected set so drift fails
 * loudly. Until YAZ-1679 this lived in sidebar/HotkeysPanel.tsx beside a keyboard-icon popover.
 *
 * The keys the user can CHANGE are not here (YAZ-3397 D2): they are `HOTKEY_COMMANDS` in
 * `shared/hotkeyBindings.ts`, which the Window group lists first, each with its key as a button. What is
 * left here is built in — the Settings page shows it as text — and `BUILT_IN_KEYS` reads these same
 * tables back into accelerators, so the recorder knows which keys are taken.
 */
import { APP_STANDARD_KEYS, MENU_FIXED_KEYS, keysOfDisplay, sameKey, toDisplay, type FixedKey } from '@shared/hotkeyBindings'

export interface HotkeyEntry {
  keys: string
  label: string
}

export const HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘↑ / ⌘↓', label: 'Fold / unfold the bullet or heading section at the caret — in a code file, the block at the cursor' },
  { keys: '⌘⇧U', label: 'Fold all bullets and headings — in a code file, every block' },
  { keys: '⌘⇧I', label: 'Unfold all bullets and headings — in a code file, every block' },
  { keys: '⌘Z', label: 'Undo — also reverts the latest fold or zoom' },
  { keys: '⌘⇧Z', label: 'Redo' },
  { keys: '⌘.', label: 'Zoom into the bullet at the caret' },
  { keys: '⌘⇧.', label: 'Zoom out one level' },
  { keys: '⌘J', label: 'Table of contents: ↑ ↓ pick a name, ⏎ goes to it, Esc closes' },
  { keys: '⌘+ / ⌘− / ⌘0', label: 'Zoom this note in / out (25 at a time above 200%) / back to 100% — outside a note, the sidebar' },
  { keys: '⌘⏎', label: 'Cycle bullet → task → done' },
  { keys: '⌘U', label: 'Underline' },
  { keys: '⌘⇧H', label: 'Highlight' },
  { keys: '⌘⇧X', label: 'Strikethrough' },
  { keys: '⌘⇧V', label: 'Paste as plain text' },
  { keys: 'Tab / ⇧Tab', label: 'Indent / outdent bullet' },
  { keys: '⇧↑ / ⇧↓', label: 'Select to the end / start of this line, then one whole line per press' },
]

export const VIEW_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '↑ ↓ ← →', label: 'Move between table cells or board cards — Enter opens the note or edits the cell' },
  // One open rule for Table and Board (YAZ-1557): ⌘ = background tab (I3), ⌥ = right panel.
  { keys: '⌘⏎ / ⌥⏎', label: 'Open the selected note in a background tab / the right panel' },
  { keys: '⏎ / Esc', label: 'Commit / cancel a cell edit' },
  { keys: 'Esc', label: 'Cancel a card drag' },
]

/**
 * The BUILT-IN app/window shortcuts, under the changeable ones (YAZ-3397 D1): a vault's number (it has its own
 * "Set shortcut"), the sidebar's ⌘X / ⌘C / ⌘V (YAZ-1674), a move's ⌘Z / ⌘⇧Z (YAZ-3255), the selection's ⌘⌫
 * (YAZ-3272), the hidden twins of the tab keys and a review session's keys (YAZ-2322). New window, ⌘O, ⌘K, ⌘,,
 * ⌘B, ⌘⇧C, ⌘W, ⌘⇧W and ⌃Tab moved to `HOTKEY_COMMANDS` when they became changeable.
 */
export const WINDOW_HOTKEYS: readonly HotkeyEntry[] = [
  // A vault's number (YAZ-2555 D3): the Window menu owns the key, so it answers from any window.
  { keys: '⌘1 … ⌘9', label: 'Go to the vault with that number — right-click a vault to give it one' },
  // The file clipboard (YAZ-1674, D6): the sidebar's own chords, beside ⌘⇧C and like it about the
  // selection. One clipboard for every window, so a copy here pastes into another vault's window.
  { keys: '⌘X / ⌘C', label: 'Cut / copy the selected files and folders — pastes in any window, on any vault' },
  { keys: '⌘V', label: 'Paste beside the first selected row — into a folder, next to a file, or into the vault root with none' },
  // A move's undo list (YAZ-3255 D10): per window, the last 20 moves — a drag, a Paste of a Cut, a drop from Finder.
  // YAZ-3268 D17: a delete and a rename are steps of the same list.
  { keys: '⌘Z / ⌘⇧Z', label: 'Undo / redo the last move, delete or rename of files and folders — outside a note, a drawing, a diagram or a field, which keep their own' },
  // ⌘⌫ (YAZ-3272 D20): Finder's Move to Trash, on the undo's boundary; a plain ⌫ deletes nothing.
  { keys: '⌘⌫', label: 'Move the selected files and folders to the Trash — asks first unless "Confirm before deleting" is off; outside a note, a drawing, a diagram or a field, which keep their own' },
  // The hidden twins of Next / Previous tab (GRO-2232): they stay when the user changes ⌃Tab / ⌃⇧Tab.
  { keys: '⌘⇧] / ⌘⇧[', label: 'Next / previous tab' },
  // An upkeep review (YAZ-2322): live only while one is open, and they answer with the caret in the note.
  { keys: '⌘⇧⏎', label: 'In a review: still relevant — on to the next note' },
  { keys: '⌘⇧S', label: 'In a review: skip — the note comes back after the others' },
  { keys: 'Esc', label: 'Close the review and return to the tabs' },
]

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

/**
 * The shortcuts that only mean something with a DRAWING in front (YAZ-3037, YAZ-3028 D10; ported from
 * Draw). ⌘⇧E, ⌘⇧S and ⌘⇧L are the application menu's and grey out on any other tab; ⌘⇧S is still the
 * review's Skip while a review is open. ⌘S, ⌘F and ⌘C are bound on the drawing tab itself; ⌘F and ⌘C
 * (the canvas panel, YAZ-3038) step aside whenever the key could mean something else — which is why
 * ⌘C still copies a selection.
 */
export const CANVAS_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘⇧E', label: "Export image… — the engine's own PNG / SVG dialog; a diagram saves a PNG or SVG" },
  { keys: '⌘⇧S', label: 'Export Excalidraw drawing… — write a standalone .excalidraw with its images embedded' },
  { keys: '⌘⇧L', label: 'Share link — the drawing or diagram in front' },
  // Autosave already runs on a 500 ms timer, so this is "write it NOW" (Draw's 🔒 YAZ-1810).
  { keys: '⌘S', label: 'Save the drawing in front now — it autosaves anyway' },
  { keys: '⌘F', label: 'Open the Images tab of the canvas panel' },
  { keys: '⌘C', label: 'Open the Components tab of the canvas panel — when nothing is selected and no text is being edited' },
]

/**
 * A draw.io diagram in front (YAZ-3037; Draw's 🔒 YAZ-1802 D12b): Yasin's Excalidraw keys, mapped onto
 * draw.io (`diagrams/drawioProtocol.ts`). With nothing selected a letter is a tool; with a selection the
 * same letters colour it. ⌘B / ⌘U / ⌘S are draw.io's own, ⌘B passing to the sidebar when nothing is selected.
 */
export const DRAWIO_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: 'R / O / T', label: 'Rectangle / ellipse / text — with nothing selected' },
  { keys: 'A / D / L', label: 'Arrow / line — with nothing selected' },
  { keys: 'W / P / X', label: 'Freehand pen — with nothing selected' },
  {
    keys: 'T B W D R P A V U C E G Y O N',
    label: "Colour the selection (transparent, black, white, gray, red, pink, grape, violet, blue, cyan, teal, green, yellow, orange, bronze) — a shape's fill, a text's colour, a line's stroke, an image's border",
  },
  { keys: '⇧ + colour letter', label: "A shape's outline, a text's background" },
  { keys: '1 … 9, 0', label: 'Size the selection — text 12 to 128, anything else 48 to 1024 on its long side' },
  { keys: '⌘\\', label: 'Clear formatting' },
  { keys: '⌘⇧X', label: 'Strikethrough' },
  { keys: '⌘B / ⌘U', label: 'Bold / underline — ⌘B with nothing selected toggles the sidebar' },
  // draw.io's own save event, which the host turns into "write it NOW" (Draw's 🔒 YAZ-1802 D6).
  { keys: '⌘S', label: 'Save the diagram in front now — it autosaves anyway' },
  { keys: '⌘-scroll / pinch', label: 'Zoom — a plain scroll pans' },
  { keys: 'Right-click empty canvas', label: 'Grid on / off' },
]

/** The Mac's standard app keys (YAZ-3397 D1): the menu's roles, as `shared/hotkeyBindings.ts` lists them. */
export const APP_STANDARD_HOTKEYS: readonly HotkeyEntry[] = APP_STANDARD_KEYS.map(({ label, accelerator }) => ({ keys: toDisplay(accelerator), label }))

/**
 * The built-in groups as Settings › Hotkeys shows them, heading first — one place to add another (YAZ-3397 D8:
 * Window, with the changeable keys above these, then the rest; "Used by macOS" comes after them all). `id`
 * names the group's rows (`hotkey-<id>-<n>`) where the title is not one word.
 */
export const HOTKEY_GROUPS: readonly { id?: string; title: string; entries: readonly HotkeyEntry[] }[] = [
  { title: 'Window', entries: WINDOW_HOTKEYS },
  { title: 'Keyboard', entries: HOTKEYS },
  { title: 'Views', entries: VIEW_HOTKEYS },
  { id: 'canvas', title: 'Excalidraw canvas', entries: CANVAS_HOTKEYS },
  { id: 'drawio', title: 'draw.io diagram', entries: DRAWIO_HOTKEYS },
  { title: 'Mouse', entries: MOUSE_TIPS },
  { id: 'standard', title: 'App standard', entries: APP_STANDARD_HOTKEYS },
]

/** "Table of contents: ↑ ↓ pick…" → "Table of contents": a built-in key's name in one short line (D5's answer). */
export const shortLabel = (label: string): string => label.split(/ — |: | \(/)[0]

/**
 * Every built-in KEY (YAZ-3397 D6) as an accelerator, read back from the tables above: '⌘X / ⌘C' is two
 * keys, '⌘1 … ⌘9' nine, a mouse tip none. Then each fixed key of the menu that no table names (YAZ-3419:
 * the hidden ⌘= of Zoom In). The recorder will not give one of these to a command.
 */
const TABLE_KEYS: readonly FixedKey[] = HOTKEY_GROUPS.filter((g) => g.entries !== MOUSE_TIPS).flatMap(({ entries }) =>
  entries.flatMap(({ keys, label }) => keysOfDisplay(keys).map((accelerator) => ({ label: shortLabel(label), accelerator }))),
)
export const BUILT_IN_KEYS: readonly FixedKey[] = [...TABLE_KEYS, ...MENU_FIXED_KEYS.filter((m) => !TABLE_KEYS.some((t) => sameKey(t.accelerator, m.accelerator)))]
