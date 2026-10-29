/**
 * THE NOTE KEYS AS THE USER SET THEM (YAZ-3564 K4): a changed note key works in the notes that open next.
 *
 * The rows are `NOTE_KEYS` (`shared/keys/note.ts`); `settings.hotkeys` holds only the changes. `createCrepe` takes
 * them once, before create (`CreateCrepeOptions.hotkeys`), so an open note keeps the keys it opened with. Three paths:
 *  - Milkdown's keymaps (and the app's highlight): each is a ctx slice Milkdown reads once, when the editor starts.
 *    `applyNoteKeys` rewrites the slices in `createCrepe`'s config, from `SLICE_ROWS` below. Crepe's toolbar labels its
 *    buttons from the same slices, so a tooltip shows the key as it is now (K12).
 *  - The app's own keymaps (`$shortcut`): `rowShortcuts` gives one entry per key a row has now (none with "No key"),
 *    read from `noteHotkeysCtx`.
 *  - The window listeners (⌘F, ⌘J): `isNoteKey` at each keydown, with `storage.getSettings()` read then.
 *
 * Keys are Electron accelerators in the list and ProseMirror key names in a keymap: `proseMirrorKey` turns one into the
 * other. The typing keys (no ⌘, ⌃ or ⌥) are built in (K6), so a keymap's `Tab` or `Enter` stays where it is.
 */
import type { KeymapItem } from '@milkdown/kit/core'
import { createSlice, type Ctx, type SliceType } from '@milkdown/kit/ctx'
import { historyKeymap } from '@milkdown/kit/plugin/history'
import {
  blockquoteKeymap,
  bulletListKeymap,
  codeBlockKeymap,
  emphasisKeymap,
  headingKeymap,
  inlineCodeKeymap,
  listItemKeymap,
  paragraphKeymap,
  strongKeymap,
} from '@milkdown/kit/preset/commonmark'
import { strikethroughKeymap, tableKeymap } from '@milkdown/kit/preset/gfm'
import type { KeymapConfig } from '@milkdown/kit/utils'
import { fromKeyEvent, parseAccelerator, sameKey, type HotkeyOverrides, type KeyPress } from '@shared/hotkeyBindings'
import { keyRow, keysOf } from '@shared/keys'
import { highlightKeymap } from './marks/highlight'

/** The user's key changes, for the editor being built: `createCrepe` injects them in its config. */
export const noteHotkeysCtx = createSlice<HotkeyOverrides, 'noteHotkeys'>({}, 'noteHotkeys')

const PM_KEY: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Plus: '+' }

/** An accelerator as ProseMirror names it: 'CmdOrCtrl+Shift+X' → 'Mod-Shift-x', 'CmdOrCtrl+Up' → 'Mod-ArrowUp'. */
export function proseMirrorKey(accelerator: string): string | null {
  const chord = parseAccelerator(accelerator)
  if (chord === null) return null
  const key = PM_KEY[chord.key] ?? (/^[A-Z]$/.test(chord.key) ? chord.key.toLowerCase() : chord.key)
  return [chord.cmd && 'Mod', chord.ctrl && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', key].filter(Boolean).join('-')
}

/** The keys a note row has now, as ProseMirror names them. */
export function noteKeys(id: string, overrides: HotkeyOverrides | undefined): string[] {
  const row = keyRow(id)
  if (row === undefined) throw new Error(`no key row ${id}`)
  return keysOf(row, overrides).flatMap((key) => proseMirrorKey(key) ?? [])
}

/** The changes of the editor `ctx` belongs to; none in an editor not built by `createCrepe`. */
export const noteOverrides = (ctx: Ctx): HotkeyOverrides => (ctx.isInjected(noteHotkeysCtx) ? ctx.get(noteHotkeysCtx) : {})

/**
 * A `$shortcut` entry per key row `id` has now: `{ [name]: …, [name#2]: … }`, nothing with "No key". The names only
 * have to be unique: Milkdown binds each entry by its `key`.
 */
export function rowShortcuts(ctx: Ctx, id: string, name: string, item: Omit<KeymapItem, 'key'>): Record<string, KeymapItem> {
  return Object.fromEntries(noteKeys(id, noteOverrides(ctx)).map((key, i) => [i === 0 ? name : `${name}#${i + 1}`, { ...item, key }]))
}

type Slice = SliceType<KeymapConfig<string>, string>
const slice = <K extends string>(s: SliceType<KeymapConfig<K>, string>): Slice => s as unknown as Slice

/** Each Milkdown keymap entry with a changeable key, and its row. One row may own entries of several keymaps (⌘] indents a bullet and moves to the next cell). */
const SLICE_ROWS: readonly (readonly [Slice, string, string])[] = [
  [slice(strongKeymap.key), 'ToggleBold', 'note.bold'],
  [slice(emphasisKeymap.key), 'ToggleEmphasis', 'note.italic'],
  [slice(inlineCodeKeymap.key), 'ToggleInlineCode', 'note.inlineCode'],
  [slice(strikethroughKeymap.key), 'ToggleStrikethrough', 'note.strikethrough'],
  [slice(highlightKeymap.key), 'ToggleHighlight', 'note.highlight'],
  [slice(paragraphKeymap.key), 'TurnIntoText', 'note.text'],
  ...[1, 2, 3, 4, 5, 6].map((n) => [slice(headingKeymap.key), `TurnIntoH${n}`, `note.heading${n}`] as const),
  [slice(blockquoteKeymap.key), 'WrapInBlockquote', 'note.quote'],
  [slice(codeBlockKeymap.key), 'CreateCodeBlock', 'note.codeBlock'],
  [slice(bulletListKeymap.key), 'WrapInBulletList', 'note.bulletList'],
  [slice(listItemKeymap.key), 'SinkListItem', 'note.indent'],
  [slice(listItemKeymap.key), 'LiftListItem', 'note.outdent'],
  [slice(tableKeymap.key), 'NextCell', 'note.indent'],
  [slice(tableKeymap.key), 'PrevCell', 'note.outdent'],
  [slice(tableKeymap.key), 'ExitTable', 'note.cycleTask'],
  [slice(historyKeymap.key), 'Undo', 'note.undo'],
  [slice(historyKeymap.key), 'Redo', 'note.redo'],
]

/** A ProseMirror key name with ⌘, ⌃ or ⌥: a key of a row. Without one it is typing (Tab, Enter, Backspace), built in. */
const isChord = (name: string): boolean => /(^|-)(Mod|Ctrl|Control|Alt|Meta|Cmd)-/.test(name)

/**
 * Set every Milkdown keymap slice from the rows (K4): an entry's chords become its row's keys now; its typing keys
 * stay. Runs in `createCrepe`'s config, after Milkdown injected the slices and before any keymap is read. Quote has
 * no default key (D10), so this also takes ⌘⇧B off it.
 */
export function applyNoteKeys(ctx: Ctx): void {
  const overrides = noteOverrides(ctx)
  for (const [keymap, entry, id] of SLICE_ROWS) {
    if (!ctx.isInjected(keymap)) continue
    ctx.update(keymap, (prev) => {
      const old = prev[entry]
      if (old === undefined) return prev
      const typing = [old.shortcuts].flat().filter((name) => !isChord(name))
      return { ...prev, [entry]: { ...old, shortcuts: [...typing, ...noteKeys(id, overrides)] } }
    })
  }
}

/** Whether a keydown is a key note row `id` has now, for a window listener (⌘F, ⌘J). The caller reads the settings at the keydown. */
export function isNoteKey(event: KeyPress, id: string, overrides: HotkeyOverrides | undefined): boolean {
  const pressed = fromKeyEvent(event)
  const row = keyRow(id)
  return pressed !== null && row !== undefined && keysOf(row, overrides).some((key) => sameKey(key, pressed))
}
