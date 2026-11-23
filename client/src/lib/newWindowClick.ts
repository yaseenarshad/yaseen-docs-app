/**
 * ⇧⌘-click opens a file in a new window (YAZ-4444, D32 of YAZ-4278): the window the menu's "Open in ▸ New window" opens,
 * on the vault that holds the file. Settings › Hotkeys › "Files in lists" changes the gesture (`files.newWindow`).
 *
 * Every file row whose ⌘-click opens a background tab asks here FIRST, before its own rules: the sidebar tree (Files,
 * Search, Favorites, Focus), Recents, the new tab page, a backlink, a table's Name cell and a board's card. First, so
 * ⇧⌘ is not read as Shift: ⇧ alone stays the selection gesture (YAZ-1336 🔒 D2). A folder has no window (D2,
 * GRO-2168): its rows never ask. The binding and the window's vaults are read at the click, so a change works at once.
 */
import { gestureAction, type MouseMods } from '@shared/keys'
import { rootOfPath } from '@shared/types'
import { storage } from './storage'
import { openWindowOn } from './osVerbs'

/** Whether `event` is the "Open in a new window" click of a file now. */
export const isNewWindowClick = (event: MouseMods): boolean => gestureAction('files', event, storage.getSettings()?.hotkeys) === 'newWindow'

/** Opens `path` in a new window when `event` is that click: true when it was (the row does nothing more). */
export function newWindowClick(event: MouseMods, path: string): boolean {
  if (!isNewWindowClick(event)) return false
  openWindowOn(rootOfPath(storage.getRoots(), path), path)
  return true
}
