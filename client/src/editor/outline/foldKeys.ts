/**
 * THE FOLD KEYS, in one table (YAZ-3478). A note's keymaps (`foldAllHotkeys.ts`, `hotkeys.ts`,
 * `headingHotkeys.ts`), a read-only note's keys (`readOnlyKeys.ts`) and a code tab (`CodeEditor.tsx`)
 * all read them here, so a code tab folds with exactly the keys a note does. The app's own keys win
 * in a code tab (YAZ-3439, "The app's own keys win in code tabs"): ⌘↑ / ⌘↓ fold there too.
 *
 * The names are ProseMirror's (`Mod` is ⌘ on a Mac, Ctrl elsewhere). These keys are built in: Settings ›
 * Hotkeys shows them as text (`settings/hotkeys.ts`), and no override changes them today.
 *
 * Only the table here: this module is in the eager chunk (the note keymaps), so the matcher a code tab
 * uses lives in its own lazy chunk (`code/foldKeyMatch.ts`). No import.
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
