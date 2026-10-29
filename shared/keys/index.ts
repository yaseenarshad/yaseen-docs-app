/**
 * EVERY KEY OF THE APP (YAZ-3564 K1), and the rule for when two of them fight (K3). One row per action of one
 * place (`types.ts`); the user's changes are `SettingsState.hotkeys` (K2) and the step-aside switches
 * `SettingsState.hotkeysAside` (K9). Pure and Electron-free: main, the renderer and the tests read it alike.
 */
import { isUsableKey, normalizeKey, parseAccelerator, sameKey, scopedId, type HotkeyOverrides } from '../hotkeyBindings'
import { APP_KEYS } from './app'
import { CODE_KEYS } from './code'
import { DIAGRAM_KEYS } from './diagram'
import { DRAWING_KEYS } from './drawing'
import { NOTE_KEYS } from './note'
import type { AsidePlace, KeyRow, KeyScope } from './types'
import { VIEW_KEYS } from './views'

export * from './types'

export const ALL_KEYS: readonly KeyRow[] = [...APP_KEYS, ...NOTE_KEYS, ...DRAWING_KEYS, ...DIAGRAM_KEYS, ...CODE_KEYS, ...VIEW_KEYS]

const BY_ID = new Map(ALL_KEYS.map((row) => [row.id, row]))
/** The row of an id, scoped or an old unscoped App id; undefined for an id this build does not have. */
export const keyRow = (id: string): KeyRow | undefined => BY_ID.get(scopedId(id))

/** The step-aside switches the user changed (K9): only the changes, by App row id; true = steps aside in drawings, diagrams and code. */
export type HotkeyAside = Partial<Record<string, boolean>>

/** The keys a row has now: the user's change (null = none), else its defaults. */
export function keysOf(row: KeyRow, overrides: HotkeyOverrides | undefined): readonly string[] {
  const own = overrides?.[row.id] !== undefined ? overrides[row.id] : row.scope === 'app' ? overrides?.[row.id.slice(4)] : undefined
  return own === undefined ? row.keys : own === null ? [] : [own]
}

/** Whether an App row lets `place` keep its own key on it (K9): the user's switch, else the row's default. A Mac standard key never does. */
export function stepsAside(row: KeyRow, place: KeyScope, aside: HotkeyAside | undefined): boolean {
  if (row.scope !== 'app' || row.macStandard === true || !(['drawing', 'diagram', 'code'] as string[]).includes(place)) return false
  const own = aside?.[row.id]
  return own === undefined ? (row.stepsAsideIn ?? []).includes(place as AsidePlace) : own
}

/**
 * Whether an App key wins in `place` at all. The page hears a key before the menu, so an App key wins only where the
 * editor lets it go: code and draw.io let every menu key go, a drawing only the App commands the user can change
 * (`drawingKeys.ts`), so a fixed menu key (the zoom, the board items) stays the drawing's. A Mac standard key wins everywhere.
 */
const menuWinsIn = (app: KeyRow, place: KeyScope): boolean => place !== 'drawing' || app.changeable || app.macStandard === true

/** The first step of a key: the key itself, or the first of a two-step code key. */
const firstStep = (key: string): string => key.split(' ')[0]

/**
 * The rows that could clash on a key, by its normal form: each row under its keys and under their first steps. Built
 * once per set of changes (the Hotkeys page asks for every row on each render; a scan of all rows per row was ~50 ms).
 */
let index: { overrides: HotkeyOverrides | undefined; byKey: Map<string, KeyRow[]> } | null = null
function rowsNear(key: string, overrides: HotkeyOverrides | undefined): KeyRow[] {
  if (index === null || index.overrides !== overrides) {
    const byKey = new Map<string, KeyRow[]>()
    const add = (k: string, row: KeyRow) => {
      const n = normalizeKey(k)
      if (n === null) return
      const list = byKey.get(n)
      if (list === undefined) byKey.set(n, [row])
      else if (list[list.length - 1] !== row) list.push(row)
    }
    for (const row of ALL_KEYS) for (const k of keysOf(row, overrides)) {
      add(k, row)
      add(firstStep(k), row)
    }
    index = { overrides, byKey }
  }
  const near = new Set([key, firstStep(key)].flatMap((k) => index?.byKey.get(normalizeKey(k) ?? '') ?? []))
  return [...near].sort((a, b) => (POSITION.get(a) ?? 0) - (POSITION.get(b) ?? 0))
}
const POSITION = new Map(ALL_KEYS.map((row, i) => [row, i]))

/**
 * The rows that keep `row` from firing with `key` (K3): a row of the same place with the same key; an App row with
 * it, or with its first step, since the editor lets it go to the menu (unless that App key steps aside in this place, K9);
 * and, for an App `key`, every row of a place that holds it, or begins with it. A Mac standard key blocks every place.
 */
export function clashesOf(row: KeyRow, key: string, overrides: HotkeyOverrides | undefined, aside: HotkeyAside | undefined, rows?: readonly KeyRow[]): KeyRow[] {
  // Only the rows on this key or its first step can clash; the order stays the list's.
  return (rows ?? rowsNear(key, overrides)).filter((other) => {
    if (other.id === row.id) return false
    const theirs = keysOf(other, overrides)
    if (other.scope === row.scope) return theirs.some((k) => sameKey(k, key))
    if (other.scope === 'app') return (other.onlyIn === undefined || other.onlyIn.includes(row.scope)) && menuWinsIn(other, row.scope) && !stepsAside(other, row.scope, aside) && theirs.some((k) => sameKey(k, firstStep(key)))
    if (row.scope === 'app') return row.passesToPages !== true && (row.onlyIn === undefined || row.onlyIn.includes(other.scope)) && menuWinsIn(row, other.scope) && !stepsAside(row, other.scope, aside) && theirs.some((k) => sameKey(firstStep(k), key))
    return false
  })
}

/** The rows that block a row's own key now (K3): each place's row shows "Blocked: <owner> fires first" while one does. */
export function blockersOf(row: KeyRow, overrides: HotkeyOverrides | undefined, aside: HotkeyAside | undefined, rows?: readonly KeyRow[]): KeyRow[] {
  if (row.scope === 'app') return []
  // An App key that hands its key to the page (an Edit role, the file clipboard) is no blocker (K3); recording still refuses it.
  return keysOf(row, overrides).flatMap((key) => clashesOf(row, key, overrides, aside, rows).filter((other) => other.scope === 'app' && other.passesToPages !== true))
}

/**
 * A key a row may take (K6): a drawing or diagram row takes a bare letter or digit (their tools are letters); every other row needs ⌘
 * or ⌃ (or ⌥, or an F-key), as an App key always did. Each step of a two-step key must be usable.
 */
export function isUsableFor(row: KeyRow, key: string): boolean {
  return key.split(' ').every((step) => {
    const chord = parseAccelerator(step)
    if (chord === null) return false
    if ((row.scope === 'drawing' || row.scope === 'diagram') && /^[A-Z0-9]$/.test(chord.key)) return true
    return isUsableKey(step) || chord.alt
  })
}
