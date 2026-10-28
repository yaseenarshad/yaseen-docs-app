/**
 * One row of the app's key list (YAZ-3564 K1): an action of one place and its default key(s). Every key the app
 * reacts to has a row, the ones you cannot change too (`changeable: false`, "Built in" on Settings › Hotkeys).
 * Each place's file (`app.ts`, `note.ts`, `drawing.ts`, `diagram.ts`, `code.ts`, `views.ts`) holds its rows, and a
 * drift test per place reads that editor's real keys and fails on one that has no row.
 */

/** Where a key works. `app` keys are the menu's and the window's: on a Mac they fire before any page (K3). */
export type KeyScope = 'app' | 'note' | 'drawing' | 'diagram' | 'code' | 'views'
export const KEY_SCOPES: readonly KeyScope[] = ['app', 'note', 'drawing', 'diagram', 'code', 'views']

/** The places an App key can let keep their own key on it (K9): the tabs that are a canvas or an editor of their own. */
export type AsidePlace = Extract<KeyScope, 'drawing' | 'diagram' | 'code'>
export const ASIDE_PLACES: readonly AsidePlace[] = ['drawing', 'diagram', 'code']

export interface KeyRow {
  /** `<scope>.<name>`, stable: the settings store keys a change by it ('note.bold'). */
  id: string
  scope: KeyScope
  /** Short, sentence case, what the key does ("Bold", "Duplicate"). */
  label: string
  /** What the label does not say; shown muted under it. */
  hint?: string
  /**
   * The default keys, as accelerators ('CmdOrCtrl+Shift+B'); a two-step code key is the two joined by a space
   * ('CmdOrCtrl+K CmdOrCtrl+X'); [] is no key.
   */
  keys: readonly string[]
  /** False for typing keys and keys inside a pop-up (K6): shown, never changed. */
  changeable: boolean
  /** An App key only (K9): the places that keep their own key on it by default. */
  stepsAsideIn?: readonly AsidePlace[]
  /** A Mac standard key (⌘Q, ⌘C…): it blocks every place, and no row can take it (K8). */
  macStandard?: true
}
