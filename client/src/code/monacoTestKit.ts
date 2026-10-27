/**
 * A stand-in for `./monaco` (YAZ-3448): Monaco does not run in jsdom, so the code tab's suites mock
 * that one module with this — `vi.mock('./monaco', () => import('./monacoTestKit'))`. It keeps only
 * what `CodeEditor` uses, and the model keeps Monaco's rules that the bytes depend on: a leading BOM
 * is held apart and `getValue(_, true)` gives it back, the EOL is the break MOST lines use (so the
 * tests prove `withOneLineBreak` decides it), `setValue` is a flush, and the alternative version id
 * returns to an old value on an undo. Test-only; nothing ships it.
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

  getValue(_eol?: number, preserveBOM = false): string {
    if (this.disposed) throw new Error('Model is disposed!')
    return `${preserveBOM && this.bom ? '﻿' : ''}${this.lines.join(this.eol)}`
  }

  setValue(text: string): void {
    this.load(text)
    this.changed(true)
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
  disposed = false

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
  }

  revealPositionInCenter(position: { lineNumber: number; column: number }): void {
    this.revealed.push({ ...position })
  }

  onDidFocusEditorWidget(listener: () => void): { dispose: () => void } {
    this.focusListeners.add(listener)
    return { dispose: () => void this.focusListeners.delete(listener) }
  }

  saveViewState(): unknown {
    return structuredClone(this.viewState)
  }

  restoreViewState(state: unknown): void {
    this.restored.push(state)
  }

  focus(): void {
    this.input.focus()
    for (const listener of [...this.focusListeners]) listener()
  }

  dispose(): void {
    this.disposed = true
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

/** Between tests: forget every editor and model made. */
export function resetFakeMonaco(): void {
  created.editors.length = 0
  created.models.length = 0
  applyAppTheme.mockClear()
}
