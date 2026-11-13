/**
 * Keys in words (YAZ-5035, Yaseen: "no one ever knows what these are, i think u have to write them as CMD+SHIFT"):
 * ONE helper turns a key binding into the names a hint row shows, each its own keycap, joined by "+":
 * `⌘⇧↵` and `Mod-Shift-Enter` are both Cmd + Shift + Enter. Every key hint row uses it (Edit card's row and its
 * head's Done, the Inbox's key row, Explore's head). The app's MENUS keep the macOS symbols (⌘K): macOS menus show
 * keys that way.
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
}

const word = (name: string): string => NAMES[name.toLowerCase()] ?? (name.length === 1 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1))

/**
 * One key binding, its keycaps in order: `⌘⇧↵` → Cmd, Shift, Enter; `Mod-Shift-Enter` → the same; `⌘L` → Cmd, L;
 * `esc` → Esc. A binding with `-` between names is read as CodeMirror's; else each symbol is a key, and the rest is one.
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

/** "Cmd + Shift + Enter": a binding in words, as plain text (a title, a test). */
export const keyText = (binding: string): string => keyWords(binding).join(' + ')

/**
 * A hint's keys: one binding, or a choice of them (`← →`, `⌘↵ / esc`) split on spaces or `/`. Each choice, its
 * keycaps: `← →` → [[Left], [Right]].
 */
export const keyChoices = (keys: string): string[][] =>
  keys
    .split(/\s*\/\s*|\s+/)
    .filter((k) => k !== '')
    .map(keyWords)

/** A hint's keys in the DOM (no React): a `<kbd>` per key, " + " between two, " / " between two choices. */
export function keyCapsDom(keys: string): DocumentFragment {
  const out = document.createDocumentFragment()
  keyChoices(keys).forEach((caps, i) => {
    if (i > 0) out.append(' / ')
    caps.forEach((cap, j) => {
      if (j > 0) out.append(' + ')
      const k = document.createElement('kbd')
      k.textContent = cap
      out.append(k)
    })
  })
  return out
}
