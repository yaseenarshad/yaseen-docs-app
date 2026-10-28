/** Monaco's ⇧⌘O binding to "Go to Symbol…" goes, so its menu shows no hint for the app's "Open folder…" key (YAZ-3478 checker nit). */
import { describe, expect, it } from 'vitest'
import { KeyCode, KeyMod } from 'monaco-editor/editor/editor.api.js'
import { appKeyRemovals } from './monacoKeys'

describe('appKeyRemovals', () => {
  it('removes ⇧⌘O from editor.action.quickOutline, and nothing else', () => {
    expect(appKeyRemovals(KeyMod, KeyCode)).toEqual([{ keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyO, command: '-editor.action.quickOutline' }])
  })
})
