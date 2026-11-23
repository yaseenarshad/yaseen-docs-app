import { PAGE_SURFACE, pageHoldsKeys } from './readOnlyCaret'
import { ownsWindowChord } from './windowChord'

export type FileClipboardVerb = 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'delete'

/**
 * Each verb's key, and whether Shift is part of its chord (YAZ-3255 D10: ⌘Z undoes a move, ⌘⇧Z
 * redoes it). ⌘⌫ deletes the selection (YAZ-3272 D20), as Finder's Move to Trash: `Backspace` with
 * ⌘ only — a plain ⌫ is no verb, so a stray Backspace cannot start a delete.
 */
const VERBS: readonly (readonly [string, boolean, FileClipboardVerb])[] = [
  ['c', false, 'copy'],
  ['x', false, 'cut'],
  ['v', false, 'paste'],
  ['z', false, 'undo'],
  ['z', true, 'redo'],
  ['backspace', false, 'delete'],
]

/**
 * The pages that keep their own copy, cut and paste (YAZ-4372): a drawing (Excalidraw) and a diagram (draw.io). A page
 * keeps its own rules (D6, YAZ-3140). The Inbox screen (YAZ-4962) too: its ⌘Z undoes the last answer, never a file
 * move, and a copy there copies the card's text.
 */
const OWN_CLIPBOARD = '.editor--drawing, .editor--diagram, .card-inbox'

/** The pages that keep their own undo (audit 22) and their own ⌘⌫ (YAZ-3272 D20): a page, a drawing, a diagram. */
const OWN_UNDO = `${PAGE_SURFACE}, ${OWN_CLIPBOARD}`

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
 * read-only page and a sheet keep their own text undo (S34) — and so does every page, a page, a
 * drawing or a diagram, also where its own history is empty and it lets the key pass (audit 22). Shift is part of a chord, never
 * merely tolerated: ⌘⇧C, ⌘⇧X and ⌘⇧V are none of ours.
 *
 * ⌘⌫ deletes the sidebar selection (YAZ-3272 D20) on the same boundary, and every page that keeps
 * its own ⌘Z keeps its own ⌘⌫ too: in a page it deletes to the start of the line (S69).
 *
 * A board and a diagram keep ⌘C / ⌘X / ⌘V too (YAZ-4372), as they keep ⌘Z: the engine copies, cuts and pastes
 * its own elements and the system clipboard's picture or text. Its canvas is no field and no contenteditable,
 * so before this the window took the key, and its `preventDefault` stopped the `paste` event the board waits
 * for. The sidebar's file clipboard runs only when the focus is outside every board and diagram. A page page
 * keeps today's rules: its editor is a contenteditable, and `pageHoldsKeys` covers its other text. A paste whose
 * system clipboard no longer holds the copied files pastes no file anywhere: main's `clipNow` answers null (YAZ-4372).
 */
export function fileClipboardVerb(event: KeyboardEvent): FileClipboardVerb | null {
  // A page holds the keys (YAZ-3140): with the reader's selection in a page page, ⌘C copies its text.
  if (pageHoldsKeys(event.target)) return null
  for (const [key, shift, verb] of VERBS) {
    if (!ownsWindowChord(event, { key, shift })) continue
    // Each page keeps its own ⌘Z and ⌘⇧Z (audit 22), also one whose history is empty and lets the key pass; and its own ⌘⌫ (YAZ-3272 D20).
    // A board and a diagram keep their own ⌘C, ⌘X and ⌘V too (YAZ-4372): the board pastes the system clipboard's picture.
    const clipboardKey = verb === 'copy' || verb === 'cut' || verb === 'paste'
    if (event.target instanceof Element && event.target.closest(clipboardKey ? OWN_CLIPBOARD : OWN_UNDO) !== null) return null
    return verb
  }
  return null
}
