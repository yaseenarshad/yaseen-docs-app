/**
 * THE CODE KEYS, LIVE (YAZ-3564 K4). The code rows of the key list (`shared/keys/code.ts`) as Monaco keybinding
 * rules: for each row the user changed, a rule removes Monaco's default key (`-command`) and one more rule adds the
 * user's key (two steps or one). The app's own keys on a Monaco command (the fold keys) are rules too, so a code tab
 * has one way for every key. Rules are one set per window: they hold for every code tab in it, and a change replaces
 * the set (the old rules are disposed). Monaco reads its rules at each key, so nothing else runs per keystroke.
 *
 * Monaco's right-click menu and F1 look a command's key up when they open (`lookupKeybinding`), so they show the key
 * as it is now (K12). ⌥Z is the tab's own action (F1 lists only an editor's actions, so a shared command would be
 * missing there): `addWrapAction` gives it the row's key, and makes it again when the key changes.
 *
 * Monaco is passed in (`./monaco` in the app, the real `monaco-editor` in the tests): no runtime import here.
 */
import { keyRow, keysOf, type KeyRow } from '@shared/keys'
import { CODE_COMMANDS, CODE_KEYS } from '@shared/keys/code'
import { fromKeyEvent, parseAccelerator, sameKey, type HotkeyOverrides, type KeyPress } from '@shared/hotkeyBindings'

interface Disposable {
  dispose(): void
}

/** A rule as `monaco.editor.addKeybindingRules` takes it. */
export interface KeyRule {
  keybinding: number
  command: string
  when?: string
}

/** The part of Monaco this file uses. */
export interface MonacoKeys {
  KeyCode: object
  KeyMod: { CtrlCmd: number; Shift: number; Alt: number; WinCtrl: number; chord(first: number, second: number): number }
  editor: { addKeybindingRules(rules: KeyRule[]): Disposable }
}

/** An accelerator's key as Monaco's `KeyCode` names it, where the two spell it apart ('Up' is `UpArrow`, ',' is `Comma`). */
const KEY_CODE_NAMES: Record<string, string> = {
  Up: 'UpArrow', Down: 'DownArrow', Left: 'LeftArrow', Right: 'RightArrow',
  ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote', '-': 'Minus', '=': 'Equal', Plus: 'Equal',
}

/**
 * An accelerator ('CmdOrCtrl+Shift+K', or two steps 'CmdOrCtrl+K CmdOrCtrl+X') as Monaco's keybinding number;
 * null for a key Monaco cannot name. ⌘ is `CtrlCmd` and ⌃ is `WinCtrl`, as Monaco writes a Mac's keys.
 */
export function monacoKeybinding(accelerator: string, monaco: Pick<MonacoKeys, 'KeyCode' | 'KeyMod'>): number | null {
  const steps = accelerator.split(' ').map((step) => {
    const chord = parseAccelerator(step)
    if (chord === null) return null
    const name = /^[A-Z]$/.test(chord.key) ? `Key${chord.key}` : /^\d$/.test(chord.key) ? `Digit${chord.key}` : (KEY_CODE_NAMES[chord.key] ?? chord.key)
    const code = (monaco.KeyCode as Record<string, number | undefined>)[name]
    if (typeof code !== 'number') return null
    const { KeyMod } = monaco
    return code | (chord.cmd ? KeyMod.CtrlCmd : 0) | (chord.ctrl ? KeyMod.WinCtrl : 0) | (chord.alt ? KeyMod.Alt : 0) | (chord.shift || chord.key === 'Plus' ? KeyMod.Shift : 0)
  })
  if (steps.some((s) => s === null) || steps.length > 2) return null
  return steps.length === 2 ? monaco.KeyMod.chord(steps[0] as number, steps[1] as number) : (steps[0] as number)
}

/** Monaco's spelling of a key in its keybindings list ('shift+alt+f', 'cmd+k cmd+x', 'ctrl+shift+right') as an accelerator. */
export function acceleratorOfMonaco(label: string): string {
  const named: Record<string, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', enter: 'Enter', escape: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete' }
  return label
    .split(' ')
    .map((step) => {
      const parts = step.split('+')
      const key = parts.pop() ?? ''
      const mods = [parts.includes('cmd') && 'CmdOrCtrl', parts.includes('ctrl') && 'Control', parts.includes('alt') && 'Alt', parts.includes('shift') && 'Shift'].filter(Boolean)
      return [...mods, named[key] ?? key.toUpperCase()].join('+')
    })
    .join(' ')
}

/** Two keys the same, step by step. */
export const sameSteps = (a: string, b: string): boolean => {
  const as = a.split(' ')
  const bs = b.split(' ')
  return as.length === bs.length && as.every((step, i) => sameKey(step, bs[i]))
}
const sameKeys = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((key) => b.some((other) => sameSteps(key, other)))

/**
 * The rules that make Monaco's keys the code rows' keys as they are now: nothing for a row that has Monaco's own
 * keys; else a removal of each of Monaco's and an addition of each of the row's. Pure.
 */
export function codeKeyRules(overrides: HotkeyOverrides | undefined, monaco: Pick<MonacoKeys, 'KeyCode' | 'KeyMod'>): KeyRule[] {
  const rules: KeyRule[] = []
  for (const row of CODE_KEYS) {
    const command = CODE_COMMANDS[row.id]
    if (command === undefined) continue
    const from = command.monaco ?? row.keys
    const to = keysOf(row, overrides)
    if (sameKeys(from, to)) continue
    for (const key of from) {
      const keybinding = monacoKeybinding(key, monaco)
      if (keybinding !== null) rules.push({ keybinding, command: `-${command.command}` })
    }
    for (const key of to) {
      const keybinding = monacoKeybinding(key, monaco)
      if (keybinding !== null) rules.push({ keybinding, command: command.command, when: command.when })
    }
  }
  return rules
}

/** The ⌥Z row: the tab's own action, not a rule (see the module doc). */
const WRAP_ROW = CODE_KEYS.find((row) => row.id === 'code.toggleWordWrap') as KeyRow

/** The window's rule set and what it was made from. */
let applied: { rules: string; disposable: Disposable } | null = null
let overridesNow: HotkeyOverrides | undefined
const changed = new Set<() => void>()

/** Makes Monaco's keys the code rows' keys for `overrides` (K4). Replaces the set made before; the same keys again change nothing. */
export function applyCodeKeys(monaco: MonacoKeys, overrides: HotkeyOverrides | undefined): void {
  const rules = codeKeyRules(overrides, monaco)
  const key = JSON.stringify(rules)
  const wrapBefore = keysOf(WRAP_ROW, overridesNow)
  overridesNow = overrides
  if (applied?.rules !== key) {
    applied?.disposable.dispose()
    applied = { rules: key, disposable: monaco.editor.addKeybindingRules(rules) }
  }
  if (!sameKeys(wrapBefore, keysOf(WRAP_ROW, overrides))) for (const listener of [...changed]) listener()
}

/** Applies the settings' code keys now, and again after each change of the settings (from any window). */
export function followCodeKeys(monaco: MonacoKeys, settings: { getSettings(): { hotkeys?: HotkeyOverrides } | undefined; subscribe(listener: () => void): () => void }): () => void {
  applyCodeKeys(monaco, settings.getSettings()?.hotkeys)
  return settings.subscribe(() => applyCodeKeys(monaco, settings.getSettings()?.hotkeys))
}

/** The editor action id of ⌥Z: VS Code's own name for "Toggle Word Wrap" (standalone Monaco has none). */
export const WRAP_ACTION = 'editor.action.toggleWordWrap'

interface ActionHost {
  addAction(action: { id: string; label: string; keybindings?: number[]; run: () => void }): Disposable
}

/** The tab's "Toggle Word Wrap" (YAZ-3449 S4) on the row's key as it is now; made again when the key changes. */
export function addWrapAction(editor: ActionHost, monaco: Pick<MonacoKeys, 'KeyCode' | 'KeyMod'>, run: () => void): Disposable {
  const add = (): Disposable =>
    editor.addAction({
      id: WRAP_ACTION,
      label: 'View: Toggle Word Wrap',
      keybindings: keysOf(WRAP_ROW, overridesNow).flatMap((key) => monacoKeybinding(key, monaco) ?? []),
      run,
    })
  let action = add()
  const remake = (): void => {
    action.dispose()
    action = add()
  }
  changed.add(remake)
  return {
    dispose: () => {
      changed.delete(remake)
      action.dispose()
    },
  }
}

/**
 * The keys a keydown is, as accelerators: the key with exactly the modifiers held, and off a Mac, where
 * `CmdOrCtrl` is Ctrl, the same key with ⌘ for Ctrl too. Empty for a lone modifier.
 */
export function pressedKeys(event: KeyPress, mac: boolean): string[] {
  const key = fromKeyEvent(event)
  if (key === null) return []
  return !mac && event.ctrlKey && !event.metaKey ? [key, fromKeyEvent({ ...event, ctrlKey: false, metaKey: true }) as string] : [key]
}

/** Whether a keydown is one of a code row's keys now (a one-step key: the code tab's own keys are one step). */
export function isCodeKey(rowId: string, event: KeyPress, overrides: HotkeyOverrides | undefined, mac: boolean): boolean {
  const row = keyRow(rowId)
  if (row === undefined) return false
  const pressed = pressedKeys(event, mac)
  return keysOf(row, overrides).some((key) => pressed.some((p) => sameKey(key, p)))
}

/** Forget the window's rules (tests only: each test starts from Monaco's own keys). */
export function resetCodeKeys(): void {
  applied?.disposable.dispose()
  applied = null
  overridesNow = undefined
  changed.clear()
}
