/**
 * MONACO'S KEYBINDINGS THAT THE APP'S KEYS REPLACE (YAZ-3439 "The app's own keys win in code tabs"). The code tab's
 * capture-phase keydown keeps each of these keys from Monaco already; removing Monaco's binding too means its
 * right-click menu and F1 show no hint for a key that does something else in the app. Each action stays (F1, the menu).
 * Pure: `monaco.ts` hands in Monaco's `KeyMod` and `KeyCode`, the tests hand in the numbers.
 */

/** A rule for `monaco.editor.addKeybindingRules`: a command id with a leading `-` removes that binding. */
export interface KeyRemoval {
  keybinding: number
  command: string
}

export function appKeyRemovals(keyMod: { CtrlCmd: number; Shift: number }, keyCode: { KeyO: number }): KeyRemoval[] {
  return [
    // ⇧⌘O: the app's "Open folder…"; Monaco's "Go to Symbol…" (`editor.action.quickOutline`).
    { keybinding: keyMod.CtrlCmd | keyMod.Shift | keyCode.KeyO, command: '-editor.action.quickOutline' },
  ]
}
