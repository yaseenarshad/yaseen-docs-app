import { NOTE_PAGE, pageHoldsKeys } from './readOnlyCaret'
import { ownsWindowChord } from './windowChord'

export type FileClipboardVerb = 'copy' | 'cut' | 'paste' | 'undo' | 'redo'

/** Each verb's key, and whether Shift is part of its chord (YAZ-3255 D10: ⌘Z undoes a move, ⌘⇧Z redoes it). */
const VERBS: readonly (readonly [string, boolean, FileClipboardVerb])[] = [
  ['c', false, 'copy'],
  ['x', false, 'cut'],
  ['v', false, 'paste'],
  ['z', false, 'undo'],
  ['z', true, 'redo'],
]

/** The pages that keep their own undo (audit 22): a note, a drawing (Excalidraw), a diagram (draw.io). */
const OWN_UNDO = `${NOTE_PAGE}, .editor--drawing, .editor--diagram`

/**
 * Renderer ownership for the sidebar's file clipboard chords — ⌘C / ⌘X / ⌘V (D6 amended,
 * YAZ-1674) — `ownsCopyPathHotkey`'s sibling, and the same ONE boundary (`ownsWindowChord`): a
 * field, a contenteditable (the ProseMirror editor is one — text copy/paste keeps working) or an
 * open modal keeps the key, and Shift / ⌥ variants are never ours (⌘⇧C is Copy path). These are
 * WINDOW chords, like ⌘⇧C, because focus after a click on the open file sits in the editor
 * (YAZ-961's handoff) and blank space is not focusable at all — a listener on the panel never
 * heard them. ⌘ only, like every renderer chord here: the Ctrl spellings are the platform menu's.
 *
 * ⌘Z / ⌘⇧Z undo and redo a move (YAZ-3255 D10) on the same boundary, so the editor, a field, a
 * read-only note and a sheet keep their own text undo (S34) — and so does every page, a note, a
 * drawing or a diagram, also where its own history is empty and it lets the key pass (audit 22). Shift is part of a chord, never
 * merely tolerated: ⌘⇧C, ⌘⇧X and ⌘⇧V are none of ours.
 */
export function fileClipboardVerb(event: KeyboardEvent): FileClipboardVerb | null {
  // A page holds the keys (YAZ-3140): with the reader's selection in a note page, ⌘C copies its text.
  if (pageHoldsKeys(event.target)) return null
  for (const [key, shift, verb] of VERBS) {
    if (!ownsWindowChord(event, { key, shift })) continue
    // Each page keeps its own ⌘Z and ⌘⇧Z (audit 22), also one whose history is empty and lets the key pass.
    if ((verb === 'undo' || verb === 'redo') && event.target instanceof Element && event.target.closest(OWN_UNDO) !== null) return null
    return verb
  }
  return null
}
