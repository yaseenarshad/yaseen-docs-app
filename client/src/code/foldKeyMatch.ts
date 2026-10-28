/**
 * A keydown read as one of the note's fold keys (YAZ-3478), for a code tab. The table is the note's own,
 * `FOLD_KEYS` (`editor/outline/foldKeys.ts`), and the match is ProseMirror's own keymap (`keydownHandler`), as
 * a read-only note matches the same keys (`editor/readOnlyKeys.ts`): one matcher, the same rules as notes.
 */
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import type { EditorView } from '@milkdown/kit/prose/view'
import { FOLD_KEYS } from '../editor/outline/foldKeys'

export type FoldKeyId = keyof typeof FOLD_KEYS

/** The keymap's commands never read the view here: each one only names its key. */
const NO_VIEW = {} as EditorView

/** Which fold key `event` is, or null. The table is read at each press, so it is never copied. */
export function foldKeyOf(event: KeyboardEvent): FoldKeyId | null {
  let hit: FoldKeyId | null = null
  const bindings = Object.fromEntries((Object.keys(FOLD_KEYS) as FoldKeyId[]).map((id) => [FOLD_KEYS[id], () => ((hit = id), true)]))
  keydownHandler(bindings)(NO_VIEW, event)
  return hit
}

/** A key name as a Mac menu shows it (`Mod-Shift-u` → ⌘⇧U), for a menu's hint. */
export function foldKeyHint(name: string): string {
  const parts = name.split('-')
  const base = parts.pop() ?? ''
  const glyph: Record<string, string> = { Mod: '⌘', Cmd: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
  return `${parts.map((p) => glyph[p] ?? '').join('')}${arrows[base] ?? base.toUpperCase()}`
}
