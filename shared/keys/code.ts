/**
 * The code keys (YAZ-3564 K1): a code tab's keys, Monaco's and the app's. One row per Monaco command that has an
 * always-on key in monaco-editor 0.57 (on a Mac), with Monaco's label in sentence case. Not here, built in (K6):
 * the typing and cursor keys (arrows, Home / End, the Page keys, ⌫ ⌦, Tab, the emacs ⌃ keys, word moves and
 * deletes), ⌘Z ⌘⇧Z ⌘A ⌘C ⌘X (the Mac's, App rows), and every key inside a pop-up (suggest, find, peek, hover).
 * `client/src/code/codeKeys.test.ts` reads Monaco's real keys and fails on an always-on key with no row here.
 *
 * Every Monaco row changes live, in every code tab of the window (K4): `client/src/code/codeKeys.ts` turns the
 * user's changes into Monaco keybinding rules. A two-step key is two accelerators and one space; all 31 of
 * Monaco's start with ⌘K, the app's Search, so they show as Blocked until the user changes them (K3).
 */
import type { KeyRow } from './types'

/** How a row reaches Monaco: its command, and the `when` a key the user gives it gets. */
export interface CodeCommand {
  command: string
  when: string
  /** Monaco's own default keys, when the row's `keys` are not they: [] for the app's own keys on a Monaco command. */
  monaco?: readonly string[]
}

// Monaco's `when` clauses, as `getKeybindings()` serializes them.
const TEXT = 'textInputFocus'
const TEXT_EDIT = 'textInputFocus && !editorReadonly'
const EDIT = 'editorTextFocus && !editorReadonly'
const IN_TEXT = 'editorTextFocus'
const IN_EDITOR = 'editorFocus'
const FIND = 'editorFocus || editorIsOpen'
const FOLD = 'editorTextFocus && foldingEnabled'
const CODE_ACTIONS = 'editorHasCodeActionsProvider && textInputFocus && !editorReadonly'
const DEFINITION = 'editorHasDefinitionProvider && editorTextFocus'
const PEEK = '&& editorTextFocus && !inReferenceSearchEditor && !isInEmbeddedEditor'
/** The app's fold keys step aside while the suggest list is open, so ⌘↑ / ⌘↓ move in it (K14). */
const APP_FOLD = 'editorTextFocus && foldingEnabled && !suggestWidgetVisible'

interface Spec {
  name: string
  label: string
  hint?: string
  keys: readonly string[]
  /** Monaco's command; absent for a key the code tab handles itself. */
  command?: string
  when?: string
  monaco?: readonly string[]
  changeable?: false
}

const K = (second: string): string => `CmdOrCtrl+K ${second}`

const SPECS: readonly Spec[] = [
  // The app's own code keys (YAZ-3447, YAZ-3478, YAZ-3449).
  { name: 'save', label: 'Save now', hint: 'A code tab also saves half a second after you stop typing', keys: ['CmdOrCtrl+S'] },
  { name: 'toggleWordWrap', label: 'Toggle word wrap', hint: 'This tab only; Settings › Code sets it for every tab', keys: ['Alt+Z'] },
  { name: 'foldEveryBlock', label: 'Fold every block', hint: 'Also "Collapse all" on a fold arrow', keys: ['CmdOrCtrl+Shift+U'], command: 'editor.foldAll', when: APP_FOLD, monaco: [] },
  { name: 'unfoldEveryBlock', label: 'Unfold every block', hint: 'Also "Expand all" on a fold arrow', keys: ['CmdOrCtrl+Shift+I'], command: 'editor.unfoldAll', when: APP_FOLD, monaco: [] },
  { name: 'foldHere', label: 'Fold the block at the cursor', hint: 'In the suggest list, ⌘↑ moves up the list instead', keys: ['CmdOrCtrl+Up'], command: 'editor.fold', when: APP_FOLD, monaco: [] },
  { name: 'unfoldHere', label: 'Unfold the block at the cursor', hint: 'In the suggest list, ⌘↓ moves down the list instead', keys: ['CmdOrCtrl+Down'], command: 'editor.unfold', when: APP_FOLD, monaco: [] },
  { name: 'topBottom', label: 'Go to the top / bottom of the file', hint: 'With ⇧, select to there', keys: ['CmdOrCtrl+Home', 'CmdOrCtrl+End'], changeable: false },

  // Find and replace.
  { name: 'find', label: 'Find', keys: ['CmdOrCtrl+F'], command: 'actions.find', when: FIND },
  { name: 'replace', label: 'Replace', keys: ['CmdOrCtrl+Alt+F'], command: 'editor.action.startFindReplaceAction', when: FIND },
  { name: 'findWithSelection', label: 'Find with selection', keys: ['CmdOrCtrl+E'], command: 'actions.findWithSelection', when: IN_EDITOR },
  { name: 'nextMatch', label: 'Find next', keys: ['F3', 'CmdOrCtrl+G'], command: 'editor.action.nextMatchFindAction', when: IN_EDITOR },
  { name: 'previousMatch', label: 'Find previous', keys: ['Shift+F3', 'CmdOrCtrl+Shift+G'], command: 'editor.action.previousMatchFindAction', when: IN_EDITOR },
  { name: 'nextSelectionMatch', label: 'Find next selection', keys: ['CmdOrCtrl+F3'], command: 'editor.action.nextSelectionMatchFindAction', when: IN_EDITOR },
  { name: 'previousSelectionMatch', label: 'Find previous selection', keys: ['CmdOrCtrl+Shift+F3'], command: 'editor.action.previousSelectionMatchFindAction', when: IN_EDITOR },
  { name: 'findCaseSensitive', label: 'Find: match case', keys: ['CmdOrCtrl+Alt+C'], command: 'toggleFindCaseSensitive', when: IN_EDITOR },
  { name: 'findWholeWord', label: 'Find: match whole word', keys: ['CmdOrCtrl+Alt+W'], command: 'toggleFindWholeWord', when: IN_EDITOR },
  { name: 'findRegex', label: 'Find: use regular expression', keys: ['CmdOrCtrl+Alt+R'], command: 'toggleFindRegex', when: IN_EDITOR },
  { name: 'findInSelection', label: 'Find: in selection', keys: ['CmdOrCtrl+Alt+L'], command: 'toggleFindInSelection', when: IN_EDITOR },
  { name: 'preserveCase', label: 'Replace: preserve case', keys: ['CmdOrCtrl+Alt+P'], command: 'togglePreserveCase', when: IN_EDITOR },

  // Selections and cursors.
  { name: 'addSelectionToNextFindMatch', label: 'Add selection to next find match', keys: ['CmdOrCtrl+D'], command: 'editor.action.addSelectionToNextFindMatch', when: IN_EDITOR },
  { name: 'moveSelectionToNextFindMatch', label: 'Move last selection to next find match', keys: [K('CmdOrCtrl+D')], command: 'editor.action.moveSelectionToNextFindMatch', when: IN_EDITOR },
  { name: 'selectHighlights', label: 'Select all occurrences of find match', keys: ['CmdOrCtrl+Shift+L'], command: 'editor.action.selectHighlights', when: IN_EDITOR },
  { name: 'changeAll', label: 'Change all occurrences', keys: ['CmdOrCtrl+F2'], command: 'editor.action.changeAll', when: EDIT },
  { name: 'expandLineSelection', label: 'Expand line selection', keys: ['CmdOrCtrl+L'], command: 'expandLineSelection', when: TEXT },
  { name: 'smartSelectExpand', label: 'Expand selection', keys: ['Control+Shift+Right', 'CmdOrCtrl+Control+Shift+Right'], command: 'editor.action.smartSelect.expand', when: IN_TEXT },
  { name: 'smartSelectShrink', label: 'Shrink selection', keys: ['Control+Shift+Left', 'CmdOrCtrl+Control+Shift+Left'], command: 'editor.action.smartSelect.shrink', when: IN_TEXT },
  { name: 'setSelectionAnchor', label: 'Set selection anchor', keys: [K('CmdOrCtrl+B')], command: 'editor.action.setSelectionAnchor', when: IN_TEXT },
  { name: 'insertCursorAbove', label: 'Add cursor above', keys: ['CmdOrCtrl+Alt+Up'], command: 'editor.action.insertCursorAbove', when: IN_TEXT },
  { name: 'insertCursorBelow', label: 'Add cursor below', keys: ['CmdOrCtrl+Alt+Down'], command: 'editor.action.insertCursorBelow', when: IN_TEXT },
  { name: 'insertCursorAtLineEnds', label: 'Add cursors to line ends', keys: ['Alt+Shift+I'], command: 'editor.action.insertCursorAtEndOfEachLineSelected', when: IN_TEXT },
  { name: 'cursorUndo', label: 'Cursor undo', hint: 'Back to where the cursor was', keys: ['CmdOrCtrl+U'], command: 'cursorUndo', when: TEXT },

  // Lines and text.
  { name: 'commentLine', label: 'Toggle line comment', keys: ['CmdOrCtrl+/'], command: 'editor.action.commentLine', when: EDIT },
  { name: 'addCommentLine', label: 'Add line comment', keys: [K('CmdOrCtrl+C')], command: 'editor.action.addCommentLine', when: EDIT },
  { name: 'removeCommentLine', label: 'Remove line comment', keys: [K('CmdOrCtrl+U')], command: 'editor.action.removeCommentLine', when: EDIT },
  { name: 'blockComment', label: 'Toggle block comment', keys: ['Alt+Shift+A'], command: 'editor.action.blockComment', when: EDIT },
  { name: 'deleteLines', label: 'Delete line', keys: ['CmdOrCtrl+Shift+K'], command: 'editor.action.deleteLines', when: TEXT_EDIT },
  { name: 'copyLinesUp', label: 'Copy line up', keys: ['Alt+Shift+Up'], command: 'editor.action.copyLinesUpAction', when: EDIT },
  { name: 'copyLinesDown', label: 'Copy line down', keys: ['Alt+Shift+Down'], command: 'editor.action.copyLinesDownAction', when: EDIT },
  { name: 'moveLinesUp', label: 'Move line up', keys: ['Alt+Up'], command: 'editor.action.moveLinesUpAction', when: EDIT },
  { name: 'moveLinesDown', label: 'Move line down', keys: ['Alt+Down'], command: 'editor.action.moveLinesDownAction', when: EDIT },
  { name: 'insertLineBefore', label: 'Insert line above', keys: ['CmdOrCtrl+Shift+Enter'], command: 'editor.action.insertLineBefore', when: EDIT },
  { name: 'insertLineAfter', label: 'Insert line below', keys: ['CmdOrCtrl+Enter'], command: 'editor.action.insertLineAfter', when: EDIT },
  { name: 'indentLines', label: 'Indent line', keys: ['CmdOrCtrl+]'], command: 'editor.action.indentLines', when: EDIT },
  { name: 'outdentLines', label: 'Outdent line', keys: ['CmdOrCtrl+['], command: 'editor.action.outdentLines', when: EDIT },
  { name: 'joinLines', label: 'Join lines', keys: ['Control+J'], command: 'editor.action.joinLines', when: EDIT },
  { name: 'transposeLetters', label: 'Transpose letters', keys: ['Control+T'], command: 'editor.action.transposeLetters', when: TEXT_EDIT },
  { name: 'trimTrailingWhitespace', label: 'Trim trailing whitespace', keys: [K('CmdOrCtrl+X')], command: 'editor.action.trimTrailingWhitespace', when: EDIT },
  { name: 'inPlaceReplaceUp', label: 'Replace with previous value', keys: ['CmdOrCtrl+Shift+,'], command: 'editor.action.inPlaceReplace.up', when: EDIT },
  { name: 'inPlaceReplaceDown', label: 'Replace with next value', keys: ['CmdOrCtrl+Shift+.'], command: 'editor.action.inPlaceReplace.down', when: EDIT },
  { name: 'removeBrackets', label: 'Remove brackets', keys: ['CmdOrCtrl+Alt+Backspace'], command: 'editor.action.removeBrackets', when: IN_TEXT },
  { name: 'jumpToBracket', label: 'Go to bracket', keys: ['CmdOrCtrl+Shift+\\'], command: 'editor.action.jumpToBracket', when: IN_TEXT },
  { name: 'formatDocument', label: 'Format document', keys: ['Alt+Shift+F'], command: 'editor.action.formatDocument', when: 'editorHasDocumentFormattingProvider && editorTextFocus && !editorReadonly && !inCompositeEditor' },
  { name: 'formatSelection', label: 'Format selection', keys: [K('CmdOrCtrl+F')], command: 'editor.action.formatSelection', when: 'editorHasDocumentSelectionFormattingProvider && editorTextFocus && !editorReadonly' },

  // Going places, and the smart help.
  { name: 'gotoLine', label: 'Go to line/column…', keys: ['Control+G'], command: 'editor.action.gotoLine', when: IN_EDITOR },
  // ⌘⇧O is the app's "Open folder…" (YAZ-3439): no key, so the right-click menu shows none for a key that does something else.
  { name: 'quickOutline', label: 'Go to symbol…', hint: '⌘⇧O is Open folder…', keys: [], command: 'editor.action.quickOutline', when: 'editorFocus && editorHasDocumentSymbolProvider', monaco: ['CmdOrCtrl+Shift+O'] },
  { name: 'revealDefinition', label: 'Go to definition', hint: 'Or ⌘-click a name', keys: ['F12', 'CmdOrCtrl+F12'], command: 'editor.action.revealDefinition', when: DEFINITION },
  { name: 'revealDefinitionAside', label: 'Open definition to the side', keys: [K('F12'), K('CmdOrCtrl+F12')], command: 'editor.action.revealDefinitionAside', when: 'editorHasDefinitionProvider && editorTextFocus && !isInEmbeddedEditor' },
  { name: 'peekDefinition', label: 'Peek definition', keys: ['Alt+F12'], command: 'editor.action.peekDefinition', when: `editorHasDefinitionProvider ${PEEK}` },
  // Monaco binds ⌘F12 to this too, but "Go to definition" wins it in the app (`isWeb` is true in a sandboxed window): no key.
  { name: 'goToImplementation', label: 'Go to implementations', keys: [], command: 'editor.action.goToImplementation', when: 'editorHasImplementationProvider && editorTextFocus', monaco: ['CmdOrCtrl+F12'] },
  { name: 'peekImplementation', label: 'Peek implementations', keys: ['CmdOrCtrl+Shift+F12'], command: 'editor.action.peekImplementation', when: `editorHasImplementationProvider ${PEEK}` },
  { name: 'goToReferences', label: 'Go to references', keys: ['Shift+F12'], command: 'editor.action.goToReferences', when: `editorHasReferenceProvider ${PEEK}` },
  { name: 'rename', label: 'Rename symbol', keys: ['F2'], command: 'editor.action.rename', when: 'editorHasRenameProvider && editorTextFocus && !editorReadonly' },
  { name: 'linkedEditing', label: 'Start linked editing', keys: ['CmdOrCtrl+Shift+F2'], command: 'editor.action.linkedEditing', when: 'editorHasRenameProvider && editorTextFocus && !editorReadonly' },
  { name: 'triggerSuggest', label: 'Trigger suggest', keys: ['CmdOrCtrl+I', 'Alt+Escape', 'Control+Space'], command: 'editor.action.triggerSuggest', when: 'editorHasCompletionItemProvider && textInputFocus && !editorReadonly && !suggestWidgetVisible' },
  { name: 'triggerParameterHints', label: 'Trigger parameter hints', keys: ['CmdOrCtrl+Shift+Space'], command: 'editor.action.triggerParameterHints', when: 'editorHasSignatureHelpProvider && editorTextFocus' },
  { name: 'showHover', label: 'Show or focus hover', keys: [K('CmdOrCtrl+I')], command: 'editor.action.showHover', when: IN_TEXT },
  { name: 'quickFix', label: 'Quick fix…', keys: ['CmdOrCtrl+.'], command: 'editor.action.quickFix', when: CODE_ACTIONS },
  { name: 'autoFix', label: 'Auto fix…', keys: ['CmdOrCtrl+Alt+.'], command: 'editor.action.autoFix', when: 'textInputFocus && !editorReadonly && supportedCodeAction =~ /(\\s|^)quickfix\\b/' },
  { name: 'refactor', label: 'Refactor…', keys: ['Control+Shift+R'], command: 'editor.action.refactor', when: CODE_ACTIONS },
  { name: 'organizeImports', label: 'Organize imports', keys: ['Alt+Shift+O'], command: 'editor.action.organizeImports', when: 'textInputFocus && !editorReadonly && supportedCodeAction =~ /(\\s|^)source\\.organizeImports\\b/' },
  { name: 'markerNext', label: 'Go to next problem', keys: ['Alt+F8'], command: 'editor.action.marker.next', when: IN_EDITOR },
  { name: 'markerPrev', label: 'Go to previous problem', keys: ['Alt+Shift+F8'], command: 'editor.action.marker.prev', when: IN_EDITOR },
  { name: 'markerNextInFiles', label: 'Go to next problem in files', keys: ['F8'], command: 'editor.action.marker.nextInFiles', when: IN_EDITOR },
  { name: 'markerPrevInFiles', label: 'Go to previous problem in files', keys: ['Shift+F8'], command: 'editor.action.marker.prevInFiles', when: IN_EDITOR },
  { name: 'quickCommand', label: 'Command palette', hint: 'Every Monaco command, with its key as it is now', keys: ['F1'], command: 'editor.action.quickCommand', when: IN_EDITOR },
  { name: 'showContextMenu', label: 'Show the right-click menu', keys: ['Shift+F10'], command: 'editor.action.showContextMenu', when: TEXT },
  { name: 'toggleTabFocusMode', label: 'Toggle Tab key moves focus', keys: ['Control+Shift+M'], command: 'editor.action.toggleTabFocusMode', when: IN_EDITOR },

  // Monaco's own folds.
  { name: 'fold', label: 'Fold', keys: ['CmdOrCtrl+Alt+['], command: 'editor.fold', when: FOLD },
  { name: 'unfold', label: 'Unfold', keys: ['CmdOrCtrl+Alt+]'], command: 'editor.unfold', when: FOLD },
  { name: 'toggleFold', label: 'Toggle fold', keys: [K('CmdOrCtrl+L')], command: 'editor.toggleFold', when: FOLD },
  { name: 'foldRecursively', label: 'Fold recursively', keys: [K('CmdOrCtrl+[')], command: 'editor.foldRecursively', when: FOLD },
  { name: 'unfoldRecursively', label: 'Unfold recursively', keys: [K('CmdOrCtrl+]')], command: 'editor.unfoldRecursively', when: FOLD },
  { name: 'toggleFoldRecursively', label: 'Toggle fold recursively', keys: [K('CmdOrCtrl+Shift+L')], command: 'editor.toggleFoldRecursively', when: FOLD },
  { name: 'foldAll', label: 'Fold all', keys: [K('CmdOrCtrl+0')], command: 'editor.foldAll', when: FOLD },
  { name: 'unfoldAll', label: 'Unfold all', keys: [K('CmdOrCtrl+J')], command: 'editor.unfoldAll', when: FOLD },
  { name: 'foldAllExcept', label: 'Fold all except selected', keys: [K('CmdOrCtrl+-')], command: 'editor.foldAllExcept', when: FOLD },
  { name: 'unfoldAllExcept', label: 'Unfold all except selected', keys: [K('CmdOrCtrl+=')], command: 'editor.unfoldAllExcept', when: FOLD },
  { name: 'foldAllBlockComments', label: 'Fold all block comments', keys: [K('CmdOrCtrl+/')], command: 'editor.foldAllBlockComments', when: FOLD },
  { name: 'foldAllMarkerRegions', label: 'Fold all regions', keys: [K('CmdOrCtrl+8')], command: 'editor.foldAllMarkerRegions', when: FOLD },
  { name: 'unfoldAllMarkerRegions', label: 'Unfold all regions', keys: [K('CmdOrCtrl+9')], command: 'editor.unfoldAllMarkerRegions', when: FOLD },
  ...[1, 2, 3, 4, 5, 6, 7].map((n): Spec => ({ name: `foldLevel${n}`, label: `Fold level ${n}`, keys: [K(`CmdOrCtrl+${n}`)], command: `editor.foldLevel${n}`, when: FOLD })),
  { name: 'createFoldingRange', label: 'Create folding range from selection', keys: [K('CmdOrCtrl+,')], command: 'editor.createFoldingRangeFromSelection', when: FOLD },
  { name: 'removeManualFoldingRanges', label: 'Remove manual folding ranges', keys: [K('CmdOrCtrl+.')], command: 'editor.removeManualFoldingRanges', when: FOLD },
]

export const CODE_KEYS: readonly KeyRow[] = SPECS.map((s): KeyRow => ({
  id: `code.${s.name}`,
  scope: 'code',
  label: s.label,
  ...(s.hint === undefined ? {} : { hint: s.hint }),
  keys: s.keys,
  changeable: s.changeable ?? true,
}))

/** The rows Monaco runs, by row id: the rest (Save now, Toggle word wrap, ⌘Home / ⌘End) are the code tab's own. */
export const CODE_COMMANDS: Readonly<Record<string, CodeCommand>> = Object.fromEntries(
  SPECS.flatMap((s) => (s.command === undefined ? [] : [[`code.${s.name}`, { command: s.command, when: s.when ?? IN_TEXT, ...(s.monaco === undefined ? {} : { monaco: s.monaco }) }]])),
)
