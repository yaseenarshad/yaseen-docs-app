/**
 * The note keys (YAZ-3564 K1, D11 of YAZ-3556): every key a note's editor binds, in the tab and the right panel (and a
 * folder view's outline, which is the same editor). They change when a note opens (K4): `client/src/editor/noteKeys.ts`
 * sets Milkdown's keymap slices from these rows, and the app's own note keymaps, ⌘F and ⌘J read them. The menu's note
 * keys (⌘+ / ⌘− / ⌘0, ⌘⇧V) are App rows. `noteKeys.test.ts` reads the editor's real keys and fails on one with no row.
 *
 * Built in (K6): the typing keys, the Mac's edit keys (⌘Z, ⌘A) and the keys inside a pop-up.
 */
import type { KeyRow } from './types'

const note = (id: string, label: string, keys: readonly string[], extra: Pick<KeyRow, 'hint'> & { builtIn?: true } = {}): KeyRow => ({
  id: `note.${id}`,
  scope: 'note',
  label,
  ...(extra.hint === undefined ? {} : { hint: extra.hint }),
  keys,
  changeable: extra.builtIn !== true,
})

const HEADINGS = [1, 2, 3, 4, 5, 6].map((n) => note(`heading${n}`, `Heading ${n}`, [`CmdOrCtrl+Alt+${n}`]))

export const NOTE_KEYS: readonly KeyRow[] = [
  // The marks (Milkdown's commonmark and gfm keymaps; underline and highlight are the app's).
  note('bold', 'Bold', ['CmdOrCtrl+B']),
  note('italic', 'Italic', ['CmdOrCtrl+I']),
  note('underline', 'Underline', ['CmdOrCtrl+U']),
  note('strikethrough', 'Strikethrough', ['CmdOrCtrl+Shift+X', 'CmdOrCtrl+Alt+X']),
  note('highlight', 'Highlight', ['CmdOrCtrl+Shift+H']),
  note('inlineCode', 'Inline code', ['CmdOrCtrl+E']),
  // The blocks.
  note('text', 'Text', ['CmdOrCtrl+Alt+0'], { hint: 'Turn the block into plain text' }),
  ...HEADINGS,
  // D10: ⌘⇧B is Toggle sidebar now.
  note('quote', 'Quote', []),
  note('codeBlock', 'Code block', ['CmdOrCtrl+Alt+C']),
  note('bulletList', 'Bullet list', ['CmdOrCtrl+Alt+8']),
  note('cycleTask', 'Cycle bullet → task → done', ['CmdOrCtrl+Enter'], { hint: 'On text or a heading outside a bullet: strikes the line through. In a table: leave the table' }),
  // The outline.
  note('indent', 'Indent bullet', ['CmdOrCtrl+]'], { hint: 'In a table: the next cell' }),
  note('outdent', 'Outdent bullet', ['CmdOrCtrl+['], { hint: 'In a table: the cell before' }),
  note('foldHere', 'Fold the bullet or heading section at the caret', ['CmdOrCtrl+Up']),
  note('unfoldHere', 'Unfold the bullet or heading section at the caret', ['CmdOrCtrl+Down']),
  note('foldAll', 'Fold all bullets and headings', ['CmdOrCtrl+Shift+U']),
  note('unfoldAll', 'Unfold all bullets and headings', ['CmdOrCtrl+Shift+I']),
  note('zoomIn', 'Zoom into the bullet at the caret', ['CmdOrCtrl+.']),
  note('zoomOut', 'Zoom out one level', ['CmdOrCtrl+Shift+.']),
  // YAZ-3653: Edit › Copy as › Without folded lines; no key by default, every free one is some editor's.
  note('copyVisible', 'Copy without folded lines', [], { hint: 'With nothing selected: the bullet at the caret' }),
  // The note's panels.
  note('find', 'Find in the note', ['CmdOrCtrl+F'], { hint: '⏎ / ⇧⏎ next / previous match, Esc closes' }),
  note('toc', 'Table of contents', ['CmdOrCtrl+J'], { hint: '↑ ↓ pick a name, ⏎ goes to it, Esc closes' }),
  // Built in: the Mac's edit keys.
  note('undo', 'Undo', ['CmdOrCtrl+Z'], { hint: 'Also reverts the latest fold or zoom', builtIn: true }),
  note('redo', 'Redo', ['CmdOrCtrl+Shift+Z', 'CmdOrCtrl+Y'], { builtIn: true }),
  note('selectAll', 'Select all the text of the note', ['CmdOrCtrl+A'], { builtIn: true }),
  // Built in: the typing keys.
  note('enter', 'New line, or a new bullet', ['Enter'], { hint: 'In a pop-up: pick the row', builtIn: true }),
  note('lineBreak', 'Line break inside the block', ['Shift+Enter'], { builtIn: true }),
  note('tab', 'Indent / outdent bullet', ['Tab', 'Shift+Tab'], { hint: 'In a table: the next / previous cell', builtIn: true }),
  note('delete', 'Delete backward / forward', ['Backspace', 'Delete', 'Shift+Backspace', 'Control+H', 'Control+D'], { hint: "Backspace at a line's start or Delete at its end: joins two lines (the upper format wins)", builtIn: true }),
  note('deleteMore', 'Delete backward / forward, then join the blocks', ['CmdOrCtrl+Backspace', 'Alt+Backspace', 'CmdOrCtrl+Delete', 'Alt+Delete', 'Control+Alt+Backspace', 'Alt+D'], { builtIn: true }),
  note('lineStartEnd', 'Select to the start / end of the block', ['Control+A', 'Control+E'], { builtIn: true }),
  note('selectLines', 'Select to the start / end of this line, then one whole line per press', ['Shift+Up', 'Shift+Down'], { builtIn: true }),
  note('escape', 'Back to the sidebar', ['Escape'], { hint: 'With a pop-up or the find bar open: close it', builtIn: true }),
  // Built in: the keys inside a pop-up (the [[ link picker, the / menu).
  note('popupMove', 'In a pop-up: move up / down the list', ['Up', 'Down'], { builtIn: true }),
]
