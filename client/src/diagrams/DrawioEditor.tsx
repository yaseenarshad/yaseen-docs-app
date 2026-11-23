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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DRAWIO_ORIGIN } from '@shared/drawio'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { boardBaseName } from '@shared/fileKind'
import { isDiagramHoverLinksOff, isDiagramReadOnly, setDiagramHoverLinksOff, setDiagramReadOnly } from '@shared/readOnly'
import type { DiagramDarkColors, OutsideChangeGlow } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { DocumentShell } from '../documents/DocumentShell'
import { DocumentChips, exportWithNotice, useDocumentHost, type DocumentHostProps } from '../documents/useDocumentHost'
import { namingTab } from '../lib/focusHandoff'
import type { NoticeKind } from '../lib/notice'
import { storage } from '../lib/storage'
import { basename } from '../lib/paths'
import { useAppliedTheme } from '../lib/theme'
import { useDrawingLinks, type DrawingLinkProps } from '../drawings/useDrawingLinks'
import { OutsideUpdateChip } from '../drawings/OutsideUpdateChip'
import { linkPreviewHint, readOnlyHint, RELOAD_DISK_HINT } from '../drawings/cogHints'
import { CardPreviewHost } from '../tabs/cardPreview'
import { useDrawioLinkBridge } from './drawioLinkBridge'
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
/** A `yaseenMerge` the overlay never answers is a conflict (YAZ-4279). Long: the overlay first waits for a label being typed to end. */
const MERGE_TIMEOUT_MS = 60_000

/** The overlay's answer to a `yaseenMerge`, and whether the tab had unsaved edits when draw.io began it. */
type MergeAnswer =
  | { conflict: true; dirty: boolean }
  | { conflict: false; dirty: boolean; xml?: string; changedIds?: string[]; groups?: string[][]; offscreen?: boolean }

export interface DrawioEditorProps extends DocumentHostProps, DrawingLinkProps {
  /** 🔒 YAZ-1802 D16: the app's dark-mode colour setting, applied live (see the module doc). */
  darkColors: DiagramDarkColors
  /** The open gestures of Settings › Hotkeys, for the link pills (YAZ-4748). */
  hotkeys?: HotkeyOverrides
  /** The window's ONE passive notice: where an exported image landed, or why it did not. */
  onNotice?: (text: string, icon?: NoticeKind) => void
  /** Settings › Outside changes › Glow (YAZ-4279 D5): how long a cell the file changed stays outlined. Absent → until checked. */
  outsideChangeGlow?: OutsideChangeGlow
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
function DiagramHost({ root, path, loaded, watch, sync, onSyncNow, darkColors, onNotice, outsideChangeGlow = 'until-checked', hotkeys, ...linkProps }: DiagramHostProps) {
  const theme = useAppliedTheme()
  const frameRef = useRef<HTMLIFrameElement>(null)
  /** The URL is fixed at mount: a theme flip is a message, never a reload of the editor. */
  const [src] = useState(() => drawioFrameUrl(theme))
  /** The XML draw.io last posted — what the next save writes. */
  const latestXml = useRef(loaded.xml)
  /** The XML as this tab last loaded or saved it: a merge's base (YAZ-4279 D2). */
  const baseXml = useRef(loaded.xml)
  /** The one `yaseenMerge` in flight (YAZ-4279): its id, its answer, and whether the tab had edits as draw.io began it. */
  const merging = useRef<{ id: number; answer: (a: MergeAnswer) => void; dirty: boolean } | null>(null)
  const mergeIds = useRef(0)
  /** The Glow setting as of now: what the overlay outlines what the file changed for (D5). */
  const glowRef = useRef(outsideChangeGlow)
  glowRef.current = outsideChangeGlow
  /** YAZ-6416: floating bottom-center OutsideUpdateChip state (Show, 1/N cycling, Back, Mark checked) for full parity with Excalidraw. */
  const [outsideUpdate, setOutsideUpdate] = useState<{ ids: string[]; groups: string[][]; index: number; seq: number; offscreen: boolean; hasBack: boolean } | null>(null)
  const outsideSeq = useRef(0)
  const chipAutoDismissMs = outsideChangeGlow === '60s' ? 60_000 : outsideChangeGlow === '5m' ? 300_000 : 0
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
  /** What the GRAPH should be (YAZ-4939): the file's switch or the vault's lock, minus this tab's timed unlock. A save never writes it. */
  const wantedLock = useRef(false)
  const shownReadOnly = useRef(false)
  /** draw.io reported a change while read only: never saved, and the canvas is put back to the disk at "Allow edits". */
  const strayWhileReadOnly = useRef(false)
  /**
   * The diagram's own "Link preview on hover" off (YAZ-4748 D10), as the file last said it. The ref is what a save keeps:
   * it changes the moment main wrote the switch (or a reload read it), before a queued save runs (YAZ-4809 5F).
   */
  const [hoverLinksOff, setHoverLinksOff] = useState(() => isDiagramHoverLinksOff(loaded.xml))
  const keptHoverLinksOff = useRef(hoverLinksOff)

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
      baseXml.current = xml
      post({ action: 'load', xml, autosave: 1, title: boardBaseName(basename(path)), yaseenKeepFocus: namingTab(document.activeElement), yaseenKeepView: keepView })
    },
    [post, path],
  )

  const configure = useCallback(() => {
    const h = handshake.current
    if (h.configured || !h.configureAsked) return
    h.configured = true
    shownColors.current = wantedColors.current
    // The menu's and the diagram's keys as they are now (YAZ-3397 D2, YAZ-3564 K4): a change reaches a diagram the next time it opens.
    const settings = storage.getSettings()
    post({ action: 'configure', config: drawioConfig(wantedColors.current, settings?.hotkeys, settings?.hotkeysAside, /Mac/.test(navigator.platform)) })
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

  /** The graph's lock, once draw.io listens: our PostConfig's `yaseenReadOnly`, which turns the graph off or on (YAZ-3076 D2). */
  const syncReadOnly = useCallback(() => {
    if (!handshake.current.initialised || shownReadOnly.current === wantedLock.current) return
    shownReadOnly.current = wantedLock.current
    post({ action: 'yaseenReadOnly', value: wantedLock.current })
  }, [post])

  /**
   * YAZ-4279 D2: the file's `xml` merged into the canvas by our PostConfig.js's `yaseenMerge`. A clash, an overlay that
   * does not answer in time (the request is then cancelled, so it never lands later), or one not listening yet is a
   * conflict, and the canvas is as it was. The host's queue (`oneAtATime`) asks one at a time; an answer of another id is
   * not this one's (4A-2).
   */
  const askMerge = useCallback(
    (xml: string, dirty: boolean): Promise<MergeAnswer> =>
      new Promise((done) => {
        if (!handshake.current.initialised) return done({ conflict: true, dirty: false })
        const id = ++mergeIds.current
        const late = setTimeout(() => {
          post({ action: 'yaseenMergeCancel', id })
          answer({ conflict: true, dirty: false })
        }, MERGE_TIMEOUT_MS)
        const answer = (a: MergeAnswer): void => {
          clearTimeout(late)
          if (merging.current?.id === id) merging.current = null
          done(a)
        }
        merging.current = { id, answer, dirty }
        post({ action: 'yaseenMerge', id, base: baseXml.current, xml, glow: glowRef.current })
      }),
    [post],
  )

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
    // YAZ-4809 5F: a save queued behind the switch's write runs before the next render, and must keep the new switch.
    onReadOnlyWritten: (on) => {
      wantedReadOnly.current = on
    },
    onNotice,
    // A change draw.io queued before "on" landed saves after it: it keeps the switches, which draw.io's
    // XML never carries (it drops attributes it does not know — YAZ-3116 A3; the hover switch, YAZ-4748 D10).
    write: async (expectedMtime) => {
      const xml = latestXml.current
      const res = await api.diagram.save({ root, path, xml: setDiagramHoverLinksOff(setDiagramReadOnly(xml, wantedReadOnly.current), keptHoverLinksOff.current), expectedMtime })
      baseXml.current = xml
      return res
    },
    // Reload from the bar, and the stray-change reload at "Allow edits": the disk back over the canvas, with a `load`.
    reload: async (a) => {
      const res = await api.diagram.load({ root, path })
      a.reset(version.current, res.mtime)
      setOutsideUpdate(null)
      sendLoad(res.xml, res.mtime, true)
      keptHoverLinksOff.current = isDiagramHoverLinksOff(res.xml)
      setHoverLinksOff(keptHoverLinksOff.current)
      return isDiagramReadOnly(res.xml)
    },
    // YAZ-4279 item 6: cheap disk mtime check on window focus / tab reveal to catch missed watcher events.
    checkDisk: async () => {
      try {
        const head = await api.boardHead(path)
        return head.mtime
      } catch {
        return null
      }
    },
    // YAZ-4279 D2, D3, item 1: every outside save, merged in draw.io — edits or none, so a clean tab keeps its undo history,
    // selection and view (draw.io's `load` clears undo). A read-only switch the file changed is the user's to settle under
    // edits; with none, a reload brings it in. A clean merge draw.io refuses falls back to that reload too.
    merge: async (a) => {
      const res = await api.diagram.load({ root, path })
      if (isDiagramReadOnly(res.xml) !== wantedReadOnly.current) return a.dirty ? 'conflict' : 'reload'
      const answer = await askMerge(res.xml, a.dirty)
      if (answer.conflict) return answer.dirty || a.dirty ? 'conflict' : 'reload'
      baseXml.current = res.xml
      // The whole merged file (4A-3): draw.io's `autosave` posts only the page on screen.
      if (answer.xml !== undefined) latestXml.current = answer.xml
      // Edits as draw.io began the merge (a label typed while it waited counts, 4A-1) stay pending; none: the merge is clean.
      if (answer.dirty) a.rebase(res.mtime)
      else a.reset(version.current, res.mtime)
      if (answer.changedIds !== undefined && answer.changedIds.length > 0 && glowRef.current !== 'off') {
        const groups = answer.groups !== undefined && answer.groups.length > 0 ? answer.groups : [answer.changedIds]
        setOutsideUpdate({ ids: answer.changedIds, groups, index: -1, seq: ++outsideSeq.current, offscreen: answer.offscreen ?? true, hasBack: false })
      }
      return 'merged'
    },
    // Keep mine answers the bar: the overlay's red outlines of the clash go (item 8).
    onKeepMine: () => {
      setOutsideUpdate(null)
      post({ action: 'yaseenClearClash' })
    },
    // Export Image… is the one board command a diagram answers.
    onCommand: (command) => {
      if (command.kind === 'export-image') void exportImage()
    },
    focus: () => frameRef.current?.focus(),
  })
  const { autosave, retired, start } = board

  // YAZ-4748 D2: the board's own link host, spoken to the iframe by the bridge (`drawioLinkBridge.ts`).
  const { links, linkPreview, linkCard } = useDrawingLinks({
    root,
    theme,
    path,
    readOnly: board.readOnly,
    hotkeys,
    onNotice,
    hostRef: board.hostRef,
    // D5: the frame sends the picker's keys up only while it is open.
    onPickerShow: (open) => post({ action: 'yaseenPickerOpen', open }),
    // D10: the app's "Links in drawings and diagrams" AND this diagram's own switch; clicks stay.
    props: { ...linkProps, hoverLinks: linkProps.hoverLinks === true && !hoverLinksOff, diagramDarkColors: darkColors },
  })

  /** The cog's "Link preview on hover" (D10): `board:set-hover-links`, beside the autosave, as on a board. */
  const setHoverLinks = async (on: boolean): Promise<void> => {
    const a = autosave.current
    if (a === null || retired.current) return
    try {
      await a.writeBeside((expectedMtime) =>
        api.setBoardHoverLinks({ root, path, on, expectedMtime }).then((res) => {
          keptHoverLinksOff.current = !on
          return res
        }),
      )
      setHoverLinksOff(!on)
    } catch (err) {
      if (err instanceof BridgeRequestError && err.code === 'CONFLICT') {
        onNotice?.('The file changed on disk. Try again.', 'error')
        if (!a.dirty) void board.reload()
        return
      }
      onNotice?.(err instanceof BridgeRequestError && err.message !== '' ? err.message : "The switch couldn't be saved.", 'error')
    }
  }
  const reloadFromDisk = async (): Promise<void> => {
    if (retired.current) return
    await board.reload()
    onNotice?.('Reloaded from disk.')
  }
  const setHoverLinksNow = useRef(setHoverLinks)
  setHoverLinksNow.current = setHoverLinks
  const reloadFromDiskNow = useRef(reloadFromDisk)
  reloadFromDiskNow.current = reloadFromDisk
  // The cog: "Read only", then this diagram's own row, greyed out by Read only, as a board's (D10), plus Reload from disk (YAZ-4279 item 6).
  const { chips } = board
  useLayoutEffect(
    () =>
      chips.set({
        pageRows: () => [
          { label: 'Read only', readOnlySlot: true, hint: readOnlyHint('diagram') },
          { label: 'Link preview on hover', hint: linkPreviewHint('diagram'), on: !hoverLinksOff, onToggle: () => void setHoverLinksNow.current(hoverLinksOff), disabled: board.readOnly },
          { label: 'Reload from disk', hint: RELOAD_DISK_HINT, onToggle: () => void reloadFromDiskNow.current(), divider: true },
        ],
      }),
    [chips, hoverLinksOff, board.readOnly],
  )
  const bridge = useDrawioLinkBridge(links, frameRef, post, { readOnly: board.readOnly, hotkeys })
  const bridgeNow = useRef(bridge)
  bridgeNow.current = bridge

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
          bridgeNow.current.ready()
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
          if (wantedLock.current) {
            strayWhileReadOnly.current = true
            return
          }
          latestXml.current = msg.xml
          a.update(++version.current)
          if (msg.event === 'save') void a.flush()
          return
        }
        case 'yaseenMerging':
          // draw.io begins the merge: every edit of the user's is in by now (they come before this message).
          if (merging.current?.id === msg.id) merging.current.dirty ||= autosave.current?.dirty === true
          return
        case 'yaseenMerge': {
          const m = merging.current
          if (m?.id === msg.id) {
            m.answer(
              msg.conflict === true
                ? { conflict: true, dirty: m.dirty }
                : { conflict: false, dirty: m.dirty, xml: msg.xml, changedIds: msg.changedIds, groups: msg.groups, offscreen: msg.offscreen },
            )
          }
          return
        }
        default:
          bridgeNow.current.onMessage(msg)
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
  const { readOnly, switchOn, reload } = board
  // The file's switch is what a save keeps (YAZ-4939): never the vault's lock, never this tab's unlock.
  useEffect(() => {
    wantedReadOnly.current = switchOn
  }, [switchOn])
  useEffect(() => {
    wantedLock.current = readOnly
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

  const jumpOutsideGroup = useCallback(
    (delta: number) => {
      setOutsideUpdate((cur) => {
        if (cur === null || cur.groups.length === 0) return null
        const total = cur.groups.length
        const nextIdx = cur.index < 0 ? (delta < 0 ? total - 1 : 0) : (cur.index + delta + total) % total
        post({ action: 'yaseenShowCells', ids: cur.groups[nextIdx] })
        return { ...cur, index: nextIdx, seq: ++outsideSeq.current, hasBack: true }
      })
    },
    [post],
  )
  const showOutsideUpdate = useCallback(() => jumpOutsideGroup(0), [jumpOutsideGroup])
  const prevOutsideUpdate = useCallback(() => jumpOutsideGroup(-1), [jumpOutsideGroup])
  const nextOutsideUpdate = useCallback(() => jumpOutsideGroup(1), [jumpOutsideGroup])
  const backOutsideUpdate = useCallback(() => {
    post({ action: 'yaseenRestoreView' })
    setOutsideUpdate((cur) => (cur === null ? null : { ...cur, index: -1, hasBack: false }))
  }, [post])
  const clearOutsideUpdate = useCallback(() => {
    post({ action: 'yaseenClearOutsideMarks' })
    setOutsideUpdate(null)
  }, [post])
  const dismissOutsideUpdate = useCallback(() => setOutsideUpdate(null), [])

  return (
    <div className="drawio-editor" ref={board.hostRef}>
      {board.conflictBar}
      <DocumentChips store={board.chips} className="drawio-editor__chips" />
      <iframe ref={frameRef} className="drawio-editor__frame" src={src} title={`${boardBaseName(basename(path))} — draw.io`} />
      {outsideUpdate !== null && outsideChangeGlow !== 'off' && (
        <OutsideUpdateChip
          count={outsideUpdate.ids.length}
          seq={outsideUpdate.seq}
          canShow={outsideUpdate.offscreen}
          onShow={showOutsideUpdate}
          step={
            outsideUpdate.groups.length >= 2
              ? { index: outsideUpdate.index, total: outsideUpdate.groups.length, onPrev: prevOutsideUpdate, onNext: nextOutsideUpdate }
              : undefined
          }
          onBack={outsideUpdate.hasBack ? backOutsideUpdate : undefined}
          onClear={clearOutsideUpdate}
          onDismiss={dismissOutsideUpdate}
          autoDismissMs={chipAutoDismissMs}
        />
      )}
      <CardPreviewHost store={linkPreview.store} cardOf={linkCard} scopeOf={linkProps.previewScope} diagramDarkColors={darkColors} />
    </div>
  )
}
