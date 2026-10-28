/**
 * A stand-in for `./monaco` (YAZ-3448): Monaco does not run in jsdom, so the code tab's suites mock
 * that one module with this — `vi.mock('./monaco', () => import('./monacoTestKit'))`. It keeps only
 * what `CodeEditor` uses, and the model keeps Monaco's rules that the bytes depend on: a leading BOM
 * is held apart and `getValue(_, true)` gives it back, the EOL is the break MOST lines use (so the
 * tests prove `withOneLineBreak` decides it), `setValue` is a flush, and the alternative version id
 * returns to an old value on an undo. `pushEditOperations` is one undoable edit, and `undo` gives the
 * text and the alternative version id from before it back. Folds are a set of start lines (a region
 * starts on a line that ends with `{`), read through the view state and restored through the folding
 * controller, as `codeFolds.ts` reads and restores them. Test-only; nothing ships it.
 */
import { vi } from 'vitest'

const LF = 0
const CRLF = 1

type ChangeListener = (event: { isFlush: boolean }) => void

export class FakeModel {
  private lines: string[] = []
  private bom = false
  private eol: '\n' | '\r\n' = '\n'
  private listeners = new Set<ChangeListener>()
  private version = 1
  private alternative = 1
  private disposed = false
  /** Each `pushEditOperations`: the lines and the alternative id from before it, for `undo`. */
  private undoStack: { lines: string[]; alternative: number }[] = []
  /** How many times `setValue` ran: a reload must not use it (it clears undo). */
  setValueCalls = 0
  /** Every edit `pushEditOperations` applied, as given. */
  readonly edits: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string }[] = []

  constructor(
    text: string,
    readonly uri: FakeUri,
  ) {
    this.load(text)
  }

  /** Monaco's language from the extension, as `createModel` with no language picks it. */
  getLanguageId(): string {
    return /\.(ts|tsx|mts|cts)$/.test(this.uri.path) ? 'typescript' : /\.(js|jsx|mjs|cjs)$/.test(this.uri.path) ? 'javascript' : /\.pyi?$/.test(this.uri.path) ? 'python' : 'plaintext'
  }

  private load(text: string): void {
    this.bom = text.startsWith('﻿')
    const body = this.bom ? text.slice(1) : text
    const crlf = body.split('\r\n').length - 1
    const all = body.split(/\r\n|\r|\n/).length - 1
    // Monaco's rule: CRLF when most breaks are CRLF, else LF (LF too when there is none).
    this.eol = all > 0 && crlf > all / 2 ? '\r\n' : '\n'
    this.lines = body.split(/\r\n|\r|\n/)
  }

  private changed(isFlush: boolean): void {
    this.alternative = ++this.version
    for (const listener of [...this.listeners]) listener({ isFlush })
  }

  /** `eol`: Monaco's `EndOfLinePreference` — 0 the model's own, 1 LF, 2 CRLF. */
  getValue(eol = 0, preserveBOM = false): string {
    if (this.disposed) throw new Error('Model is disposed!')
    return `${preserveBOM && this.bom ? '﻿' : ''}${this.lines.join(eol === 1 ? '\n' : eol === 2 ? '\r\n' : this.eol)}`
  }

  setValue(text: string): void {
    this.setValueCalls++
    this.undoStack = []
    this.load(text)
    this.changed(true)
  }

  getLineCount(): number {
    return this.lines.length
  }

  getLineContent(lineNumber: number): string {
    return this.lines[lineNumber - 1] ?? ''
  }

  /** The first column that is not a space or a tab; 0 for a blank line (Monaco's rule). */
  getLineFirstNonWhitespaceColumn(lineNumber: number): number {
    const at = this.getLineContent(lineNumber).search(/[^ \t]/)
    return at === -1 ? 0 : at + 1
  }

  pushStackElement(): void {}

  /** Monaco's rule: the inserted text takes the model's EOL; here lines are kept apart, so `\n` splits them. */
  pushEditOperations(_before: unknown, edits: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string }[], _after: unknown): null {
    this.undoStack.push({ lines: [...this.lines], alternative: this.alternative })
    for (const edit of edits) {
      this.edits.push(edit)
      const text = this.lines.join('\n')
      const offset = (line: number, column: number): number => this.lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1
      const from = offset(edit.range.startLineNumber, edit.range.startColumn)
      const to = offset(edit.range.endLineNumber, edit.range.endColumn)
      this.lines = `${text.slice(0, from)}${edit.text.replace(/\r\n?/g, '\n')}${text.slice(to)}`.split('\n')
    }
    this.changed(false)
    return null
  }

  /** ⌘Z: back to before the last `pushEditOperations`, and its alternative id. */
  undo(): void {
    const last = this.undoStack.pop()
    if (last === undefined) return
    this.lines = last.lines
    this.version++
    this.alternative = last.alternative
    for (const listener of [...this.listeners]) listener({ isFlush: false })
  }

  setEOL(eol: number): void {
    const next = eol === CRLF ? '\r\n' : '\n'
    if (next === this.eol) return
    this.eol = next
    this.changed(false)
  }

  /** The EOL Monaco would report: `CRLF` or `LF`. */
  getEOLSequence(): number {
    return this.eol === '\r\n' ? CRLF : LF
  }

  getAlternativeVersionId(): number {
    return this.alternative
  }

  onDidChangeContent(listener: ChangeListener): { dispose: () => void } {
    this.listeners.add(listener)
    return { dispose: () => void this.listeners.delete(listener) }
  }

  isDisposed(): boolean {
    return this.disposed
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /** The user types: the text without its BOM, as Monaco shows it, with `\n` between lines. */
  type(text: string): void {
    this.lines = text.split('\n')
    this.changed(false)
  }

  /** The user undoes back to a state the model had, `alternative` its id then. */
  undoTo(text: string, alternative: number): void {
    this.lines = text.split('\n')
    this.version++
    this.alternative = alternative
    for (const listener of [...this.listeners]) listener({ isFlush: false })
  }
}

export class FakeEditor {
  /** Monaco's own key handling, at its input: what reached it. */
  readonly keysSeen: string[] = []
  readonly input: HTMLTextAreaElement
  viewState = { cursor: { lineNumber: 1, column: 1 }, scrollTop: 0 }
  restored: unknown[] = []
  /** The folded regions' start lines. */
  readonly folded = new Set<number>()
  private hiddenListeners = new Set<() => void>()
  disposed = false
  /** Every `updateOptions` patch, in order; `options` holds the merged result. */
  readonly updates: Record<string, unknown>[] = []
  /** `addAction`'s actions by id, until disposed. */
  readonly actions = new Map<string, { keybindings?: number[]; run: () => void }>()

  constructor(
    readonly mount: HTMLElement,
    readonly options: Record<string, unknown> & { model: FakeModel },
  ) {
    this.input = document.createElement('textarea')
    this.input.className = 'fake-monaco-input'
    // Monaco takes a key it binds: here every key that reaches it.
    this.input.addEventListener('keydown', (event) => {
      this.keysSeen.push(event.key)
      event.preventDefault()
    })
    mount.appendChild(this.input)
  }

  /** Where `setPosition` put the cursor, and what `revealPositionInCenter` showed (YAZ-3454 jumps). */
  position: { lineNumber: number; column: number } | null = null
  revealed: { lineNumber: number; column: number }[] = []
  private focusListeners = new Set<() => void>()

  setPosition(position: { lineNumber: number; column: number }): void {
    this.position = { ...position }
    for (const listener of [...this.cursorListeners]) listener()
  }

  /** The code Outline (YAZ-3486): the cursor, the view, the layout, and the jump's moves. */
  private cursorListeners = new Set<() => void>()
  private scrollListeners = new Set<(event: { scrollTopChanged: boolean }) => void>()
  private layoutListeners = new Set<() => void>()
  /** The lines on screen, 1-based; a test moves it with `scrollToLine`. */
  visible = { startLineNumber: 1, endLineNumber: 40 }
  /** Every `createDecorationsCollection` call: the jump's flash. */
  readonly decorations: unknown[][] = []
  /** Every selection set (a jump puts the cursor on the symbol's name). */
  readonly selections: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[] = []

  getPosition(): { lineNumber: number; column: number } | null {
    return this.position ?? this.viewState.cursor
  }

  setSelection(range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void {
    this.selections.push({ ...range })
    this.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn })
  }

  onDidChangeCursorPosition(listener: () => void): { dispose: () => void } {
    this.cursorListeners.add(listener)
    return { dispose: () => void this.cursorListeners.delete(listener) }
  }

  onDidScrollChange(listener: (event: { scrollTopChanged: boolean }) => void): { dispose: () => void } {
    this.scrollListeners.add(listener)
    return { dispose: () => void this.scrollListeners.delete(listener) }
  }

  onDidLayoutChange(listener: () => void): { dispose: () => void } {
    this.layoutListeners.add(listener)
    return { dispose: () => void this.layoutListeners.delete(listener) }
  }

  getVisibleRanges(): { startLineNumber: number; endLineNumber: number }[] {
    return [{ ...this.visible }]
  }

  /** The user scrolls the code so `line` is the first on screen. */
  scrollToLine(line: number): void {
    const span = this.visible.endLineNumber - this.visible.startLineNumber
    this.visible = { startLineNumber: line, endLineNumber: line + span }
    this.viewState.scrollTop = (line - 1) * 19
    for (const listener of [...this.scrollListeners]) listener({ scrollTopChanged: true })
  }

  getLayoutInfo(): { height: number; verticalScrollbarWidth: number; minimap: { minimapWidth: number } } {
    return { height: 760, verticalScrollbarWidth: 14, minimap: { minimapWidth: 0 } }
  }

  getTopForLineNumber(lineNumber: number): number {
    return (lineNumber - 1) * 19
  }

  getScrollHeight(): number {
    return this.options.model.getLineCount() * 19 + 760
  }

  getOption(): number {
    return 19
  }

  getDomNode(): HTMLElement {
    return this.mount
  }

  createDecorationsCollection(decorations: unknown[]): { clear: () => void } {
    this.decorations.push(decorations)
    return { clear: () => undefined }
  }

  revealPositionInCenter(position: { lineNumber: number; column: number }): void {
    this.revealed.push({ ...position })
  }

  onDidFocusEditorWidget(listener: () => void): { dispose: () => void } {
    this.focusListeners.add(listener)
    return { dispose: () => void this.focusListeners.delete(listener) }
  }

  saveViewState(): unknown {
    const collapsedRegions = [...this.folded].sort((a, b) => a - b).map((line) => ({ startLineNumber: line, endLineNumber: line + 1, isCollapsed: true }))
    return { ...structuredClone(this.viewState), contributionsState: { 'editor.contrib.folding': { collapsedRegions } } }
  }

  getModel(): FakeModel {
    return this.options.model
  }

  getScrollTop(): number {
    return this.viewState.scrollTop
  }

  setScrollTop(top: number): void {
    this.viewState.scrollTop = top
    for (const listener of [...this.scrollListeners]) listener({ scrollTopChanged: true })
  }

  onDidChangeHiddenAreas(listener: () => void): { dispose: () => void } {
    this.hiddenListeners.add(listener)
    return { dispose: () => void this.hiddenListeners.delete(listener) }
  }

  /** The user clicks a fold arrow on `line` (a region start). */
  toggleFold(line: number): void {
    if (this.folded.has(line)) this.folded.delete(line)
    else this.folded.add(line)
    for (const listener of [...this.hiddenListeners]) listener()
  }

  /** Monaco's actions run by id (`editor.trigger`), in order (YAZ-3478). */
  readonly triggered: string[] = []

  /** The region start lines: each line that ends with `{`, as the folding controller below. */
  private regionStarts(): number[] {
    const model = this.options.model
    const starts: number[] = []
    for (let line = 1; line <= model.getLineCount(); line++) if (model.getLineContent(line).trimEnd().endsWith('{')) starts.push(line)
    return starts
  }

  private hiddenChanged(): void {
    for (const listener of [...this.hiddenListeners]) listener()
  }

  /** The cursor's line: where `setPosition` put it, else the view state's. */
  private cursorLine(): number {
    return (this.position ?? this.viewState.cursor).lineNumber
  }

  /** The cursor is in the code: the fake input has the focus. */
  hasTextFocus(): boolean {
    return document.activeElement === this.input
  }

  /**
   * Monaco's fold actions and the top / bottom moves, as Monaco runs them: fold all, unfold all, and
   * fold / unfold the innermost region that starts at or above the cursor.
   */
  trigger(_source: string, id: string): void {
    this.triggered.push(id)
    const starts = this.regionStarts()
    const line = this.cursorLine()
    if (id === 'editor.foldAll') {
      for (const start of starts) this.folded.add(start)
      this.hiddenChanged()
    } else if (id === 'editor.unfoldAll') {
      this.folded.clear()
      this.hiddenChanged()
    } else if (id === 'editor.fold') {
      const start = starts.filter((s) => s <= line && !this.folded.has(s)).at(-1)
      if (start !== undefined) this.toggleFold(start)
    } else if (id === 'editor.unfold') {
      const start = starts.filter((s) => s <= line && this.folded.has(s)).at(-1)
      if (start !== undefined) this.toggleFold(start)
    } else if (id === 'cursorTop' || id === 'cursorTopSelect') {
      this.position = { lineNumber: 1, column: 1 }
    } else if (id === 'cursorBottom' || id === 'cursorBottomSelect') {
      this.position = { lineNumber: this.options.model.getLineCount(), column: 1 }
    }
  }

  /** The line of the `}` that closes the region starting on `start` (brace count). */
  private regionEnd(start: number): number {
    const model = this.options.model
    let depth = 0
    for (let line = start; line <= model.getLineCount(); line++) {
      for (const ch of model.getLineContent(line)) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0
      if (depth <= 0 && line > start) return line
    }
    return model.getLineCount()
  }

  /** Only the folding controller: its model's regions start on each line that ends with `{`. */
  getContribution(id: string): unknown {
    if (id !== 'editor.contrib.folding') return null
    return {
      getFoldingModel: async () => {
        const model = this.options.model
        const starts: number[] = []
        for (let line = 1; line <= model.getLineCount(); line++) if (model.getLineContent(line).trimEnd().endsWith('{')) starts.push(line)
        return {
          regions: { length: starts.length, getStartLineNumber: (i: number) => starts[i], getEndLineNumber: (i: number) => this.regionEnd(starts[i]), isCollapsed: (i: number) => this.folded.has(starts[i]), toRegion: (i: number) => starts[i] },
          toggleCollapseState: (regions: number[]) => {
            for (const line of regions) this.toggleFold(line)
          },
        }
      },
    }
  }

  restoreViewState(state: unknown): void {
    this.restored.push(state)
  }

  focus(): void {
    this.input.focus()
    for (const listener of [...this.focusListeners]) listener()
  }

  updateOptions(patch: Record<string, unknown>): void {
    this.updates.push(patch)
    Object.assign(this.options, patch)
  }

  addAction(action: { id: string; keybindings?: number[]; run: () => void }): { dispose: () => void } {
    this.actions.set(action.id, action)
    return { dispose: () => void this.actions.delete(action.id) }
  }

  /** The user presses an action's key (⌥Z): Monaco runs it. */
  runAction(id: string): void {
    const action = this.actions.get(id)
    if (action === undefined) throw new Error(`no action ${id}`)
    action.run()
  }

  dispose(): void {
    this.disposed = true
    this.hiddenListeners.clear()
    this.input.remove()
  }
}

export const created: { editors: FakeEditor[]; models: FakeModel[] } = { editors: [], models: [] }

/** A URI with what the code tab reads: its parts, `fsPath` and `toString`. */
export interface FakeUri {
  scheme: string
  authority: string
  path: string
  fsPath: string
  toString(): string
}
const fakeUri = (parts: { scheme: string; authority: string; path: string }): FakeUri => ({ ...parts, fsPath: parts.path, toString: () => `${parts.scheme}://${parts.authority}${parts.path}` })

/** The language providers and the editor opener the code tab registers (YAZ-3454), by kind. */
export const registered: { definition: Map<string, unknown>; references: Map<string, unknown>; hover: Map<string, unknown>; openers: unknown[] } = { definition: new Map(), references: new Map(), hover: new Map(), openers: [] }
const register = (into: Map<string, unknown>) => (language: string, provider: unknown) => {
  into.set(language, provider)
  return { dispose: () => void into.delete(language) }
}

export const monaco = {
  Uri: { from: (parts: { scheme: string; authority: string; path: string }) => fakeUri(parts), file: (path: string) => fakeUri({ scheme: 'file', authority: '', path }) },
  KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512, WinCtrl: 256 },
  KeyCode: { KeyZ: 56 },
  Range: class {
    constructor(
      readonly startLineNumber: number,
      readonly startColumn: number,
      readonly endLineNumber: number,
      readonly endColumn: number,
    ) {}
  },
  languages: {
    registerDefinitionProvider: register(registered.definition),
    registerReferenceProvider: register(registered.references),
    registerHoverProvider: register(registered.hover),
  },
  editor: {
    /** The markers of each model by URI (the code Outline's error marks); a test sets them with `setMarkers`. */
    getModelMarkers: ({ resource }: { resource: FakeUri }) => markers.get(resource.toString()) ?? [],
    onDidChangeMarkers: (listener: (uris: FakeUri[]) => void) => {
      markerListeners.add(listener)
      return { dispose: () => void markerListeners.delete(listener) }
    },
    EditorOption: { lineHeight: 75 },
    registerEditorOpener: (opener: unknown) => {
      registered.openers.push(opener)
      return { dispose: () => void registered.openers.splice(registered.openers.indexOf(opener), 1) }
    },
    getModel: (uri: FakeUri) => created.models.find((m) => !m.isDisposed() && m.uri.toString() === uri.toString()) ?? null,
    EndOfLineSequence: { LF, CRLF },
    EndOfLinePreference: { TextDefined: 0, LF: 1, CRLF: 2 },
    createModel: (text: string, _language: string | undefined, uri: FakeUri) => {
      const model = new FakeModel(text, uri)
      created.models.push(model)
      return model
    },
    create: (mount: HTMLElement, options: Record<string, unknown> & { model: FakeModel }) => {
      const editor = new FakeEditor(mount, options)
      created.editors.push(editor)
      return editor
    },
  },
}

export const applyAppTheme = vi.fn<(theme: 'light' | 'dark') => void>()

/** Monaco's markers (the code Outline, YAZ-3486): by model URI. */
const markers = new Map<string, { severity: number; startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number; message: string }[]>()
const markerListeners = new Set<(uris: FakeUri[]) => void>()

/** The TS worker reports `list` for `model` (Monaco's `setModelMarkers`). */
export function setMarkers(model: FakeModel, list: { severity: number; startLineNumber: number; startColumn: number; endLineNumber?: number; endColumn?: number; message?: string }[]): void {
  markers.set(model.uri.toString(), list.map((m) => ({ endLineNumber: m.startLineNumber, endColumn: m.startColumn + 1, message: '', ...m })))
  for (const listener of [...markerListeners]) listener([model.uri])
}

/** Between tests: forget every editor and model made. */
export function resetFakeMonaco(): void {
  created.editors.length = 0
  created.models.length = 0
  applyAppTheme.mockClear()
  markers.clear()
  markerListeners.clear()
}
