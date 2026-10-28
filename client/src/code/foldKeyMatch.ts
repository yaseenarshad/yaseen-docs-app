/**
 * A keydown read as one of the note's fold keys (YAZ-3478), for a code tab. The table is the note's own,
 * `FOLD_KEYS` (`editor/outline/foldKeys.ts`); this matcher sits in the code tab's lazy chunk so the
 * eager chunk carries only the table.
 */
import { FOLD_KEYS } from '../editor/outline/foldKeys'

export type FoldKeyId = keyof typeof FOLD_KEYS

/** The parts of a keydown a key name is matched on. */
export interface FoldKeyPress {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Whether `event` is the ProseMirror key `name` (`Mod-Shift-u`, `Mod-ArrowUp`): the same modifiers, no
 * more, and the same key. A letter also matches by its `code`, so a keyboard layout or ⌥ that changes
 * `key` still matches, as ProseMirror's keymap falls back to the base key.
 */
export function keyMatches(event: FoldKeyPress, name: string, mac: boolean): boolean {
  const parts = name.split('-')
  const base = parts.pop() ?? ''
  const want = { meta: false, ctrl: false, alt: false, shift: false }
  for (const part of parts) {
    if (part === 'Mod') want[mac ? 'meta' : 'ctrl'] = true
    else if (part === 'Cmd' || part === 'Meta') want.meta = true
    else if (part === 'Ctrl') want.ctrl = true
    else if (part === 'Alt') want.alt = true
    else if (part === 'Shift') want.shift = true
  }
  if (event.metaKey !== want.meta || event.ctrlKey !== want.ctrl || event.altKey !== want.alt || event.shiftKey !== want.shift) return false
  if (/^[a-z]$/i.test(base)) return event.key.toLowerCase() === base.toLowerCase() || event.code === `Key${base.toUpperCase()}`
  return event.key === base
}

/** Which fold key `event` is, or null. */
export function foldKeyOf(event: FoldKeyPress, mac: boolean, keys: Readonly<Record<FoldKeyId, string>> = FOLD_KEYS): FoldKeyId | null {
  return (Object.keys(keys) as FoldKeyId[]).find((id) => keyMatches(event, keys[id], mac)) ?? null
}

/** A key name as a Mac menu shows it (`Mod-Shift-u` → ⌘⇧U), for a menu's hint. */
export function foldKeyHint(name: string): string {
  const parts = name.split('-')
  const base = parts.pop() ?? ''
  const glyph: Record<string, string> = { Mod: '⌘', Cmd: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
  return `${parts.map((p) => glyph[p] ?? '').join('')}${arrows[base] ?? base.toUpperCase()}`
}
