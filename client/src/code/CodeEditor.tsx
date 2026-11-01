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
 * save writes what was read, the edits aside.
 *
 * READ ONLY, WRAP, MINIMAP (YAZ-3449; YAZ-3438 D5, D6, D8) are app settings, never a file's: the host runs
 * with `readOnlySwitch: false`, and the tab's own cog (`CodeChips`) changes the setting for every code tab.
 * Each tab follows them live. "Allow edits" on the chip unlocks this tab until it closes; the setting going
 * on again locks it again. ⌥Z flips this tab's wrap and saves nothing; a change of the setting overrides it.
 *
 * A NOTE TAB'S FEATURES (YAZ-3451, D7): Monaco's find box (⌘F, ⌘⌥F); folds remembered by the text of
 * their first line (`codeFolds.ts`); the note's text size (⌘+ / ⌘− / ⌘0, the zoom pill), per tab, never
 * stored; "Duplicate tab" reads folds, scroll and text size through `registerPageView`. An outside
 * reload is ONE undoable edit over the part that changed (`reloadEdit.ts`): ⌘Z still works after it.
 * Scroll and cursor survive a tab switch because the tab stays mounted (a hidden layer sends Monaco's
 * `ResizeObserver` nothing, so it keeps its layout).
 *
 * THE APP'S KEYS WIN (YAZ-3447). A keydown in the capture phase, on this tab's own element, before
 * Monaco: the menu's commands (`HOTKEY_COMMANDS`, as the user set them) stop there, so Monaco never
 * takes one and the menu's accelerator runs — ⌘K is the vault search, never Monaco's chord prefix.
 * Toggle sidebar is a menu key too since YAZ-3564 D10. An App key that steps aside in code (YAZ-3564 K9)
 * goes on to Monaco. Save now (⌘S, the row `code.save`) saves at once, as on a drawing.
 *
 * THE CODE KEYS (YAZ-3564 K4) are Monaco's, as the key list and the user's changes say (`codeKeys.ts`): one rule
 * set for the window, live. The note's fold keys are code rows there too (YAZ-3478): ⌘⇧U folds every block, ⌘⇧I
 * unfolds every block, ⌘↑ / ⌘↓ fold / unfold the block at the cursor, each a rule on Monaco's own fold action, so
 * the folds are remembered as any fold is. While the suggest list is open they step aside, and ⌘↑ / ⌘↓ move in the
 * list (K14). On a Mac ⌘↑ / ⌘↓ therefore do not go to the top / bottom of the file: ⌘Home / ⌘End do (with ⇧,
 * they select). A right-click on a fold chevron opens the app's menu: "Collapse all", "Expand all", with the keys
 * as they are now.
 *
 * THE TABLE OF CONTENTS (YAZ-3486; called so since YAZ-3506): VS Code's Outline in the note table of
 * contents' place and frame (`outline/CodeOutline.tsx`), on the same setting and width. Its feed
 * (`outline/outlineFeed.ts`) is made with the editor and goes with it. The cog's "Table of contents" row
 * turns it off for this file only, saved with the file as a note's is (`tocSwitches`, `usePageSwitch`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, TOC_DEFAULT_W, type CodeOutlineSort, type CodeSymbolKind, type PageView, type TableOfContents as TableOfContentsMode, type ZoomStep } from '@shared/types'
import { HOTKEY_COMMANDS, appKeyId, keyFor, sameKey, type HotkeyId, type HotkeyOverrides, type KeyPress } from '@shared/hotkeyBindings'
import { keyRow, stepsAside, type HotkeyAside } from '@shared/keys'
import { api, BridgeRequestError } from '../api'
import { DocumentShell } from '../documents/DocumentShell'
import { DocumentChips, useDocumentHost, type DocumentHostProps } from '../documents/useDocumentHost'
import { stepZoomByKey } from '../editor/DocumentZoom'
import type { FoldNext } from '../editor/FoldAllButton'
import { usePageSwitch } from '../editor/usePageSwitch'
import { ZOOM_EVENT } from '../editor/zoomRequest'
import { hintOf } from '../lib/keyHint'
import type { NoticeKind } from '../lib/notice'
import { registerPageView } from '../lib/pageView'
import { storage } from '../lib/storage'
import { useAppliedTheme } from '../lib/theme'
import { ContextMenu } from '../sidebar/ContextMenu'
import { CodeChips } from './CodeChips'
import { attachFolds } from './codeFolds'
import { addWrapAction, isCodeKey, pressedKeys } from './codeKeys'
import type { CodeSettingsPatch } from './codeSettings'
import { keepBackView, takeBackView, trackCodeTab } from './codeOpener'
import { attachLanguageClient } from './languageClient'
import { lineBreakOf, withOneLineBreak } from './lineBreak'
import { applyAppTheme, monaco } from './monaco'
import { foldingModelOf } from './monacoInternals'
import { attachMenuLook } from './monacoMenuLook'
import { monacoThemeName } from './monacoTheme'
import { CodeOutline, type OutlineEditorLike } from './outline/CodeOutline'
import { attachOutlineFeed, type OutlineFeed } from './outline/outlineFeed'
import { LARGE_CODE_CHARS, readSymbols } from './outline/symbolSource'
import { diskEdit } from './reloadEdit'
import './codeEditor.css'

/** What a code file that will not open says; main's reason follows it when there is one. */
export const BROKEN_CODE_DOCUMENT = "This file can't be opened"

export interface CodeEditorProps extends DocumentHostProps {
  /** The window's ONE passive notice. */
  onNotice?: (text: string, icon?: NoticeKind) => void
  /** Settings › Code (YAZ-3449): one value for every code tab; absent = the default. */
  codeReadOnly?: boolean
  codeWrap?: boolean
  codeMinimap?: boolean
  /** The cog's rows and the Outline's "…" menu write these settings for every code file; absent = no cog. */
  onChangeCodeSettings?: (patch: CodeSettingsPatch) => void
  /** The Outline (YAZ-3486) on the note's setting (Settings › "Pin default") and width; absent = off. */
  tableOfContents?: TableOfContentsMode
  /** Settings › "Table of contents default" (YAZ-3558): for a file that made no choice in its cog. Absent = the default, on. */
  tocOnByDefault?: boolean
  onChangeTableOfContents?: (mode: TableOfContentsMode) => void
  tableOfContentsWidth?: number
  onChangeTableOfContentsWidth?: (width: number) => void
  /** The Outline's "…" menu: Sort by, and the kinds it hides. Absent = Position, none hidden. */
  codeOutlineSort?: CodeOutlineSort
  codeOutlineHidden?: readonly CodeSymbolKind[]
  /** "…" › Show › "Variables inside functions" (YAZ-3507). Absent = off: names inside functions are not rows. */
  codeOutlineLocals?: boolean
  /** A copied tab's start (YAZ-2951 D1, YAZ-3451 S5): its source's folds, scroll and text size. Read at mount only. */
  startView?: PageView
  /** A jump to another file (YAZ-3454, D10): the tab's own link door, so Back returns. */
  onOpenFile?: (path: string) => void
  /** This tab's history entry (App: `<tab id>:<index>`): Back or Forward to it puts back the cursor and scroll it was left with. */
  viewKey?: string
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
 * sees a key before the menu, so a Ctrl+K that Monaco took would never reach it. A command that
 * steps aside in code (YAZ-3564 K9) is not one: the menu drops its key on a code tab, and Monaco has it.
 */
export function appCommandOf(event: KeyPress, overrides: HotkeyOverrides | undefined, mac = /Mac/.test(navigator.platform), aside?: HotkeyAside): HotkeyId | null {
  const pressed = pressedKeys(event, mac)
  const inCode = (id: HotkeyId): boolean => {
    const row = keyRow(appKeyId(id))
    return row !== undefined && stepsAside(row, 'code', aside)
  }
  return HOTKEY_COMMANDS.find((c) => !inCode(c.id) && pressed.some((p) => sameKey(keyFor(c.id, overrides), p)))?.id ?? null
}

const BOM = '\uFEFF'
const BOM_AT_START = /^\uFEFF/

/** A fold chevron in Monaco's gutter: expanded, collapsed, or a manual fold's. */
const FOLD_CHEVRON = '.margin-view-overlays [class*="codicon-folding-"]'

/** Each code tab's model needs its own URI (two tabs may hold one file); the path keeps its extension, which picks the language. */
let nextTab = 0

/** Monaco's text size at 100 %; the tab's zoom scales it. */
const FONT_SIZE = 13

/**
 * Sticky scroll's source for a text of `length` characters: the symbols, or, from `LARGE_CODE_CHARS` (YAZ-3501),
 * the file's indentation. Monaco's symbol path runs on the page's thread after each pause in the typing: about
 * 500 ms for `big-5mb.ts`, and in proportion below it. The indentation model costs nothing that a key waits for,
 * and it pins the same lines in code that is indented as usual. Monaco turns sticky scroll off by itself only
 * from 20 MB or 300 000 lines. The size is read when the tab opens.
 */
export const stickyModelFor = (length: number): 'outlineModel' | 'indentationModel' => (length >= LARGE_CODE_CHARS ? 'indentationModel' : 'outlineModel')

/**
 * Monaco's colour finder and link finder for a text of `length` characters (YAZ-3526). After each pause in the
 * typing, each finder reads the whole file in a worker. Each colour or link that it finds then becomes one
 * decoration on the page's thread, and each frame walks them all. A 7 MB CSS file (144 000 colours) cost about
 * 300 to 400 ms; a 6 MB HTML file (52 000 links) about 200 ms. From `LARGE_CODE_CHARS` both finders are off:
 * no colour swatch, and a link is plain text. Below it both stay on, as in VS Code. The size is read when the
 * tab opens.
 */
export const findersFor = (length: number): { colorDecorators: boolean; links: boolean } => {
  const on = length < LARGE_CODE_CHARS
  return { colorDecorators: on, links: on }
}

/** The model's line break for a file's text (YAZ-3445 D3). */
const eolOf = (text: string) => (lineBreakOf(text) === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)

const NO_KINDS: readonly CodeSymbolKind[] = []
const noChange = (): void => undefined

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
function CodeHost({ root, path, loaded, watch, sync, onSyncNow, onNotice, codeReadOnly = DEFAULT_SETTINGS.codeReadOnly, codeWrap = DEFAULT_SETTINGS.codeWrap, codeMinimap = DEFAULT_SETTINGS.codeMinimap, onChangeCodeSettings, startView, onOpenFile, viewKey, tableOfContents = 'off', tocOnByDefault = DEFAULT_SETTINGS.tocOnByDefault, onChangeTableOfContents = noChange, tableOfContentsWidth = TOC_DEFAULT_W, onChangeTableOfContentsWidth = noChange, codeOutlineSort = 'position', codeOutlineHidden = NO_KINDS, codeOutlineLocals = false }: CodeHostProps) {
  const theme = useAppliedTheme()
  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ReturnType<typeof monaco.editor.create> | null>(null)
  const modelRef = useRef<ReturnType<typeof monaco.editor.createModel> | null>(null)
  /** The text at unmount: a close flushes after the model is gone (see `textNow`). */
  const closedText = useRef<string | null>(null)
  /** True while a reload puts disk truth in: those changes are not edits. */
  const applyingDisk = useRef(false)
  /** "Allow edits" on this tab's chip (YAZ-3449 S2): this tab only, until it closes. */
  const [unlocked, setUnlocked] = useState(false)
  const [askingUnlock, setAskingUnlock] = useState(false)
  const locked = codeReadOnly && !unlocked
  /** This tab's wrap: the setting, or ⌥Z's flip of it until the setting changes (S4). */
  const wrap = useRef(codeWrap)
  /** The text size, per tab (YAZ-3451): a copy starts at its source's (S5); never stored. */
  const [zoom, setZoom] = useState(startView?.magnification ?? 100)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  // This file's "Table of contents" row (YAZ-3506): Settings › "Table of contents default" until this file makes its own
  // choice, which wins, also over Off (YAZ-3558 D1). Saved with the file in the app state, as a note's is.
  const [tocOn, toggleToc] = usePageSwitch(root, path, storage.getTocSwitch, storage.setTocSwitch, tocOnByDefault)
  const tocMode: TableOfContentsMode = tocOn ? tableOfContents : 'off'
  /** The values the editor is born with; the effects below follow every change after. */
  const born = useRef({ locked, codeWrap, codeMinimap, zoom, startView, outlineOn: tocMode !== 'off', outlineLocals: codeOutlineLocals })
  const openRef = useRef(onOpenFile)
  openRef.current = onOpenFile
  // A rename or a delete elsewhere in the stack can move this entry's index while the tab stays mounted.
  const backKeyRef = useRef(viewKey === undefined ? undefined : `${viewKey}\0${path}`)
  backKeyRef.current = viewKey === undefined ? undefined : `${viewKey}\0${path}`
  /** The chevron's right-click menu (YAZ-3478), at the pointer; null while closed. */
  const [foldMenu, setFoldMenu] = useState<{ x: number; y: number } | null>(null)
  /** The Outline's editor and feed (YAZ-3486): set once the editor exists, cleared with it. */
  const [outline, setOutline] = useState<{ editor: OutlineEditorLike; feed: OutlineFeed } | null>(null)

  /** A chevron menu row or the fold-all chip (YAZ-3938): Monaco's own action, so the folds are saved as any fold is (`attachFolds`). */
  const runFold = (action: 'editor.foldAll' | 'editor.unfoldAll'): void => {
    editorRef.current?.trigger('keyboard', action, null)
  }

  /** What the fold-all chip does now (YAZ-3938 D4): collapse while a block is open, expand once every block is folded. */
  const readFold = async (): Promise<FoldNext> => {
    const editor = editorRef.current
    const folding = editor === null ? null : await foldingModelOf(editor)
    if (folding == null || folding.regions.length === 0) return 'none'
    for (let i = 0; i < folding.regions.length; i++) if (!folding.regions.isCollapsed(i)) return 'collapse'
    return 'expand'
  }
  /**
   * The chip's chevrons (YAZ-3938 D9): it reads again when the hidden lines change, which is a fold or an unfold
   * (a chevron, a key, the chip), never a plain keystroke. `outline` is set once the editor exists.
   */
  const subscribeFolds = useCallback((changed: () => void) => {
    const editor = editorRef.current
    if (outline === null || editor === null) return () => {}
    const listener = editor.onDidChangeHiddenAreas(changed)
    return () => listener.dispose()
  }, [outline])

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
    // Disk truth in as ONE undoable edit over the part that changed (YAZ-3451): ⌘Z still works after
    // it, and the cursor, folds and scroll anchor outside it stay. Then the new baseline.
    reload: async (a) => {
      const res = await api.readFile(path)
      const model = modelRef.current
      if (editorRef.current === null || model === null || model.isDisposed()) return
      const next = withOneLineBreak(res.content)
      const old = model.getValue(monaco.editor.EndOfLinePreference.LF, true)
      applyingDisk.current = true
      try {
        // Monaco keeps the BOM apart from the text: only `setValue` can add or drop one (and it clears undo).
        if (old.startsWith(BOM) !== next.startsWith(BOM)) model.setValue(next)
        else {
          const edit = diskEdit(old.replace(BOM_AT_START, ''), next.replace(BOM_AT_START, '').replace(/\r\n?/g, '\n'))
          if (edit !== null) {
            model.pushStackElement()
            model.pushEditOperations([], [edit], () => null)
            model.pushStackElement()
          }
        }
        model.setEOL(eolOf(res.content))
      } finally {
        applyingDisk.current = false
      }
      a.reset(model.getAlternativeVersionId(), res.mtime)
    },
    // The menu's board commands (Export image…) mean nothing in a code file.
    onCommand: () => undefined,
    focus: () => editorRef.current?.focus(),
  })
  const { start, autosave, retired } = doc

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
      fontSize: (FONT_SIZE * born.current.zoom) / 100,
      // D6's quiet layout; wrap, the minimap and read only are Settings › Code (YAZ-3449).
      lineNumbers: 'on',
      showFoldingControls: 'always',
      stickyScroll: { enabled: true, defaultModel: stickyModelFor(model.getValueLength()) },
      ...findersFor(model.getValueLength()),
      bracketPairColorization: { enabled: true },
      minimap: { enabled: born.current.codeMinimap },
      wordWrap: born.current.codeWrap ? 'on' : 'off',
      readOnly: born.current.locked,
      scrollBeyondLastLine: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      // The tab's section clips its overflow: hovers, suggestions and the peek box must not be cut.
      fixedOverflowWidgets: true,
    })
    modelRef.current = model
    editorRef.current = editor
    // ⌥Z (D8): VS Code's "Toggle Word Wrap", which standalone Monaco lacks. This tab only, never saved. Its key is
    // the row `code.toggleWordWrap` as it is now (YAZ-3564).
    const toggleWrap = addWrapAction(editor, monaco, () => {
      wrap.current = !wrap.current
      editor.updateOptions({ wordWrap: wrap.current ? 'on' : 'off' })
    })
    const changes = model.onDidChangeContent(() => {
      // A reload is disk truth, never an edit: the reload resets the baseline itself.
      if (!applyingDisk.current) autosave.current?.update(model.getAlternativeVersionId())
    })
    start(model.getAlternativeVersionId(), loaded.mtime)

    // Folds (S1–S4): a copy starts with its source's live folds and writes none until one changes in it;
    // a tab that a delete or a rename retired writes none at all. Then a copy's scroll spot (S5), or the
    // cursor and scroll that Back returns to (YAZ-3458) — unless a jump brought this tab to a place.
    const copy = born.current.startView
    const back = copy === undefined && backKeyRef.current !== undefined ? takeBackView(backKeyRef.current) : undefined
    // Jump by meaning (YAZ-3454, YAZ-3455): Cmd+click through `onOpenFile`, and the place a jump left for this tab.
    const jumps = trackCodeTab(editor, path, (to) => openRef.current?.(to))
    const folds = attachFolds(editor, {
      seed: copy?.folds ?? storage.getFolds(root, path),
      cleanup: copy === undefined,
      write: (keys) => {
        if (!retired.current) storage.setFolds(root, path, keys)
      },
      // After the folds: they change the height above the spot. Never on a closed tab (`attachFolds`).
      onRestored: () => {
        if (copy !== undefined) editor.setScrollTop(copy.scrollTop)
        else if (back !== undefined && !jumps.placed) editor.restoreViewState(back)
      },
    })
    const host = mount.closest('.code-editor')
    const offPageView = host === null ? null : registerPageView(host, () => ({ scrollTop: editor.getScrollTop(), zoomKey: null, folds: folds.keys(), magnification: zoomRef.current }))

    // The project's helper for the jumps across files.
    const helper = attachLanguageClient(model, { root, path })

    // A right-click on a fold chevron (YAZ-3478): the app's menu, never Monaco's. Capture phase on the
    // mount, so Monaco's own `contextmenu` listener inside it never runs. A right button folds nothing in
    // Monaco (its folding reacts to the left and middle buttons only).
    const onContextMenu = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest(FOLD_CHEVRON) === null) return
      event.preventDefault()
      event.stopPropagation()
      setFoldMenu({ x: event.clientX, y: event.clientY })
    }
    mount.addEventListener('contextmenu', onContextMenu, true)
    // Monaco's own right-click menu in the app's look: its spacing (the colors are `codeEditor.css`).
    const menuLook = attachMenuLook(mount)

    // The Outline (YAZ-3486): symbols 300 ms after the last edit, never per keystroke.
    const outlineFeed = attachOutlineFeed(editor, model, readSymbols, born.current.outlineOn, born.current.outlineLocals)
    setOutline({ editor, feed: outlineFeed })

    return () => {
      setOutline(null)
      outlineFeed.dispose()
      menuLook.dispose()
      mount.removeEventListener('contextmenu', onContextMenu, true)
      jumps.dispose()
      helper.dispose()
      offPageView?.()
      folds.dispose()
      changes.dispose()
      toggleWrap.dispose()
      closedText.current = model.getValue(monaco.editor.EndOfLinePreference.TextDefined, true)
      const left = editor.saveViewState()
      if (backKeyRef.current !== undefined && left !== null) keepBackView(backKeyRef.current, left)
      editor.dispose()
      model.dispose()
      editorRef.current = null
      modelRef.current = null
    }
    // Mount once: `loaded` and `path` are fixed for this host (the shell keys it by path), and a theme change is the effect below.
  }, [])

  // Settings › Code, live in every tab (S1, S4, S5). A setting going on again locks a tab that was unlocked (S1).
  useEffect(() => {
    if (codeReadOnly) setUnlocked(false)
  }, [codeReadOnly])
  useEffect(() => {
    if (!locked) setAskingUnlock(false)
    editorRef.current?.updateOptions({ readOnly: locked })
  }, [locked])
  useEffect(() => {
    wrap.current = codeWrap
    editorRef.current?.updateOptions({ wordWrap: codeWrap ? 'on' : 'off' })
  }, [codeWrap])
  useEffect(() => {
    editorRef.current?.updateOptions({ minimap: { enabled: codeMinimap } })
  }, [codeMinimap])

  // The text size (YAZ-3451): the note's keys and pill. ⌘+ / ⌘− / ⌘0 bubble from the focus to this
  // tab's section as `ZOOM_EVENT` (`zoomRequest.ts`), and this tab claims them; ⌘0 is 100 %.
  useEffect(() => {
    const section = doc.hostRef.current?.closest('.editor')
    if (section == null) return
    const onZoom = (event: Event): void => {
      event.preventDefault()
      const step = (event as CustomEvent<ZoomStep>).detail
      setZoom(step === 0 ? 100 : (stepZoomByKey(zoomRef.current, step) ?? zoomRef.current))
    }
    section.addEventListener(ZOOM_EVENT, onZoom)
    return () => section.removeEventListener(ZOOM_EVENT, onZoom)
  }, [doc.hostRef])
  useLayoutEffect(() => {
    editorRef.current?.updateOptions({ fontSize: (FONT_SIZE * zoom) / 100 })
  }, [zoom])

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
      const settings = storage.getSettings()
      const mac = /Mac/.test(navigator.platform)
      if (isCodeKey('code.save', event, settings?.hotkeys, mac)) {
        event.preventDefault()
        event.stopPropagation()
        flush()
        return
      }
      const editor = editorRef.current
      // ⌘↑ / ⌘↓ fold now, so ⌘Home / ⌘End go to the top / bottom on a Mac (standalone Monaco binds them only off a Mac).
      if (mac && editor?.hasTextFocus() === true && event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'Home' || event.key === 'End')) {
        event.preventDefault()
        event.stopPropagation()
        editor.trigger('keyboard', `${event.key === 'Home' ? 'cursorTop' : 'cursorBottom'}${event.shiftKey ? 'Select' : ''}`, null)
        return
      }
      const command = appCommandOf(event, settings?.hotkeys, mac, settings?.hotkeysAside)
      if (command === null || command === 'copyPath') return
      event.stopPropagation() // a menu accelerator: the menu runs it (Toggle sidebar too, since YAZ-3564 D10)
    }
    host.addEventListener('keydown', onKeyDown, true)
    return () => host.removeEventListener('keydown', onKeyDown, true)
  }, [doc.hostRef, flush])

  return (
    <div className="code-editor" ref={doc.hostRef}>
      <DocumentChips
        store={doc.chips}
        className="status-chips"
        lead={
          <CodeChips
            settings={{ codeReadOnly, codeWrap, codeMinimap }}
            onChangeSettings={onChangeCodeSettings}
            tableOfContents={{ on: tocOn, onToggle: toggleToc }}
            zoom={zoom}
            onZoom={setZoom}
            locked={locked}
            asking={askingUnlock}
            onAsk={() => setAskingUnlock(true)}
            onAllow={() => {
              setAskingUnlock(false)
              setUnlocked(true)
              editorRef.current?.focus()
            }}
            onCancel={() => setAskingUnlock(false)}
            fold={{
              read: readFold,
              subscribe: subscribeFolds,
              run: (collapse) => {
                runFold(collapse ? 'editor.foldAll' : 'editor.unfoldAll')
                editorRef.current?.focus()
              },
            }}
          />
        }
      />
      {doc.conflictBar}
      <div className="code-editor__monaco" ref={mountRef} />
      {outline !== null && (
        <CodeOutline
          feed={outline.feed}
          editor={outline.editor}
          lineHeight={() => (editorRef.current?.getOption(monaco.editor.EditorOption.lineHeight) as number | undefined) ?? 19}
          mode={tocMode}
          onChangeMode={onChangeTableOfContents}
          width={tableOfContentsWidth}
          onChangeWidth={onChangeTableOfContentsWidth}
          sort={codeOutlineSort}
          hidden={codeOutlineHidden}
          locals={codeOutlineLocals}
          onChangeView={(patch) => onChangeCodeSettings?.(patch)}
          hostRef={mountRef}
          onReturnFocus={() => editorRef.current?.focus()}
        />
      )}
      {foldMenu !== null && (
        <ContextMenu
          x={foldMenu.x}
          y={foldMenu.y}
          sections={[
            [
              { id: 'collapse-all', label: 'Collapse all', hint: hintOf('code.foldEveryBlock'), onSelect: () => runFold('editor.foldAll') },
              { id: 'expand-all', label: 'Expand all', hint: hintOf('code.unfoldEveryBlock'), onSelect: () => runFold('editor.unfoldAll') },
            ],
          ]}
          onClose={() => {
            setFoldMenu(null)
            editorRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}
