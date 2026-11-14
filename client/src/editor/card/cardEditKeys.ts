/**
 * The keys of Edit card (YAZ-5034), in the row under its editor (`cardBlockView.ts`, `cardKeyRow`). In a file of its
 * own, with no imports, so the card course's copy of the editor (YAZ-5121) shows the same keys without loading the
 * editor. `keyWords.ts` writes them in words: "Cmd + L hide word".
 */
export const CARD_EDIT_KEYS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '⌘L', label: 'hide word' },
  { keys: '⌘⇧↵', label: 'new side' },
  { keys: '⌘↵ / esc', label: 'Done' },
]
