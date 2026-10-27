/**
 * A code file open in a tab (YAZ-3448, D1/D2): Monaco, VS Code's editor, on the document host — save
 * and sync chips, conflict bar, 500 ms autosave, quit flush, rename continuity, all from
 * `useDocumentHost`, exactly as a drawing. Its own chunk, loaded lazily by `Editor.tsx`, and Monaco
 * in the next (`./monaco`): a window with no code tab loads neither.
 *
 * NOTHING HEAVY PER KEYSTROKE. The host's `Autosave<number>` is fed the model's alternative version
 * id, Monaco's own change counter — and the one that returns to the saved value when an undo goes
 * back to it, so undoing to the saved text is clean again. The text is made once per save, in `write`.
 *
 * THE BYTES (YAZ-3445 D3). The model is born with every line break as the file's first one
 * (`withOneLineBreak`), so its EOL is `lineBreakOf` the file, and `getValue` keeps a leading BOM. A
 * save writes what was read, the edits aside. A code file has no read-only switch (`readOnlySwitch:
 * false`); 2C adds the code rule.
 *
 * THE APP'S KEYS WIN (YAZ-3447). A keydown in the capture phase, on this tab's own element, before
 * Monaco: the menu's commands (`HOTKEY_COMMANDS`, as the user set them) stop there, so Monaco never
 * takes one and the menu's accelerator runs — ⌘K is the vault search, never Monaco's chord prefix.
 * Toggle sidebar, which the renderer owns, is handed up as a diagram does (`onToggleSidebar`). ⌘S
 * saves at once, as on a drawing.
 */
import { useEffect, useRef } from 'react'
import { HOTKEY_COMMANDS, fromKeyEvent, keyFor, sameKey, type HotkeyId, type HotkeyOverrides, type KeyPress } from '@shared/hotkeyBindings'
import { api, BridgeRequestError } from '../api'
import { DocumentShell } from '../documents/DocumentShell'
import { DocumentChips, useDocumentHost, type DocumentHostProps } from '../documents/useDocumentHost'
import type { NoticeKind } from '../lib/notice'
import { storage } from '../lib/storage'
import { useAppliedTheme } from '../lib/theme'
import { lineBreakOf, withOneLineBreak } from './lineBreak'
import { applyAppTheme, monaco } from './monaco'
import { monacoThemeName } from './monacoTheme'
import './codeEditor.css'

/** What a code file that will not open says; main's reason follows it when there is one. */
export const BROKEN_CODE_DOCUMENT = "This file can't be opened"

export interface CodeEditorProps extends DocumentHostProps {
  /** The window's ONE passive notice. */
  onNotice?: (text: string, icon?: NoticeKind) => void
  /** App's sidebar toggle: the renderer owns ⌘B, and Monaco's element would never pass it up. */
  onToggleSidebar?: () => void
}

interface LoadedCode {
  text: string
  mtime: number
}

const loadCode = (req: { root: string; path: string }): Promise<LoadedCode> => api.readFile(req.path).then((res) => ({ text: res.content, mtime: res.mtime }))

/** Missing, too big, not UTF-8: ONE readable state naming why, never a blank pane. */
function brokenCode(err: unknown): string {
  const why = err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? 'the file is missing' : err instanceof BridgeRequestError && err.message !== '' ? err.message : null
  return why === null ? `${BROKEN_CODE_DOCUMENT}.` : `${BROKEN_CODE_DOCUMENT}: ${why}.`
}

/**
 * The app command a keydown is, by the keys as they are NOW (YAZ-3397 D2: a changed key works at
 * once); null for every key Monaco may have. Off a Mac, `CmdOrCtrl` is Ctrl — and there the page
 * sees a key before the menu, so a Ctrl+K that Monaco took would never reach it.
 */
export function appCommandOf(event: KeyPress, overrides: HotkeyOverrides | undefined, mac = /Mac/.test(navigator.platform)): HotkeyId | null {
  const pressed = [fromKeyEvent(event), !mac && event.ctrlKey && !event.metaKey ? fromKeyEvent({ ...event, ctrlKey: false, metaKey: true }) : null]
  return HOTKEY_COMMANDS.find((c) => pressed.some((p) => p !== null && sameKey(keyFor(c.id, overrides), p)))?.id ?? null
}

/** Each code tab's model needs its own URI (two tabs may hold one file); the path keeps its extension, which picks the language. */
let nextTab = 0

/** The model's line break for a file's text (YAZ-3445 D3). */
const eolOf = (text: string) => (lineBreakOf(text) === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)

export function CodeEditor(props: CodeEditorProps) {
  return (
    <DocumentShell root={props.root} path={props.path} className="editor--code" load={loadCode} errorText={brokenCode}>
      {(loaded) => <CodeHost {...props} loaded={loaded} />}
    </DocumentShell>
  )
}

interface CodeHostProps extends CodeEditorProps {
  loaded: LoadedCode
}

/** Mounts exactly one Monaco editor and model for `loaded`; the document host owns everything that writes. */
function CodeHost({ root, path, loaded, watch, sync, onSyncNow, onNotice, onToggleSidebar }: CodeHostProps) {
  const theme = useAppliedTheme()
  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ReturnType<typeof monaco.editor.create> | null>(null)
  const modelRef = useRef<ReturnType<typeof monaco.editor.createModel> | null>(null)
  /** The text at unmount: a close flushes after the model is gone (see `textNow`). */
  const closedText = useRef<string | null>(null)
  /** True while a reload puts disk truth in: those changes are not edits. */
  const applyingDisk = useRef(false)
  const sidebarRef = useRef(onToggleSidebar)
  sidebarRef.current = onToggleSidebar

  /** The bytes to write: the model's value with its BOM, or the text it held when the tab closed. */
  const textNow = (): string => {
    const model = modelRef.current
    if (model !== null && !model.isDisposed()) return model.getValue(monaco.editor.EndOfLinePreference.TextDefined, true)
    if (closedText.current !== null) return closedText.current
    throw new Error('the code editor is closed')
  }

  const doc = useDocumentHost({
    root,
    path,
    watch,
    sync,
    onSyncNow,
    onNotice,
    readOnlySwitch: false,
    write: (expectedMtime) => api.writeFile({ path, content: textNow(), expectedMtime }),
    // Disk truth in, the cursor and the scroll kept where they still fit; then the new baseline.
    reload: async (a) => {
      const res = await api.readFile(path)
      const editor = editorRef.current
      const model = modelRef.current
      if (editor === null || model === null || model.isDisposed()) return
      const view = editor.saveViewState()
      applyingDisk.current = true
      try {
        model.setValue(withOneLineBreak(res.content))
        model.setEOL(eolOf(res.content))
      } finally {
        applyingDisk.current = false
      }
      if (view !== null) editor.restoreViewState(view)
      a.reset(model.getAlternativeVersionId(), res.mtime)
    },
    // The menu's board commands (Export image…) mean nothing in a code file.
    onCommand: () => undefined,
    focus: () => editorRef.current?.focus(),
  })
  const { start, autosave } = doc

  // One editor and one model for the host's life; both disposed with it (no leak per tab).
  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return
    applyAppTheme(theme)
    const uri = monaco.Uri.from({ scheme: 'code-tab', authority: `t${++nextTab}`, path })
    const model = monaco.editor.createModel(withOneLineBreak(loaded.text), undefined, uri)
    model.setEOL(eolOf(loaded.text))
    const editor = monaco.editor.create(mount, {
      model,
      theme: monacoThemeName(theme),
      automaticLayout: true,
      // D6's quiet layout; 2C puts wrap and the minimap under Settings › Code.
      lineNumbers: 'on',
      showFoldingControls: 'always',
      stickyScroll: { enabled: true },
      bracketPairColorization: { enabled: true },
      minimap: { enabled: false },
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      // The tab's section clips its overflow: hovers, suggestions and the peek box must not be cut.
      fixedOverflowWidgets: true,
    })
    modelRef.current = model
    editorRef.current = editor
    const changes = model.onDidChangeContent(() => {
      // A reload is disk truth, never an edit: the reload resets the baseline itself.
      if (!applyingDisk.current) autosave.current?.update(model.getAlternativeVersionId())
    })
    start(model.getAlternativeVersionId(), loaded.mtime)
    return () => {
      changes.dispose()
      closedText.current = model.getValue(monaco.editor.EndOfLinePreference.TextDefined, true)
      editor.dispose()
      model.dispose()
      editorRef.current = null
      modelRef.current = null
    }
    // Mount once: `loaded` and `path` are fixed for this host (the shell keys it by path), and a theme change is the effect below.
  }, [])

  // Appearance, live (S2): one theme for every Monaco on the page, rebuilt from the tokens now applied.
  useEffect(() => {
    if (editorRef.current !== null) applyAppTheme(theme)
  }, [theme])

  // The app's keys win (see the module doc): capture phase, so Monaco never sees them.
  const { flush } = doc
  useEffect(() => {
    const host = doc.hostRef.current
    if (host === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        flush()
        return
      }
      const command = appCommandOf(event, storage.getSettings()?.hotkeys)
      if (command === null || command === 'copyPath') return
      event.stopPropagation()
      if (command !== 'toggleSidebar') return // a menu accelerator: the menu runs it
      event.preventDefault()
      sidebarRef.current?.()
    }
    host.addEventListener('keydown', onKeyDown, true)
    return () => host.removeEventListener('keydown', onKeyDown, true)
  }, [doc.hostRef, flush])

  return (
    <div className="code-editor" ref={doc.hostRef}>
      <DocumentChips store={doc.chips} className="status-chips" />
      {doc.conflictBar}
      <div className="code-editor__monaco" ref={mountRef} />
    </div>
  )
}
