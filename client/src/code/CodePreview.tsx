/**
 * A code file in Quick Look (YAZ-3450): the code tab's Monaco, read only, in the app's colours. Its own
 * chunk, which `QuickLook` loads with `lazy()`; it imports `./monaco`, so Monaco loads only when a code
 * file is held up. It replaces the plain `<pre>` of `TextViewer` (YAZ-1299).
 *
 * READ, NEVER OPEN (YAZ-2662 S42): no document host, no autosave, no folds stored. The file comes
 * through `useFile`, the one read door, again on a watcher `change` of this path; the model takes the
 * new text with `setValue` (nothing to undo here). It takes no focus when it shows: the caret stays in
 * the search bar, and Esc goes on to the panel, which closes.
 *
 * One editor and one model for its life, both disposed with it. The model's URI is its own,
 * `code-look://q<n>/<path>`, never a code tab's: the extension picks the language.
 */
import { useEffect, useRef, useState } from 'react'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { storage } from '../lib/storage'
import { useAppliedTheme } from '../lib/theme'
import { applyAppTheme, monaco } from './monaco'
import { monacoThemeName } from './monacoTheme'
import './codeEditor.css'

export interface CodePreviewProps {
  path: string
  watch: WatchSource
}

let nextLook = 0

export default function CodePreview({ path, watch }: CodePreviewProps) {
  const theme = useAppliedTheme()
  const [revision, setRevision] = useState(0)
  useEffect(
    () =>
      watch.subscribe((event) => {
        if (event.type === 'change' && event.path === path) setRevision((current) => current + 1)
      }),
    [path, watch],
  )
  const state = useFile(path, revision)
  const candidate = state.status === 'ready' ? state.file : state.status === 'loading' || state.status === 'error' ? state.prev : null
  const text = candidate?.path === path ? candidate.content : null

  const mountRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<ReturnType<typeof monaco.editor.createModel> | null>(null)
  const hasText = text !== null

  // Made once the first text is here; the effect below hands it every later one.
  useEffect(() => {
    const mount = mountRef.current
    if (mount === null || !hasText) return
    applyAppTheme(theme)
    const model = monaco.editor.createModel('', undefined, monaco.Uri.from({ scheme: 'code-look', authority: `q${++nextLook}`, path }))
    const editor = monaco.editor.create(mount, {
      model,
      theme: monacoThemeName(theme),
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      lineNumbers: 'on',
      showFoldingControls: 'always',
      stickyScroll: { enabled: true },
      bracketPairColorization: { enabled: true },
      minimap: { enabled: false },
      wordWrap: storage.getSettings()?.codeWrap === false ? 'off' : 'on',
      scrollBeyondLastLine: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      fixedOverflowWidgets: true,
    })
    modelRef.current = model
    return () => {
      editor.dispose()
      model.dispose()
      modelRef.current = null
    }
    // Once per panel: `QuickLook` keys this view by path, and a theme change is the effect below.
  }, [hasText])

  useEffect(() => {
    const model = modelRef.current
    if (model !== null && text !== null && model.getValue() !== text) model.setValue(text)
  }, [text, hasText])

  useEffect(() => {
    if (modelRef.current !== null) applyAppTheme(theme)
  }, [theme])

  return (
    <div className="code-preview" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && text === null && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="editor-msg editor-msg--error" role="status">{state.message}</p>}
      <div className="code-editor__monaco" ref={mountRef} hidden={text === null} />
    </div>
  )
}
