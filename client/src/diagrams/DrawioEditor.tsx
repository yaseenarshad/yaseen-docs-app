/**
 * A `.drawio` open in a tab (YAZ-3028 D2, Draw's YAZ-1802): `DrawingEditor`'s twin — save and sync chips, conflict bar,
 * debounced autosave, quit flush, rename continuity, all from `useDocumentHost` (YAZ-2073 🔒 D16) —
 * with draw.io where the canvas is.
 *
 * 🔒 D4: draw.io runs in an iframe on its own origin and is talked to by postMessage only
 * (`drawioProtocol.ts`). The XML is loaded BEFORE the iframe mounts, so a file main refuses is the
 * error pane and draw.io can never autosave over it. Autosave counts draw.io's changes and leaves
 * the rules to the board document. Theme (D12) and the dark-mode colour setting (D16) apply live
 * by message. Keys and export: docs/CONTRACTS.md › Editor rules, rule 37.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DRAWIO_ORIGIN } from '@shared/drawio'
import { boardBaseName } from '@shared/fileKind'
import { isDiagramReadOnly, setDiagramReadOnly } from '@shared/readOnly'
import type { DiagramDarkColors } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { DocumentShell } from '../documents/DocumentShell'
import { DocumentChips, exportWithNotice, useDocumentHost, type DocumentHostProps } from '../documents/useDocumentHost'
import { namingTab } from '../lib/focusHandoff'
import type { NoticeKind } from '../lib/notice'
import { storage } from '../lib/storage'
import { basename } from '../lib/paths'
import { useAppliedTheme } from '../lib/theme'
import { drawioAdaptiveColors, drawioConfig, drawioFrameUrl, readDrawioMessage } from './drawioProtocol'
import { renderDiagramImage } from './renderDiagram'
import './drawioEditor.css'

/** What a diagram that will not open says; main's reason follows it when there is one. */
export const BROKEN_DIAGRAM_DOCUMENT = "This draw.io diagram can't be opened"

const EXPORT_FAILED = "The draw.io diagram couldn't be exported."
const EXPORT_EMPTY = 'This draw.io diagram is empty, so there is no image to export.'

/**
 * How long the host waits for our PostConfig.js to say it is ready before configuring draw.io
 * anyway — a missing overlay must cost the keymap, never the document.
 */
const READY_FALLBACK_MS = 3000

export interface DrawioEditorProps extends DocumentHostProps {
  /** 🔒 YAZ-1802 D16: the app's dark-mode colour setting, applied live (see the module doc). */
  darkColors: DiagramDarkColors
  /** The window's ONE passive notice: where an exported image landed, or why it did not. */
  onNotice?: (text: string, icon?: NoticeKind) => void
}

interface LoadedDiagram {
  xml: string
  mtime: number
}

const loadDiagram = (req: { root: string; path: string }): Promise<LoadedDiagram> => api.diagram.load(req).then((res) => ({ xml: res.xml, mtime: res.mtime }))

/** Missing, unreadable, not draw.io: ONE readable state naming why, never a blank pane. */
function brokenDiagram(err: unknown): string {
  const why = err instanceof BridgeRequestError && err.code === 'IO_ERROR' ? err.message : err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? 'the file is missing' : null
  return why === null ? `${BROKEN_DIAGRAM_DOCUMENT}.` : `${BROKEN_DIAGRAM_DOCUMENT}: ${why}.`
}

export function DrawioEditor(props: DrawioEditorProps) {
  return (
    <DocumentShell root={props.root} path={props.path} className="editor--diagram" load={loadDiagram} errorText={brokenDiagram}>
      {(loaded) => <DiagramHost {...props} loaded={loaded} />}
    </DocumentShell>
  )
}

interface DiagramHostProps extends DrawioEditorProps {
  loaded: LoadedDiagram
}

/** Mounts exactly one draw.io iframe for `loaded`; its board document owns everything that writes. */
function DiagramHost({ root, path, loaded, watch, sync, onSyncNow, darkColors, onNotice }: DiagramHostProps) {
  const theme = useAppliedTheme()
  const frameRef = useRef<HTMLIFrameElement>(null)
  /** The URL is fixed at mount: a theme flip is a message, never a reload of the editor. */
  const [src] = useState(() => drawioFrameUrl(theme))
  /** The XML draw.io last posted — what the next save writes. */
  const latestXml = useRef(loaded.xml)
  /** Bumped on every draw.io change; `Autosave` compares these, never the XML. */
  const version = useRef(0)
  /** The mtime of the document a `load` action carried, until draw.io answers `load`. */
  const pendingLoad = useRef<number | null>(null)
  /** The handshake (drawioProtocol.ts): our PostConfig is in, draw.io asked to be configured, draw.io listens. */
  const handshake = useRef({ overlayReady: false, configureAsked: false, configured: false, initialised: false })
  /** The theme draw.io is showing (the URL's, then each flip sent), and the one the app wants now. */
  const shownTheme = useRef(theme)
  const wantedTheme = useRef(theme)
  /** The same pair for the dark-mode colour setting: what the configure reply (then each change) sent, and what the app wants now. */
  const shownColors = useRef(darkColors)
  const wantedColors = useRef(darkColors)
  /** The file's read-only switch as the board document holds it, and what draw.io was last told (YAZ-3076 D2). draw.io starts editable. */
  const loadedReadOnly = useMemo(() => isDiagramReadOnly(loaded.xml), [loaded.xml])
  const wantedReadOnly = useRef(loadedReadOnly)
  const shownReadOnly = useRef(false)
  /** draw.io reported a change while read only: never saved, and the canvas is put back to the disk at "Allow edits". */
  const strayWhileReadOnly = useRef(false)

  const post = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify(msg), DRAWIO_ORIGIN)
  }, [])

  /**
   * Send a document into draw.io; its `load` answer becomes the new clean baseline at `mtime`.
   * draw.io focuses its own window as it loads: while a tab's name field has the caret, our
   * PostConfig.js skips that once (`yaseenKeepFocus`, YAZ-3084).
   * `keepView` (YAZ-3420 D2): a reload keeps the page, the zoom and the scroll on screen.
   */
  const sendLoad = useCallback(
    (xml: string, mtime: number, keepView = false) => {
      pendingLoad.current = mtime
      latestXml.current = xml
      post({ action: 'load', xml, autosave: 1, title: boardBaseName(basename(path)), yaseenKeepFocus: namingTab(document.activeElement), yaseenKeepView: keepView })
    },
    [post, path],
  )

  const configure = useCallback(() => {
    const h = handshake.current
    if (h.configured || !h.configureAsked) return
    h.configured = true
    shownColors.current = wantedColors.current
    // The menu's keys as they are now (YAZ-3397 D2): a change reaches a diagram the next time it opens.
    post({ action: 'configure', config: drawioConfig(wantedColors.current, storage.getSettings()?.hotkeys) })
  }, [post])

  /** Show the app's theme, once draw.io listens: its own `darkMode` / `lightMode` action. */
  const syncTheme = useCallback(() => {
    if (!handshake.current.initialised || shownTheme.current === wantedTheme.current) return
    shownTheme.current = wantedTheme.current
    post({ action: 'invokeAction', actionName: wantedTheme.current === 'dark' ? 'darkMode' : 'lightMode' })
  }, [post])

  /** A change of the dark-mode colour setting since the configure reply, once draw.io listens: our PostConfig's message. */
  const syncColors = useCallback(() => {
    if (!handshake.current.initialised || shownColors.current === wantedColors.current) return
    shownColors.current = wantedColors.current
    post({ action: 'yaseenAdaptiveColors', value: drawioAdaptiveColors(wantedColors.current) })
  }, [post])

  /** The file's switch, once draw.io listens: our PostConfig's `yaseenReadOnly`, which turns the graph off or on (YAZ-3076 D2). */
  const syncReadOnly = useCallback(() => {
    if (!handshake.current.initialised || shownReadOnly.current === wantedReadOnly.current) return
    shownReadOnly.current = wantedReadOnly.current
    post({ action: 'yaseenReadOnly', value: wantedReadOnly.current })
  }, [post])

  /** File › Export Image… (🔒 D9): the XML draw.io last posted, unsaved edits included, drawn before the sheet opens because the pick decides the format. */
  const exportImage = (): Promise<void> =>
    exportWithNotice(
      async () => {
        const xml = latestXml.current
        const [png, svg] = await Promise.all([renderDiagramImage(xml, 'png'), renderDiagramImage(xml, 'svg')])
        if (png === '') {
          onNotice?.(EXPORT_EMPTY)
          return null
        }
        return api.dialog.saveImage({ defaultName: `${boardBaseName(basename(path))}.png`, png, svg })
      },
      EXPORT_FAILED,
      onNotice,
    )

  // Fresh closures every render are fine: the hook reads them through its `engine` ref, never stale.
  const board = useDocumentHost({
    root,
    path,
    watch,
    sync,
    onSyncNow,
    // The switch is read off the LOADED XML, never `latestXml`: draw.io drops attributes it does not know (YAZ-3076 D1).
    readOnly: loadedReadOnly,
    onNotice,
    // A change draw.io queued before "on" landed saves after it: it keeps the switch, which draw.io's
    // XML never carries (it drops attributes it does not know — YAZ-3116 A3).
    write: (expectedMtime) => api.diagram.save({ root, path, xml: wantedReadOnly.current ? setDiagramReadOnly(latestXml.current, true) : latestXml.current, expectedMtime }),
    reload: async (a) => {
      const res = await api.diagram.load({ root, path })
      a.reset(version.current, res.mtime)
      sendLoad(res.xml, res.mtime, true)
      return isDiagramReadOnly(res.xml)
    },
    // Export Image… is the one board command a diagram answers.
    onCommand: (command) => {
      if (command.kind === 'export-image') void exportImage()
    },
    focus: () => frameRef.current?.focus(),
  })
  const { autosave, retired, start } = board

  // The one message listener: the protocol, in the order drawioProtocol.ts documents.
  useEffect(() => {
    let fallback: ReturnType<typeof setTimeout> | undefined
    const onMessage = (ev: MessageEvent): void => {
      const msg = readDrawioMessage(ev, frameRef.current?.contentWindow)
      if (msg === null) return
      const h = handshake.current
      switch (msg.event) {
        case 'yaseenReady':
          h.overlayReady = true
          configure()
          return
        case 'configure':
          h.configureAsked = true
          if (h.overlayReady) configure()
          else fallback = setTimeout(configure, READY_FALLBACK_MS)
          return
        case 'init':
          h.initialised = true
          syncTheme()
          syncColors()
          syncReadOnly()
          sendLoad(latestXml.current, autosave.current?.mtime ?? loaded.mtime)
          return
        case 'load': {
          const mtime = pendingLoad.current ?? autosave.current?.mtime ?? loaded.mtime
          pendingLoad.current = null
          const a = autosave.current
          // draw.io's own answer IS the baseline: nothing it shows after a load is an edit.
          if (a === null) start(version.current, mtime)
          else a.reset(version.current, mtime)
          return
        }
        case 'autosave':
        case 'save': {
          const a = autosave.current
          // A change before the first `load` answer has no baseline to be measured against.
          if (a === null || retired.current || pendingLoad.current !== null) return
          // A read-only diagram does not save (YAZ-3076 D1/D2): the graph is off, so this is draw.io's
          // own chrome at most. It is kept off disk, and the canvas goes back to the disk at "Allow edits".
          if (wantedReadOnly.current) {
            strayWhileReadOnly.current = true
            return
          }
          latestXml.current = msg.xml
          a.update(++version.current)
          if (msg.event === 'save') void a.flush()
          return
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      if (fallback !== undefined) clearTimeout(fallback)
    }
  }, [configure, syncTheme, syncColors, syncReadOnly, sendLoad, autosave, retired, start, loaded.mtime])

  // YAZ-3076 D2: the file's switch, live — the load, this tab's toggle, or a change on disk.
  // At "Allow edits" after a stray change, the board's own reload (the drawing's rule) puts the disk back.
  const { readOnly, reload } = board
  useEffect(() => {
    wantedReadOnly.current = readOnly
    syncReadOnly()
    if (readOnly || !strayWhileReadOnly.current) return
    strayWhileReadOnly.current = false
    void reload()
  }, [readOnly, syncReadOnly, reload])

  // 🔒 YAZ-1802 D12: the app's theme, live.
  useEffect(() => {
    wantedTheme.current = theme
    syncTheme()
  }, [theme, syncTheme])

  // 🔒 YAZ-1802 D16: the dark-mode colour setting, live.
  useEffect(() => {
    wantedColors.current = darkColors
    syncColors()
  }, [darkColors, syncColors])

  return (
    <div className="drawio-editor" ref={board.hostRef}>
      {board.conflictBar}
      <DocumentChips store={board.chips} className="drawio-editor__chips" />
      <iframe ref={frameRef} className="drawio-editor__frame" src={src} title={`${boardBaseName(basename(path))} — draw.io`} />
    </div>
  )
}
