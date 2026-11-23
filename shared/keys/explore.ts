/**
 * The explore stack's keys (YAZ-2571 round 3): the ‹ › steps of a page layer opened from a search. Each row has a
 * bare key for reading (← / →: the caret's keys while a field or the editor has the keyboard, so they step only
 * while reading) and a chord that works in any mode (⌘⌥↓ / ⌘⌥↑, the cell note's steps). `ExploreStack` reads them.
 * The Tile layouts (YAZ-4944, `explore/tile.ts`): ⌥⌘2 … ⌥⌘5 and ⌥⌘0. A page layer in EDIT keeps the editor's own
 * ⌥⌘digit (a heading, Text): the stack leaves a key the editor took.
 */
import type { KeyRow } from './types'

const explore = (id: string, label: string, keys: readonly string[], hint: string): KeyRow => ({ id: `explore.${id}`, scope: 'explore', label, hint, keys, changeable: true })

export const EXPLORE_KEYS: readonly KeyRow[] = [
  explore('nextResult', 'Next search result', ['Right', 'CmdOrCtrl+Alt+Down'], 'In a page opened from a search: the next result in its place. → only while reading'),
  explore('previousResult', 'Previous search result', ['Left', 'CmdOrCtrl+Alt+Up'], 'In a page opened from a search: the result before, in its place. ← only while reading'),
  explore('tileTwo', 'Tile: side by side', ['CmdOrCtrl+Alt+2'], 'The two pages or boards used last, side by side'),
  explore('tileThree', 'Tile: three across', ['CmdOrCtrl+Alt+3'], 'The three pages or boards used last, across'),
  explore('tileGrid', 'Tile: grid', ['CmdOrCtrl+Alt+4'], 'The four pages or boards used last, in a 2 × 2 grid'),
  explore('tileGridCentre', 'Tile: grid + centre', ['CmdOrCtrl+Alt+5'], 'The five used last: a 2 × 2 grid and the last one in the middle'),
  explore('tileStack', 'Tile: stack', ['CmdOrCtrl+Alt+0'], 'Every window back to its stack place'),
]
