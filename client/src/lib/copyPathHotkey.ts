import { windowChordFor, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { ownsWindowChord } from './windowChord'

/**
 * Renderer ownership policy for YAZ-1338's ⌘⇧C copy-path chord — `ownsSidebarHotkey`'s sibling,
 * and deliberately not a second opinion about what "editing" means: both ask `ownsWindowChord`,
 * so a field, a contenteditable or an open modal tool that keeps ⌘B keeps this one too.
 *
 * The SHIFT is required, not tolerated: plain ⌘C is the copy every editor and every list already
 * owns, and this chord must never shadow it.
 */
export function ownsCopyPathHotkey(event: KeyboardEvent, overrides: HotkeyOverrides = {}): boolean {
  // The key is the user's (YAZ-3397 D2): ⌘⇧C unless they changed it, nothing with "No key".
  return ownsWindowChord(event, windowChordFor('copyPath', overrides))
}
