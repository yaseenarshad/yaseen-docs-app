/**
 * THE FOLD KEYS of a code tab (YAZ-3478; `code/foldKeyMatch.ts`, `CodeEditor.tsx`): the same defaults a note's fold
 * rows have (`shared/keys/note.ts`: `note.foldAll`, `note.unfoldAll`, `note.foldHere`, `note.unfoldHere`). A note's
 * keymaps (`foldAllHotkeys.ts`, `hotkeys.ts`, `headingHotkeys.ts`) and a read-only note's keys (`readOnlyKeys.ts`)
 * read those rows now, with the user's changes (YAZ-3564 K4), not this table. The app's own keys win
 * in a code tab (YAZ-3439, "The app's own keys win in code tabs"): ⌘↑ / ⌘↓ fold there too.
 *
 * The names are ProseMirror's (`Mod` is ⌘ on a Mac, Ctrl elsewhere).
 *
 * Only the table here, no import. A code tab matches it with ProseMirror's own keymap (`code/foldKeyMatch.ts`).
 */
export const FOLD_KEYS = {
  /** Fold every bullet and heading; in a code tab, every block. */
  foldAll: 'Mod-Shift-u',
  /** Unfold every bullet and heading; in a code tab, every block. */
  unfoldAll: 'Mod-Shift-i',
  /** Fold the bullet or heading section at the caret; in a code tab, the block at the cursor. */
  foldHere: 'Mod-ArrowUp',
  /** Unfold the same. */
  unfoldHere: 'Mod-ArrowDown',
} as const
