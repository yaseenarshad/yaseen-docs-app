/**
 * ONE hotkey label (YAZ-5332, Yaseen: "it has the action first in parentheses what the hot key is"): every button,
 * key row, tooltip, empty state and settings line that names a key says it as "Done (Esc / Cmd+Enter)" — the action,
 * then its keys in brackets, in words (YAZ-5035: "no one ever knows what these are, i think u have to write them as
 * CMD+SHIFT"). `KeyLabel` (`client/src/keys/KeyLabel.tsx`) draws it with the keys quieter than the action.
 * A menu's own key column (the app's menus and macOS's) keeps the Mac symbols (⌘K), as macOS menus show keys; a click
 * gesture ("⌘-click") is Settings › Hotkeys' gestures' own, not a key.
 * Pure: the renderer, Settings and the tests read it alike.
 */

/** The symbol of a key, its word. */
const SYMBOLS: Record<string, string> = {
  '⌘': 'Cmd',
  '⇧': 'Shift',
  '⌥': 'Option',
  '⌃': 'Ctrl',
  '↵': 'Enter',
  '⏎': 'Enter',
  '↩': 'Enter',
  '⌫': 'Delete',
  '⌦': 'Delete',
  '⎋': 'Esc',
  '⇥': 'Tab',
  '←': 'Left',
  '→': 'Right',
  '↑': 'Up',
  '↓': 'Down',
}

/** A key's name as CodeMirror, ProseMirror or `KeyboardEvent.key` writes it (lower case), its word. */
const NAMES: Record<string, string> = {
  mod: 'Cmd',
  cmd: 'Cmd',
  meta: 'Cmd',
  command: 'Cmd',
  shift: 'Shift',
  alt: 'Option',
  option: 'Option',
  opt: 'Option',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Delete',
  delete: 'Delete',
  esc: 'Esc',
  escape: 'Esc',
  space: 'Space',
  ' ': 'Space',
  tab: 'Tab',
  arrowleft: 'Left',
  left: 'Left',
  arrowright: 'Right',
  right: 'Right',
  arrowup: 'Up',
  up: 'Up',
  arrowdown: 'Down',
  down: 'Down',
  // "Cmd++" reads as a typo: the zoom keys in words.
  '+': 'Plus',
  '-': 'Minus',
  '−': 'Minus',
}

const word = (name: string): string => NAMES[name.toLowerCase()] ?? (name.length === 1 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1))

/**
 * One key binding, its keys in order: `⌘⇧↵` → Cmd, Shift, Enter; `Mod-Shift-Enter` → the same; `⌘L` → Cmd, L;
 * `esc` → Esc. A binding with `-` between names is read as CodeMirror's; else each symbol is
 * a key, and the rest is one.
 */
export function keyWords(binding: string): string[] {
  const key = binding.trim()
  if (key === '') return []
  if (key.length > 1 && /^[A-Za-z]+(-.+)+$/.test(key)) return key.split(/-(?=.)/).map(word)
  const caps: string[] = []
  let rest = ''
  for (const ch of key) {
    if (SYMBOLS[ch] !== undefined) caps.push(SYMBOLS[ch])
    else rest += ch
  }
  if (rest.trim() !== '') caps.push(word(rest.trim()))
  return caps
}

/** "Cmd+Shift+Enter": one binding in words. */
export const keyText = (binding: string): string => keyWords(binding).join('+')

/**
 * A label's keys: one binding, or a choice of them (`← →`, `esc / ⌘↵`) split on spaces or `/`. Each choice, its keys:
 * `← →` → [[Left], [Right]].
 */
export const keyChoices = (keys: string): string[][] =>
  keys
    .split(/\s*\/\s*|\s+/)
    .filter((k) => k !== '')
    .map(keyWords)

/** "Esc / Cmd+Enter": a label's keys in words, the choices in the order given. */
export const keysText = (keys: string): string =>
  keyChoices(keys)
    .map((caps) => caps.join('+'))
    .join(' / ')

/** "Done (Esc / Cmd+Enter)": the action first, its keys (already in words) in brackets; just the action with none. */
export const labelWith = (action: string, words: string | null | undefined): string => (words == null || words === '' ? action : `${action} (${words})`)

/** "Done (Esc / Cmd+Enter)" from a label's keys (`keysText`); just the action with no keys. */
export const withKeys = (action: string, keys: string | null | undefined): string => labelWith(action, keys == null ? '' : keysText(keys))

/** Done's keys, where a Done leaves an edit (Explore's head, Edit card's head): "Done (Esc / Cmd+Enter)". */
export const DONE_KEYS = 'esc / ⌘↵'

