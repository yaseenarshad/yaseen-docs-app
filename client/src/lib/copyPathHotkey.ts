import { windowChordFor, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { ownsWindowChord } from './windowChord'

/**
 * Renderer ownership policy for YAZ-1338's ⌘⇧C copy-path chord — the file clipboard's sibling
 * (`fileClipboardHotkey.ts`), and deliberately not a second opinion about what "editing" means: both
 * ask `ownsWindowChord`, so a field, a contenteditable or an open modal tool that keeps ⌘X keeps this
 * one too. (Toggle sidebar was the renderer's ⌘B until YAZ-3564 D10; it is the menu's ⌘⇧B now.)
 *
 * The SHIFT is required, not tolerated: plain ⌘C is the copy every editor and every list already
 * owns, and this chord must never shadow it.
 */
export function ownsCopyPathHotkey(event: KeyboardEvent, overrides: HotkeyOverrides = {}): boolean {
  // The key is the user's (YAZ-3397 D2): ⌘⇧C unless they changed it, nothing with "No key".
  return ownsWindowChord(event, windowChordFor('copyPath', overrides))
}
