/**
 * THE KEY TABLE (YAZ-3397 D2): the app-wide commands whose key the user can change, and the one way an
 * accelerator is read, compared and shown. Only the GLOBAL commands are here (D1): a key that means
 * something only on a drawing, in a note or in a review stays built in, and so do the Mac's own roles.
 *
 * Keys are Electron accelerators ('CmdOrCtrl+Shift+W'), because the menu (`desktop/src/main/menu.ts`) is
 * where most of them are registered. `SettingsState.hotkeys` keeps ONLY the user's changes (`HotkeyOverrides`):
 * an id that is not there has its default, `null` is "No key", and a value equal to the default is never
 * stored (D6), so `{}` is the default and a reset deletes the entry.
 *
 * Two accelerators are the same key when `sameKey` says so: `CmdOrCtrl` and `Command` are one modifier on a
 * Mac, the modifiers' order does not count, and `Plus` is ⇧=. Pure and Electron-free: main, the renderer
 * and the tests read it alike.
 */

/** The changeable commands (YAZ-3397 D1), in the order Settings › Hotkeys lists them. */
export type HotkeyId =
  | 'newTab'
  | 'newWindow'
  | 'newFilesWindow'
  | 'newItem'
  | 'goTo'
  | 'dailyNote'
  | 'closeTab'
  | 'closeWindow'
  | 'switchVault'
  | 'openFolder'
  | 'search'
  | 'settings'
  | 'toggleSidebar'
  | 'copyPath'
  | 'tabOverview'
  | 'nextTab'
  | 'prevTab'
  | 'back'
  | 'forward'
  | 'keySheet'

export interface HotkeyCommand {
  id: HotkeyId
  /** Short, sentence case: the change pop-up says it ("Change the key for Search the vault?"). */
  label: string
  /** What the label does not say; shown muted under it. */
  hint?: string
  /** The default key, or null for none (Close window since YAZ-3357 D15). */
  key: string | null
  /** A key most Mac apps use for this (⌘T, ⌘W, ⌘, ⌘O, ⌘⇧N): moving it away asks harder (D6). */
  macStandard?: true
  /**
   * The renderer owns the key (`client/src/lib/windowChord.ts`), not the menu: no accelerator, and a draw.io
   * diagram keeps its own binding on it (`drawioProtocol.ts` clears only the menu's keys).
   */
  rendererOwned?: true
  /** The places that keep their own key on this one by default (YAZ-3564 K9): the menu drops it while one is in front. */
  stepsAsideIn?: readonly ('drawing' | 'diagram' | 'code')[]
}

export const HOTKEY_COMMANDS: readonly HotkeyCommand[] = [
  { id: 'newTab', label: 'New tab', key: 'CmdOrCtrl+T', macStandard: true },
  { id: 'newWindow', label: 'New window', hint: 'On the same vaults', key: 'CmdOrCtrl+Shift+N', macStandard: true },
  { id: 'newFilesWindow', label: 'New Files window', hint: 'The sidebar on its own, beside your windows', key: 'CmdOrCtrl+Shift+W' },
  // YAZ-3556 D1: the New… box (⌘N, the Mac's own New) and the jump to the place set in Settings › Sidebar (⌘D). Drawings,
  // diagrams and code keep their own ⌘D (Duplicate, Add next match) by default (YAZ-3564 K9).
  { id: 'newItem', label: 'New note, drawing or diagram…', hint: 'Pick the kind and the folder, then name it in the sidebar', key: 'CmdOrCtrl+N', macStandard: true },
  { id: 'goTo', label: 'Show in sidebar', hint: 'The tab, folder or file set in Settings › Sidebar › Show in sidebar, or today\'s daily note', key: 'CmdOrCtrl+D', stepsAsideIn: ['drawing', 'diagram', 'code'] },
  // YAZ-3607 D11: today's daily note on its own key, for a ⌘D set to another place. No key by default: ⌘D on "Today's
  // daily note" and the footer button reach it. It shows only while Daily notes is on (Settings › Files & Links).
  { id: 'dailyNote', label: "Open today's daily note", hint: 'Makes it first when today has none', key: null },
  { id: 'closeTab', label: 'Close tab', hint: 'On the last tab it empties the window, then closes it', key: 'CmdOrCtrl+W', macStandard: true },
  { id: 'closeWindow', label: 'Close window', key: null },
  { id: 'switchVault', label: 'Switch vault', hint: 'Type to filter, ⏎ brings it to the front or opens a new window, ⇧⏎ opens it in this window', key: 'CmdOrCtrl+O', macStandard: true },
  { id: 'openFolder', label: 'Open folder…', key: 'CmdOrCtrl+Shift+O' },
  { id: 'search', label: 'Search the vault', key: 'CmdOrCtrl+K' },
  { id: 'settings', label: 'Settings', key: 'CmdOrCtrl+,', macStandard: true },
  // A menu key since YAZ-3564 D10 (it was the renderer's ⌘B, which a note kept for Bold): it fires in a note too.
  { id: 'toggleSidebar', label: 'Toggle sidebar', hint: 'In a note, a drawing, a diagram and code too', key: 'CmdOrCtrl+Shift+B' },
  { id: 'copyPath', label: 'Copy path', hint: 'The row of the new tab page that the keyboard is on, else the sidebar selection when one is standing, else the open file', key: 'CmdOrCtrl+Shift+C', rendererOwned: true },
  { id: 'tabOverview', label: 'Tab overview', hint: 'The same key opens it and closes it', key: 'CmdOrCtrl+Shift+M' },
  { id: 'nextTab', label: 'Next tab', key: 'Control+Tab' },
  { id: 'prevTab', label: 'Previous tab', key: 'Control+Shift+Tab' },
  // YAZ-3647 D7: the window's one Back list. ⌘[ / ⌘] are outdent and indent, ⌘⇧[ / ⌘⇧] switch tabs.
  { id: 'back', label: 'Back', hint: 'The page or the zoom level you were on before', key: 'CmdOrCtrl+Alt+Left' },
  { id: 'forward', label: 'Forward', hint: 'Again, after Back', key: 'CmdOrCtrl+Alt+Right' },
  // YAZ-3564 K11: no key by default, since every free key is some editor's; Help › Keys of This Tab… and ? on a drawing open it too.
  { id: 'keySheet', label: 'Keys of this tab', hint: 'The keys of the note, drawing, diagram or code in front, with your changes', key: null },
]

/**
 * Only the user's changes (D2), for every key of the app (YAZ-3564 K2): by `<scope>.<name>` ('app.newTab', 'note.bold');
 * null = "No key". An id with no scope is an App command from before YAZ-3564 ('newTab'): it reads as 'app.newTab'.
 */
export type HotkeyOverrides = Partial<Record<string, string | null>>

/** The stored id of an App command (YAZ-3564 K2). */
export const appKeyId = (id: HotkeyId): string => `app.${id}`
/** Any stored id in its scoped form: an old App id gets `app.` in front. */
export const scopedId = (id: string): string => (id.includes('.') ? id : `app.${id}`)

export const HOTKEY_IDS: readonly HotkeyId[] = HOTKEY_COMMANDS.map((c) => c.id)
export const isHotkeyId = (v: unknown): v is HotkeyId => typeof v === 'string' && (HOTKEY_IDS as readonly string[]).includes(v)

export const hotkeyCommand = (id: HotkeyId): HotkeyCommand => HOTKEY_COMMANDS.find((c) => c.id === id) as HotkeyCommand

/** The key `id` has now: the user's change (scoped, or an old unscoped one), else the default. */
export function keyFor(id: HotkeyId, overrides: HotkeyOverrides | undefined): string | null {
  const own = overrides?.[appKeyId(id)] !== undefined ? overrides[appKeyId(id)] : overrides?.[id]
  return own === undefined ? hotkeyCommand(id).key : own
}

/**
 * `overrides` with `id` set to `key` (D6): a key equal to the default deletes the entry, so `{}` stays the
 * default. A new object; the old one is left as it was.
 */
export function withKey(overrides: HotkeyOverrides, id: HotkeyId, key: string | null): HotkeyOverrides {
  const next = { ...overrides }
  delete next[id] // an old unscoped entry goes: the scoped one is the change now (YAZ-3564 K2)
  const def = hotkeyCommand(id).key
  if (key === null ? def === null : def !== null && sameKey(key, def)) delete next[appKeyId(id)]
  else next[appKeyId(id)] = key
  return next
}

// ---------- reading an accelerator ----------

export interface Chord {
  cmd: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  /** Canonical: a letter upper case, a named key as `NAMED_KEYS` spells it, any other character itself. */
  key: string
}

/** Named keys, by the lower-case spellings Electron accepts, to the one spelling this file uses. */
const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  plus: 'Plus',
}

const MODIFIERS: Record<string, keyof Omit<Chord, 'key'>> = {
  cmdorctrl: 'cmd',
  commandorcontrol: 'cmd',
  command: 'cmd',
  cmd: 'cmd',
  super: 'cmd',
  meta: 'cmd',
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  altgr: 'alt',
  shift: 'shift',
}

function canonicalKey(token: string): string | null {
  if (token === '') return null
  const named = NAMED_KEYS[token.toLowerCase()]
  if (named !== undefined) return named
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(token)) return token.toUpperCase()
  if (token === '+') return 'Plus'
  return [...token].length === 1 ? token.toUpperCase() : null
}

/** An accelerator as its parts, or null when it is not one key with modifiers. */
export function parseAccelerator(accelerator: string): Chord | null {
  // 'CmdOrCtrl++' would split into an empty last part: that key is '+'.
  const tokens = accelerator.endsWith('++') ? [...accelerator.slice(0, -2).split('+'), '+'] : accelerator.split('+')
  const chord: Chord = { cmd: false, ctrl: false, alt: false, shift: false, key: '' }
  for (const [i, token] of tokens.entries()) {
    const modifier = MODIFIERS[token.toLowerCase()]
    if (i < tokens.length - 1) {
      if (modifier === undefined) return null
      chord[modifier] = true
      continue
    }
    const key = canonicalKey(token)
    if (key === null) return null
    chord.key = key
  }
  return chord
}

/** The accelerator a chord is written as: ⌘ as `CmdOrCtrl`, the way the menu writes its own keys. */
export function toAccelerator(chord: Chord): string {
  return [chord.cmd && 'CmdOrCtrl', chord.ctrl && 'Control', chord.alt && 'Alt', chord.shift && 'Shift', chord.key].filter(Boolean).join('+')
}

/** One spelling per key, for comparing: `Plus` is ⇧= (the '+' of a US keyboard). Null for no key. */
export function normalizeKey(accelerator: string | null): string | null {
  if (accelerator === null) return null
  const chord = parseAccelerator(accelerator)
  if (chord === null) return null
  const plus = chord.key === 'Plus'
  return `${chord.ctrl ? 'C' : ''}${chord.alt ? 'A' : ''}${chord.cmd ? 'M' : ''}${chord.shift || plus ? 'S' : ''}:${plus ? '=' : chord.key}`
}

export const sameKey = (a: string | null, b: string | null): boolean => {
  const na = normalizeKey(a)
  return na !== null && na === normalizeKey(b)
}

// ---------- showing one ----------

const KEY_DISPLAY: Record<string, string> = {
  Enter: '⏎',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Plus: '+',
  '-': '−',
}

/** As the app writes a key everywhere (Settings › Hotkeys, the menus): ⌃⌥⌘⇧, then the key — 'CmdOrCtrl+Shift+W' → '⌘⇧W'. '' for no key. */
export function toDisplay(accelerator: string | null): string {
  if (accelerator === null) return ''
  const chord = parseAccelerator(accelerator)
  if (chord === null) return accelerator
  return `${chord.ctrl ? '⌃' : ''}${chord.alt ? '⌥' : ''}${chord.cmd ? '⌘' : ''}${chord.shift ? '⇧' : ''}${KEY_DISPLAY[chord.key] ?? chord.key}`
}

/** A menu item's hint (YAZ-3410): the command's key as it is NOW, or undefined — no hint — with "No key". */
export function keyHint(id: HotkeyId, overrides: HotkeyOverrides | undefined): string | undefined {
  const key = toDisplay(keyFor(id, overrides))
  return key === '' ? undefined : key
}

/** A tooltip that names the command's key as it is NOW (YAZ-3410): 'New tab (⌘T)'; the bare text with "No key". */
export function titleWithKey(text: string, id: HotkeyId, overrides: HotkeyOverrides | undefined): string {
  const key = keyHint(id, overrides)
  return key === undefined ? text : `${text} (${key})`
}

// ---------- recording one ----------

/** The physical key (`KeyboardEvent.code`) as an accelerator key: ⌥ changes `key` on a Mac ('∫' for ⌥B), never `code`. */
const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

/** The parts of a DOM `KeyboardEvent` this file reads (`shared/` has no DOM types). */
export interface KeyPress {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** The accelerator key of a keydown, by `code` first and `key` when the code says nothing; null for a lone modifier. */
export function eventKey(event: Pick<KeyPress, 'key' | 'code'>): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'OS', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return null
  const code = event.code ?? ''
  const fromCode = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : CODE_KEYS[code]
  if (fromCode !== undefined) return fromCode
  return canonicalKey(event.key)
}

/** A keydown as an accelerator (D5, D6): the key and exactly the modifiers held. Null while only modifiers are down. */
export function fromKeyEvent(event: KeyPress): string | null {
  const key = eventKey(event)
  if (key === null) return null
  return toAccelerator({ cmd: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, key })
}

/**
 * Whether a key can be an app-wide key at all: it has ⌘ or ⌃ (a bare letter, or ⌥ / ⇧ and a letter, is
 * typing), or it is a function key. The recorder asks for one before anything else.
 */
export function isUsableKey(accelerator: string): boolean {
  const chord = parseAccelerator(accelerator)
  return chord !== null && (chord.cmd || chord.ctrl || /^F\d+$/.test(chord.key))
}

// ---------- the renderer's and draw.io's view of a key ----------

/** A window-level chord as `client/src/lib/windowChord.ts` matches it: the key lower case, every modifier exact. */
export interface WindowChordSpec {
  key: string
  shift: boolean
  alt: boolean
  ctrl: boolean
  meta: boolean
}

/** The renderer-owned commands' chord (⌘B, ⌘⇧C): null when the command has no key now. */
export function windowChordFor(id: HotkeyId, overrides: HotkeyOverrides | undefined): WindowChordSpec | null {
  const key = keyFor(id, overrides)
  const chord = key === null ? null : parseAccelerator(key)
  if (chord === null) return null
  return { key: chord.key === 'Plus' ? '+' : chord.key.toLowerCase(), shift: chord.shift, alt: chord.alt, ctrl: chord.ctrl, meta: chord.cmd }
}

/** `KeyboardEvent.keyCode` of an accelerator key, as draw.io's keymap reads it; undefined for one it cannot name. */
const KEY_CODES: Record<string, number> = {
  Space: 32, Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, Up: 38, Down: 40, Left: 37, Right: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  ',': 188, '.': 190, '/': 191, ';': 186, "'": 222, '[': 219, ']': 221, '\\': 220, '`': 192, '-': 189, '=': 187, Plus: 187,
}

export interface DrawioChord {
  keyCode: number
  control: true
  shift?: true
  alt?: true
  action: null
}

/**
 * The draw.io keymap entry that CLEARS draw.io's own binding on a key (D2): draw.io's `control` is ⌃ or ⌘,
 * so a key with neither is never one draw.io binds as a chord, and gets no entry.
 *
 * On a Mac a key with ⌃ gets none either (YAZ-3564 K15): draw.io's key handler reads ⌃ and ⌘ as one `control`
 * (`isControlDown` is ctrlKey, or metaKey on a Mac), so clearing ⌃D would clear its ⌘D too, a key the menu does
 * not take. The Mac's menu fires before the page, so draw.io never sees the ⌃ key anyway. Off a Mac ⌃ is the
 * Ctrl that `CmdOrCtrl` is, the page sees a key first, and the entry stays.
 */
export function drawioChordFor(accelerator: string | null, mac: boolean): DrawioChord | null {
  const chord = accelerator === null ? null : parseAccelerator(accelerator)
  if (chord === null || !(chord.cmd || chord.ctrl) || (mac && chord.ctrl)) return null
  const keyCode = /^[A-Z0-9]$/.test(chord.key) ? chord.key.charCodeAt(0) : /^F\d+$/.test(chord.key) ? 111 + Number(chord.key.slice(1)) : KEY_CODES[chord.key]
  if (keyCode === undefined) return null
  return { keyCode, control: true, ...(chord.shift || chord.key === 'Plus' ? { shift: true as const } : {}), ...(chord.alt ? { alt: true as const } : {}), action: null }
}

// ---------- the fixed keys ----------

/** A key that is not the user's to change (D1, D8): a built-in one or one of the Mac's. */
export interface FixedKey {
  label: string
  accelerator: string
}

/**
 * The application menu's own fixed keys (YAZ-3419): the items of `desktop/src/main/menu.ts` that carry a key
 * and are neither a changeable command, a role, nor a numbered vault. Not changeable — the recorder and the
 * store refuse each one, so no command can share a key with a menu item. `menu.test.ts` walks the real
 * menu and fails on a fixed key that is not here.
 */
export const MENU_FIXED_KEYS: readonly FixedKey[] = [
  { label: 'Export image', accelerator: 'CmdOrCtrl+Shift+E' },
  { label: 'Export Excalidraw drawing', accelerator: 'CmdOrCtrl+Shift+S' },
  { label: 'Share link', accelerator: 'CmdOrCtrl+Shift+L' },
  { label: 'Paste as plain text', accelerator: 'CmdOrCtrl+Shift+V' },
  { label: 'Zoom: actual size', accelerator: 'CmdOrCtrl+0' },
  { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus' },
  { label: 'Zoom in', accelerator: 'CmdOrCtrl+=' },
  { label: 'Zoom out', accelerator: 'CmdOrCtrl+-' },
  { label: 'Next tab', accelerator: 'CmdOrCtrl+Shift+]' },
  { label: 'Previous tab', accelerator: 'CmdOrCtrl+Shift+[' },
]

/**
 * The Mac's standard app keys (D1): the menu's roles (`desktop/src/main/menu.ts`). Not changeable — the
 * Settings page lists them as "App standard", and the recorder will not give one to a command.
 */
export const APP_STANDARD_KEYS: readonly FixedKey[] = [
  { label: 'Quit', accelerator: 'CmdOrCtrl+Q' },
  { label: 'Hide the app', accelerator: 'CmdOrCtrl+H' },
  { label: 'Hide other apps', accelerator: 'Alt+CmdOrCtrl+H' },
  { label: 'Minimize', accelerator: 'CmdOrCtrl+M' },
  { label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
  { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' },
  { label: 'Cut', accelerator: 'CmdOrCtrl+X' },
  { label: 'Copy', accelerator: 'CmdOrCtrl+C' },
  { label: 'Paste', accelerator: 'CmdOrCtrl+V' },
  { label: 'Select all', accelerator: 'CmdOrCtrl+A' },
  // Our own item since YAZ-3737 D2 (the safe reload), not the role, and still the Mac's standard key.
  { label: 'Reload', accelerator: 'CmdOrCtrl+R' },
]
