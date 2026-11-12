/**
 * The explore stack's keys (YAZ-2571 round 3): the ‹ › steps of a note layer opened from a search. Each row has a
 * bare key for reading (← / →: the caret's keys while a field or the editor has the keyboard, so they step only
 * while reading) and a chord that works in any mode (⌘⌥↓ / ⌘⌥↑, the cell note's steps). `ExploreStack` reads them.
 */
import type { KeyRow } from './types'

const explore = (id: string, label: string, keys: readonly string[], hint: string): KeyRow => ({ id: `explore.${id}`, scope: 'explore', label, hint, keys, changeable: true })

export const EXPLORE_KEYS: readonly KeyRow[] = [
  explore('nextResult', 'Next search result', ['Right', 'CmdOrCtrl+Alt+Down'], 'In a note opened from a search: the next result in its place. → only while reading'),
  explore('previousResult', 'Previous search result', ['Left', 'CmdOrCtrl+Alt+Up'], 'In a note opened from a search: the result before, in its place. ← only while reading'),
]
