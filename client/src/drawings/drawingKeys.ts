/**
 * THE USER'S DRAWING KEYS, AS THE ENGINE HEARS THEM (YAZ-3564 K5). `settings.hotkeys` holds only the user's
 * changes; each changed drawing row that is an engine action or a tool (`DRAWING_ACTIONS`) becomes one
 * `keyBindings` entry: its default chords, which the engine's handlers test for, and the user's chords. The
 * engine (`engine/packages/excalidraw/keyRemap.ts`) does the rest, at once (K4). The app's own drawing keys
 * (Save now, the canvas panel's tabs) test a keydown against the list here (`pressed`).
 */
import { fromKeyEvent, parseAccelerator, sameKey, type HotkeyOverrides, type KeyPress } from '@shared/hotkeyBindings'
import { clashesOf, keyRow, keysOf, type HotkeyAside, type KeyRow } from '@shared/keys'
import { DRAWING_ACTIONS, DRAWING_KEYS } from '@shared/keys/drawing'

/** The engine's `KeyChord` (`keyRemap.ts`); `shared/` and this file name no engine type. */
export interface EngineKeyChord {
  code: string
  key: string
  name: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}
export interface EngineKeyBinding {
  name: string
  defaults: readonly EngineKeyChord[]
  keys: readonly EngineKeyChord[]
}

/** Named keys and punctuation, as `KeyboardEvent.code` and the label the engine shows. */
const CODES: Record<string, { code: string; key: string; name?: string }> = {
  Up: { code: 'ArrowUp', key: 'ArrowUp', name: '↑' },
  Down: { code: 'ArrowDown', key: 'ArrowDown', name: '↓' },
  Left: { code: 'ArrowLeft', key: 'ArrowLeft', name: '←' },
  Right: { code: 'ArrowRight', key: 'ArrowRight', name: '→' },
  Enter: { code: 'Enter', key: 'Enter' },
  Escape: { code: 'Escape', key: 'Escape', name: 'Esc' },
  Tab: { code: 'Tab', key: 'Tab' },
  Space: { code: 'Space', key: ' ' },
  Backspace: { code: 'Backspace', key: 'Backspace' },
  Delete: { code: 'Delete', key: 'Delete' },
  Home: { code: 'Home', key: 'Home' },
  End: { code: 'End', key: 'End' },
  PageUp: { code: 'PageUp', key: 'PageUp' },
  PageDown: { code: 'PageDown', key: 'PageDown' },
  '-': { code: 'Minus', key: '-' },
  '=': { code: 'Equal', key: '=' },
  '[': { code: 'BracketLeft', key: '[' },
  ']': { code: 'BracketRight', key: ']' },
  '\\': { code: 'Backslash', key: '\\' },
  ';': { code: 'Semicolon', key: ';' },
  "'": { code: 'Quote', key: "'" },
  ',': { code: 'Comma', key: ',' },
  '.': { code: 'Period', key: '.' },
  '/': { code: 'Slash', key: '/' },
  '`': { code: 'Backquote', key: '`' },
}
/** What ⇧ types on a US keyboard: the `key` of a ⇧ chord, as the engine's handlers read it ('⌘⇧,' is '<'). */
const SHIFTED: Record<string, string> = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~' }

const isMac = (): boolean => /Mac|iPod|iPhone|iPad/.test(navigator.platform)

/** An accelerator as the keydown it is: ⌘ is `metaKey` on a Mac (the engine's `CTRL_OR_CMD`); null for one it cannot press. */
export function toEngineChord(accelerator: string): EngineKeyChord | null {
  const chord = parseAccelerator(accelerator)
  if (chord === null) return null
  const plus = chord.key === 'Plus'
  const base = plus ? '=' : chord.key
  const shift = chord.shift || plus
  const mods = { metaKey: chord.cmd && isMac(), ctrlKey: chord.ctrl || (chord.cmd && !isMac()), altKey: chord.alt, shiftKey: shift }
  if (/^[A-Z]$/.test(base)) return { code: `Key${base}`, key: shift ? base : base.toLowerCase(), name: base, ...mods }
  if (/^\d$/.test(base)) return { code: `Digit${base}`, key: shift ? SHIFTED[base] : base, name: base, ...mods }
  if (/^F\d{1,2}$/.test(base)) return { code: base, key: base, name: base, ...mods }
  const named = CODES[base]
  if (named === undefined) return null
  return { code: named.code, key: shift ? (SHIFTED[base] ?? named.key) : named.key, name: plus ? '+' : (named.name ?? base), ...mods }
}

const chords = (keys: readonly string[]): EngineKeyChord[] => keys.flatMap((k) => toEngineChord(k) ?? [])

/**
 * Whether an App command the user can change holds `key` on a drawing (YAZ-3564 K3, K9): the menu runs it, so the
 * engine must let the key go. The page sees a key before the menu and the engine takes every key it knows, so a key
 * it kept would never reach the menu (⌘D with Show in sidebar's switch off). Code (`appCommandOf`) and draw.io
 * (`menuChords`) let these keys go the same way. The fixed menu keys (the zoom, the board items) stay the engine's.
 */
const menuTakes = (row: KeyRow, key: string, overrides: HotkeyOverrides | undefined, aside: HotkeyAside | undefined): boolean =>
  clashesOf(row, key, overrides, aside).some((other) => other.scope === 'app' && other.changeable && other.passesToPages !== true)

/**
 * The engine's `keyBindings`: one per drawing action or tool row the user changed, or whose key an App command
 * takes (`menuTakes`), with that key left out; [] while nothing changed.
 */
export function drawingKeyBindings(overrides: HotkeyOverrides | undefined, aside?: HotkeyAside): EngineKeyBinding[] {
  return DRAWING_KEYS.flatMap((row) => {
    const name = DRAWING_ACTIONS[row.id]
    if (!row.changeable || typeof name !== 'string') return []
    const now = keysOf(row, overrides)
    const free = now.filter((k) => !menuTakes(row, k, overrides, aside))
    if (overrides?.[row.id] === undefined && free.length === now.length) return []
    return [{ name, defaults: chords(row.keys), keys: chords(free) }]
  })
}

/** The drawing keys as the engine gets them, as one string: a settings write that moves none keeps the engine's prop. */
export const drawingKeysKey = (overrides: HotkeyOverrides | undefined, aside?: HotkeyAside): string => JSON.stringify(drawingKeyBindings(overrides, aside))

/** Whether a keydown is one of a drawing row's keys now (the app's own keys: Save now, the panel tabs). */
export function pressed(event: KeyPress, id: string, overrides: HotkeyOverrides | undefined): boolean {
  const row = keyRow(id)
  const key = fromKeyEvent(event)
  return row !== undefined && key !== null && keysOf(row, overrides).some((k) => sameKey(k, key))
}
