/**
 * The code keys in the REAL Monaco (YAZ-3564 K1, K4, K12, K14), in jsdom as a Mac: the drift test (every always-on key
 * of Monaco is a row of `shared/keys/code.ts`, and every row's key is Monaco's), and the rules at work — a changed key
 * runs its command and the old key does nothing, a removed key is free, a two-step key becomes one step, the menus
 * read the key as it is now, and the suggest list keeps ⌘↑ / ⌘↓ while the fold keys step aside.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type * as MonacoApi from 'monaco-editor'
import { ALL_KEYS, keysOf } from '@shared/keys'
import { CODE_COMMANDS, CODE_KEYS } from '@shared/keys/code'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { acceleratorOfMonaco, addWrapAction, applyCodeKeys, resetCodeKeys, sameSteps, WRAP_ACTION } from './codeKeys'
import { foldingModelOf, keybindingsOf, type MonacoKeybinding } from './monacoInternals'

type Monaco = typeof MonacoApi
type Editor = MonacoApi.editor.IStandaloneCodeEditor
let monaco: Monaco

beforeAll(async () => {
  // Monaco reads the platform from the user agent once, when it loads: a Mac's, as the app ships.
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36' })
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia
  // jsdom has no canvas: Monaco's overview ruler draws into one that does nothing.
  HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: () => () => ({}), set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  monaco = await import('monaco-editor')
}, 60_000)

const editors: Editor[] = []
afterEach(() => {
  resetCodeKeys()
  for (const editor of editors.splice(0)) {
    editor.getModel()?.dispose()
    editor.dispose()
  }
  document.body.replaceChildren()
})

function open(text: string): Editor {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const editor = monaco.editor.create(mount, { model: monaco.editor.createModel(text, 'plaintext'), minimap: { enabled: false } })
  editors.push(editor)
  editor.focus()
  return editor
}

/** A key pressed in the code, as Monaco reads it (by `keyCode`). */
function press(editor: Editor, keyCode: number, mods: { meta?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean } = {}): void {
  const input = editor.getDomNode()?.querySelector('textarea')
  input?.dispatchEvent(new KeyboardEvent('keydown', { keyCode, metaKey: mods.meta, shiftKey: mods.shift, altKey: mods.alt, ctrlKey: mods.ctrl, bubbles: true, cancelable: true }))
}
const KEY = { K: 75, T: 84, U: 85, I: 73, Z: 90, Up: 38, Down: 40 }

/** The key F1 and the right-click menu show for a command: they look it up like this when they open (K12). */
const shownKey = (editor: Editor, command: string): string | null => (editor as unknown as { _standaloneKeybindingService: { lookupKeybinding(id: string): { getLabel(): string } | undefined } })._standaloneKeybindingService.lookupKeybinding(command)?.getLabel() ?? null

const apply = (overrides: HotkeyOverrides): void => applyCodeKeys(monaco, overrides)

// ---------- the drift test ----------

/** Context keys that mean a pop-up is open or focused (suggest, find, peek, hover, quick pick…), or a passing state. */
const POP_UP = /^(suggestWidget\w*|findWidgetVisible|findInputFocussed|replaceInputFocussed|inQuickInput|quickInputType.*|cursorAtEndOfQuickInputBox|editorHoverFocused|codeActionMenu\w*|parameterHints\w*|referenceSearchVisible|inReferenceSearchEditor|renameInputVisible|inlineSuggestion\w*|inlineEdit\w*|inSnippetMode|inSnippetChoice|stickyScrollFocused|markersNavigationVisible|dropWidgetVisible|pasteWidgetVisible|standaloneColorPicker\w*|LinkedEditingInputVisible|historyNavigation\w*|messageVisible|cancellableOperation|isInDiffEditor|comparingMovedCode|inInlineEditsPreviewEditor|listFocus|hasOtherSuggestions|editorHasSelection|editorHasMultipleSelections|editorColumnSelection|selectionAnchorSet|hasWordHighlights|hasSymbols|atEndOfWord|hasNextTabstop|hasPrevTabstop|cursorBeforeGhostText|inputFocus|treeElement\w*|treestickyScrollFocused|config\..*|tabShould\w*)$/
/** A key works with no pop-up open: some `||` branch of its `when` needs none. */
const alwaysOn = (when: string | null): boolean => when === null || when.split(' || ').some((branch) => !branch.split(' && ').some((term) => !term.startsWith('!') && POP_UP.test(term.trim())))
/** Typing and cursor keys, and the Mac's ⌘Z ⌘⇧Z ⌘A ⌘C ⌘X: built in, not rows (`shared/keys/code.ts`). */
const TYPING = /^(cursor(?!Undo)\w*|scroll\w*|deleteLeft|deleteRight|deleteWord\w*|deleteAll\w*|tab|outdent|lineBreakInsert|undo|redo|editor\.action\.(selectAll|clipboard\w+))$/

/** The always-on keys of the list, as (command, accelerator); a tab's own action (`<editor id>:…`) is not one. */
function liveKeys(list: readonly MonacoKeybinding[]): { command: string; key: string; when: string | null }[] {
  return list.flatMap((b) => (b.command === null || b.key === null || b.command.startsWith('-') || b.command.includes(':') || TYPING.test(b.command) || !alwaysOn(b.when) ? [] : [{ command: b.command, key: acceleratorOfMonaco(b.key), when: b.when }]))
}
const rowsOf = (command: string) => CODE_KEYS.filter((row) => CODE_COMMANDS[row.id]?.command === command)

describe('the drift test: Monaco 0.57 keys and the code rows (K1)', () => {
  it('every always-on key Monaco has is a row, every row key is Monaco’s, with its `when`; with the app’s rules, no two commands share a key', () => {
    const editor = open('x')
    const before = keybindingsOf(editor)
    expect(before).not.toBeNull()
    const monacoKeys = liveKeys(before ?? [])
    expect(monacoKeys.length).toBeGreaterThan(90)
    // Monaco → rows: a key with no row fails, named.
    const missing = monacoKeys.filter((b) => !rowsOf(b.command).some((row) => (CODE_COMMANDS[row.id].monaco ?? row.keys).some((k) => sameSteps(k, b.key))))
    expect(missing).toEqual([])
    // Rows → Monaco: a row key Monaco does not have (a renamed command, a moved key) fails, named; so does a `when` it never uses.
    const stale = CODE_KEYS.flatMap((row) => {
      const command = CODE_COMMANDS[row.id]
      if (command === undefined || command.monaco?.length === 0) return []
      const theirs = monacoKeys.filter((b) => b.command === command.command)
      const keys = (command.monaco ?? row.keys).filter((k) => !theirs.some((b) => sameSteps(k, b.key)))
      const when = theirs.some((b) => b.when === command.when || b.when === null) ? [] : [`${row.id} when`]
      return [...keys.map((k) => `${row.id} ${k}`), ...when]
    })
    expect(stale).toEqual([])

    // The app's keys on: every always-on key is a row's key now, and each key runs one command.
    apply({})
    const after = liveKeys(keybindingsOf(editor) ?? [])
    expect(after.filter((b) => !rowsOf(b.command).some((row) => keysOf(row, {}).some((k) => sameSteps(k, b.key))))).toEqual([])
    const byKey = new Map<string, Set<string>>()
    for (const b of after) byKey.set(b.key, (byKey.get(b.key) ?? new Set()).add(b.command))
    expect([...byKey].filter(([, commands]) => commands.size > 1)).toEqual([])
  })

  it('the rows: ids unique and `code.`, every Monaco row has a command, the 29 always-on two-step keys all start with ⌘K', () => {
    const ids = CODE_KEYS.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('code.'))).toBe(true)
    expect(ALL_KEYS.filter((row) => row.scope === 'code')).toEqual(CODE_KEYS)
    const twoStep = CODE_KEYS.flatMap((row) => row.keys.filter((k) => k.includes(' ')))
    // Monaco has 31 two-step keys; 2 work only with a selection anchor set (⌘K ⌘K, ⌘K Esc), so they are not rows.
    expect(twoStep).toHaveLength(29)
    expect(twoStep.every((k) => k.startsWith('CmdOrCtrl+K '))).toBe(true)
  })
})

// ---------- the rules ----------

describe('a change applies at once (K4) and the menus show it (K12)', () => {
  it('a changed key runs the command, the old key does nothing, and F1 / the right-click menu show the new key', () => {
    const editor = open('one\ntwo\nthree')
    expect(shownKey(editor, 'editor.action.deleteLines')).toBe('⇧⌘K')
    apply({ 'code.deleteLines': 'CmdOrCtrl+Alt+K' })
    expect(shownKey(editor, 'editor.action.deleteLines')).toBe('⌥⌘K')
    press(editor, KEY.K, { meta: true, shift: true })
    expect(editor.getValue()).toBe('one\ntwo\nthree')
    press(editor, KEY.K, { meta: true, alt: true })
    expect(editor.getValue()).toBe('two\nthree')
    // Back to the defaults: Monaco's own key again.
    apply({})
    expect(shownKey(editor, 'editor.action.deleteLines')).toBe('⇧⌘K')
    press(editor, KEY.K, { meta: true, shift: true })
    expect(editor.getValue()).toBe('three')
  })

  it('"No key" frees the key: it does nothing, and another command can take it', () => {
    const editor = open('one\ntwo')
    apply({ 'code.deleteLines': null })
    expect(shownKey(editor, 'editor.action.deleteLines')).toBeNull()
    press(editor, KEY.K, { meta: true, shift: true })
    expect(editor.getValue()).toBe('one\ntwo')
    apply({ 'code.deleteLines': null, 'code.transposeLetters': 'CmdOrCtrl+Shift+K' })
    editor.setPosition({ lineNumber: 1, column: 2 })
    press(editor, KEY.K, { meta: true, shift: true })
    expect(editor.getValue()).toBe('noe\ntwo')
  })

  it('a two-step ⌘K key (Blocked by the vault search) becomes one step', () => {
    const editor = open('a  \nb')
    expect(shownKey(editor, 'editor.action.trimTrailingWhitespace')).toBe('⌘K ⌘X')
    apply({ 'code.trimTrailingWhitespace': 'CmdOrCtrl+Alt+T' })
    expect(shownKey(editor, 'editor.action.trimTrailingWhitespace')).toBe('⌥⌘T')
    press(editor, KEY.T, { meta: true, alt: true })
    expect(editor.getValue()).toBe('a\nb')
  })

  it('⌥Z is the tab’s own action on the row’s key: F1 shows it, and a change makes it again on the new key', () => {
    const editor = open('x')
    let flips = 0
    const action = addWrapAction(editor, monaco, () => flips++)
    const id = `${editor.getId()}:${WRAP_ACTION}`
    expect(shownKey(editor, id)).toBe('⌥Z')
    press(editor, KEY.Z, { alt: true })
    expect(flips).toBe(1)
    apply({ 'code.toggleWordWrap': 'CmdOrCtrl+Alt+Z' })
    expect(shownKey(editor, id)).toBe('⌥⌘Z')
    press(editor, KEY.Z, { alt: true })
    press(editor, KEY.Z, { alt: true, meta: true })
    expect(flips).toBe(2)
    action.dispose()
    expect(editor.getAction(WRAP_ACTION)).toBeNull()
  })
})

describe('the fold keys are code rules, and step aside for the suggest list (K14)', () => {
  const TEXT = 'one\n  two\n  three\nfour\n  five\n'
  async function collapsed(editor: Editor): Promise<boolean[]> {
    const model = await foldingModelOf(editor)
    const regions = model?.regions
    return regions === undefined ? [] : Array.from({ length: regions.length }, (_, i) => regions.isCollapsed(i))
  }
  const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

  it('⌘↑ folds the block at the cursor, ⌘↓ unfolds it, ⌘⇧U folds every block, ⌘⇧I unfolds them; a changed key works', async () => {
    const editor = open(TEXT)
    apply({})
    await settle()
    editor.setPosition({ lineNumber: 2, column: 3 })
    press(editor, KEY.Up, { meta: true })
    await settle()
    expect(await collapsed(editor)).toEqual([true, false])
    press(editor, KEY.Down, { meta: true })
    await settle()
    expect(await collapsed(editor)).toEqual([false, false])
    press(editor, KEY.U, { meta: true, shift: true })
    await settle()
    expect(await collapsed(editor)).toEqual([true, true])
    press(editor, KEY.I, { meta: true, shift: true })
    await settle()
    expect(await collapsed(editor)).toEqual([false, false])
    apply({ 'code.foldEveryBlock': 'CmdOrCtrl+Alt+U' })
    press(editor, KEY.U, { meta: true, shift: true })
    await settle()
    expect(await collapsed(editor)).toEqual([false, false])
    press(editor, KEY.U, { meta: true, alt: true })
    await settle()
    expect(await collapsed(editor)).toEqual([true, true])
  })

  it('with the suggest list open, ⌘↓ / ⌘↑ move in the list and fold nothing', async () => {
    const provider = monaco.languages.registerCompletionItemProvider('plaintext', {
      provideCompletionItems: (model, position) => ({ suggestions: ['alpha', 'beta', 'gamma'].map((label) => ({ label, insertText: label, kind: monaco.languages.CompletionItemKind.Text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) })) }),
    })
    try {
      const editor = open(TEXT)
      apply({})
      editor.setPosition({ lineNumber: 2, column: 3 })
      editor.trigger('test', 'editor.action.triggerSuggest', {})
      await settle(300)
      const widget = (editor.getContribution('editor.contrib.suggestController') as unknown as { widget: { value: { getFocusedItem(): { item: { completion: { label: string } } } | undefined } } }).widget.value
      const focused = (): string | undefined => widget.getFocusedItem()?.item.completion.label
      expect(focused()).toBe('alpha')
      press(editor, KEY.Down, { meta: true })
      expect(focused()).toBe('beta')
      press(editor, KEY.Up, { meta: true })
      expect(focused()).toBe('alpha')
      await settle()
      expect(await collapsed(editor)).toEqual([false, false])
    } finally {
      provider.dispose()
    }
  })
})
