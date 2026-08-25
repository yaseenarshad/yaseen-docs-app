import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { SIDEBAR_MAX_W, SIDEBAR_MIN_W, type SettingsState } from '@shared/types'
import { api, BridgeRequestError } from './api'
import { applyCrepeTheme } from './editor/crepeTheme'
import { Editor } from './editor/Editor'
import { newNoteBase } from './editor/wikilink/createFromLink'
import { createWikilinkCandidateSource } from './editor/wikilink/wikilinkPicker'
import { createWikilinkResolveSource } from './editor/wikilink/wikilinkPlugin'
import { useProperties } from './bases/useProperties'
import { WikilinkIndexBridge } from './editor/wikilink/WikilinkIndexBridge'
import { useLinkEvents } from './hooks/useLinkEvents'
import { useMenuEvents } from './hooks/useMenuEvents'
import { usePickFolder } from './hooks/usePickFolder'
import { useWatch } from './hooks/useWatch'
import { renameNotice, updateLinksAfterRename } from './links/renameLinks'
import { useExternalRenames } from './links/useExternalRenames'
import { basename } from './lib/paths'
import { carryEditorAcrossRename, carryEditorsAcrossDirRename, flushRenamedDir, flushRenamedPath, retireDeletedDir, retireDeletedPath } from './lib/renameContinuity'
import { storage } from './lib/storage'
import { resolveTheme, useSystemPrefersDark } from './lib/theme'
import { fileHash } from './lib/urlHash'
import { windowTitle } from './lib/windowTitle'
import { Sidebar, SidebarPanelIcon } from './sidebar/Sidebar'
import { TabBar } from './tabs/TabBar'
import { useTabs } from './tabs/useTabs'
import { Welcome } from './Welcome'

/** Reflect the open file in the URL (GRO-2069); replaceState keeps Back sane. */
function syncHash(path: string | null): void {
  history.replaceState(null, '', fileHash(path) || location.pathname + location.search)
}

/** A can't-open-link notice (E1, GRO-2171) dismisses itself after this long. */
export const LINK_NOTICE_MS = 4000

export function App() {
  const [root, setRoot] = useState<string | null>(storage.getRoot)
  // Tabs (I2, GRO-2234): the renderer-owned tab model, seeded from the boot identity snapshot
  // (a pasted `#/abs/path.md` URL wins as the active tab — bootTabs). The ACTIVE tab is this
  // window's `file`: title, URL hash and the sidebar highlight all follow it.
  const { tabs, active: file, mounted, openCurrent, openBackground, activate, close: closeTab, move: moveTab, closeActive, next: nextTab, prev: prevTab, back, forward, canBack, canForward, reset: resetTabs, renamePath: renameTabPath, renameDirPath: renameDirTabs, deletePath: deleteTabPath, deleteDirPath: deleteDirTabs } = useTabs(root)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storage.getSidebarCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(storage.getSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const [settings, setSettings] = useState(storage.getSettings)
  const watch = useWatch(root)
  // Wikilinks (Links A, GRO-2190): ONE resolve source per window — a stable object every
  // editor's wikilink plugin subscribes to; WikilinkIndexBridge (below) keeps it fed from the
  // vault index, so index changes restyle links live without any editor remounting. The `[[`
  // picker's candidate source (Links B, GRO-2191) works exactly the same way.
  const [wikilinks] = useState(createWikilinkResolveSource)
  const [wikilinkCandidates] = useState(createWikilinkCandidateSource)
  // The vault's property DECLARATIONS (YAZ-835), owned here for the same reason `wikilinks` is:
  // ONE per window, threaded down rather than re-fetched per surface. It is the editor ladder's
  // rung 2 inside a folder page's contents block (YAZ-846) — Editor → FolderPageContents.
  const { properties: propertyDecls } = useProperties(root)
  // ⌘K's half of the search-bar focus handshake (YAZ-801, wired in YAZ-804): `openSearch` sets it
  // (including the collapsed case, which un-collapses and mounts the sidebar with the flag already
  // true); the sidebar focuses its input and clears it through the callback.
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false)
  const searchFocusHandled = useCallback(() => setPendingSearchFocus(false), [])

  // Settings and the sidebar toggle are global (D9): a change made in another window lands here live.
  useEffect(
    () =>
      storage.subscribe(() => {
        setSettings(storage.getSettings())
        setSidebarCollapsed(storage.getSidebarCollapsed())
        setSidebarWidth(storage.getSidebarWidth())
      }),
    [],
  )

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      storage.setSidebarCollapsed(!collapsed)
      return !collapsed
    })
  }, [])

  // Dragging past 60% of the minimum reads as "close it" rather than "make it tiny" — the
  // sidebar collapses and the remembered width stays whatever it was before the drag.
  const startSidebarResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const start = sidebarWidth
      const x0 = e.clientX
      let raw = start
      let width = start
      const move = (ev: MouseEvent) => {
        raw = start + ev.clientX - x0
        width = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, raw))
        setSidebarWidth(width)
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.style.cursor = ''
        setResizing(false)
        if (raw < SIDEBAR_MIN_W * 0.6) {
          setSidebarWidth(start)
          toggleSidebar()
        } else if (width !== start) storage.setSidebarWidth(width)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
      document.body.style.cursor = 'col-resize'
      setResizing(true)
    },
    [sidebarWidth, toggleSidebar],
  )

  const changeSettings = useCallback((next: SettingsState) => {
    storage.setSettings(next)
    setSettings(next)
  }, [])

  // Files & Links (C2-, GRO-2240): where a bare unresolved [[link]] creates its page — the
  // "default location for new notes" setting resolved against this window's root + ACTIVE tab.
  // A ref-backed getter: the value recomputes at CLICK time from whatever settings/tab are
  // current (settings changes broadcast via storage.subscribe land in `settings` above), while
  // the callback identity stays stable — it sits in CrepeHost's effect deps, and a new identity
  // would remount every open editor.
  const createBaseInputs = useRef({ settings, root, file })
  createBaseInputs.current = { settings, root, file }
  const createBase = useCallback(() => {
    const { settings: s, root: r, file: f } = createBaseInputs.current
    return r === null ? '' : newNoteBase(s, r, f)
  }, [])

  // Appearance (Desktop K, GRO-2218): `system` tracks the OS live; explicit values win.
  // `data-theme` goes on <html> so body / fixed overlays follow app.css's dark tokens, and
  // the Crepe frame vars swap in the same commit (CSS-only — the open editor never remounts).
  // storage.init() resolves before the first render, so the first paint is already themed.
  const prefersDark = useSystemPrefersDark()
  const theme = resolveTheme(settings.theme, prefersDark)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    applyCrepeTheme(theme)
  }, [theme])

  // Editor spacing settings land as CSS custom properties; app.css consumes them (GRO-2024).
  // Bullet threading is a CSS gate too (`data-threading`, bulletThreading.css) — no editor remount.
  const settingsVars = {
    '--edit-line-height': settings.lineSpacing,
    '--edit-block-gap': `${settings.blockGap}px`,
    '--thread-width': `${settings.threadWidth}px`,
    // Absent → bulletThreading.css falls back to the app accent.
    ...(settings.threadColor !== null ? { '--thread-color': settings.threadColor } : {}),
    '--side-w': `${sidebarWidth}px`,
  } as CSSProperties

  // The URL hash mirrors the ACTIVE tab (GRO-2069; rule 17: on boot the hash already won as
  // the active tab in bootTabs, so this first run is a no-op re-write of the same hash).
  useEffect(() => syncHash(file), [file])

  // The OS window title mirrors what is open (C3, GRO-2165); Electron follows document.title.
  useEffect(() => {
    document.title = windowTitle(root, file)
  }, [root, file])

  /**
   * Switch this window to `path` in place (C3, GRO-2165). Resolves false — and drops the dead
   * MRU entry — when the folder is gone on disk (C2), leaving the window as it is; any other
   * probe failure still switches, and the sidebar surfaces the error.
   */
  const openRoot = useCallback(async (path: string): Promise<boolean> => {
    try {
      await api.tree(path)
    } catch (err) {
      if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) {
        storage.removeRecentRoot(path)
        return false
      }
    }
    storage.setRoot(path) // ONE identity write: { root, file: null, tabs: [] } (Tabs rule 13)
    storage.pushRecentRoot(path)
    setRoot(path)
    // The folder's remembered file becomes the sole restored tab (D6); reset mirrors it down.
    resetTabs(path, storage.getLastFile(path))
    return true
  }, [resetTabs])

  const { pick, picking } = usePickFolder({ onPicked: openRoot })

  // ⌘W ladder (Tabs rule 7): close the active tab; with zero tabs open (incl. Welcome) close
  // the WINDOW through the real close path so the close/flush handshake runs.
  const closeTabOrWindow = useCallback(() => {
    if (!closeActive()) void window.yaseenDocs.window.closeSelf()
  }, [closeActive])

  // ⌘K (D4, YAZ-804): un-collapse the sidebar when it is hidden — through `toggleSidebar`, since
  // collapse state is GLOBAL across windows (D9, recorded on YAZ-800) and must be persisted the
  // one way — then ask the sidebar to focus its search bar (it mounts with the flag already true).
  const openSearch = useCallback(() => {
    if (sidebarCollapsed) toggleSidebar()
    setPendingSearchFocus(true)
  }, [sidebarCollapsed, toggleSidebar])

  // File › Open Folder… / Open Recent (GRO-2161) reuse the same flows as the in-app buttons;
  // File › Close Tab and Window › Next/Previous Tab (GRO-2232) drive the tab model.
  useMenuEvents({ onOpenFolder: pick, onOpenRoot: openRoot, onSearch: openSearch, onCloseTab: closeTabOrWindow, onNextTab: nextTab, onPrevTab: prevTab })

  // Deep links (E1, GRO-2171): a routed link behaves like a sidebar click (Tabs rule 10) —
  // it activates the file's tab when already open, else opens it in the CURRENT tab;
  // a link that could not open shows a transient notice — unobtrusive, never a dialog.
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), LINK_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
  useLinkEvents({ onOpenFile: openCurrent, onNotice: setNotice })

  // External rename/move resilience (Links E1c, GRO-2242 — locked: confirm-first, NEVER
  // automatic, never a dialog): ONE detector fed by the cold-start reconcile diff and by
  // consecutive index snapshots (WikilinkIndexBridge's onSnapshot below), surfacing ONE
  // passive app-level banner at a time. Update → repair the app (file:repair-rename, whose
  // file:renamed push drives the SAME tab/editor downstream as an in-app rename) + rewrite
  // the referencing notes; Dismiss → drop for this session. In-app renames are suppressed
  // through the file:renamed effect below, so their watcher echo never banners.
  const { banner: renameBanner, onSnapshot: onIndexSnapshot, suppress: suppressRenameHypothesis, update: updateRenameBanner, dismiss: dismissRenameBanner } = useExternalRenames(root, setNotice)
  const relLabel = useCallback((p: string) => (root !== null && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p), [root])

  // In-app rename (Links E1 GRO-2194, folders E1b GRO-2241). `file:renamed` reaches EVERY
  // window (originator included): BEFORE the tab remap unmounts the old-path editor(s), a
  // dirty buffer is carried into the new path and the old controller retired (no flush to
  // the old path — see lib/renameContinuity.ts); then the tab follows in place, and
  // title/URL-hash track the active tab through the existing effects above. A `dir` event
  // is a PREFIX remap: every open editor and tab under the folder follows, and a window
  // ROOTED at (or under) the folder — a subfolder opened as a vault — follows too (main's
  // store repair already moved its WindowEntry.root; setRoot only mirrors it locally, so
  // no identity write that could clobber the repaired file/tabs).
  useEffect(
    () =>
      window.yaseenDocs.file.onRenamed(({ oldPath, newPath, kind }) => {
        // E1c: an in-app rename's watcher echo (unlink+add with preserved stats) must never
        // be re-offered as an "external rename" hypothesis.
        suppressRenameHypothesis(oldPath, newPath, kind)
        if (kind === 'dir') {
          carryEditorsAcrossDirRename(oldPath, newPath)
          const movedRoot = root !== null && (root === oldPath || root.startsWith(`${oldPath}/`)) ? newPath + root.slice(oldPath.length) : undefined
          renameDirTabs(oldPath, newPath, movedRoot)
          if (movedRoot !== undefined) setRoot(movedRoot)
          return
        }
        carryEditorAcrossRename(oldPath, newPath)
        renameTabPath(oldPath, newPath)
      }),
    [renameTabPath, renameDirTabs, root, suppressRenameHypothesis],
  )

  /**
   * The sidebar's Rename/move commit (files E1, folders + drag-moves E1b): flush our own
   * buffer(s) for the file — or every open editor under the folder — snapshot the index
   * BEFORE the rename (afterwards the old name no longer resolves), rename, then rewrite
   * every referencing note through the shared-resolver engine. All failures land in the
   * passive notice — never a dialog, never a rejection back into the inline input.
   */
  const renameFile = useCallback(
    async (oldPath: string, newPath: string): Promise<void> => {
      const r = root
      if (r === null) return
      // (a) our own unsaved buffers travel WITH the file(s). The kind is unknown until the
      // rename answers, so both run — each is a no-op for the other kind.
      await flushRenamedPath(oldPath)
      await flushRenamedDir(oldPath)
      let records: Awaited<ReturnType<typeof api.index>>['records'] = []
      try {
        records = (await api.index(r)).records
      } catch {
        records = [] // no index snapshot → the rename still runs, links just stay as they are
      }
      let kind: 'file' | 'dir'
      try {
        kind = (await api.rename({ oldPath, newPath })).kind
      } catch (err) {
        const exists = err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS'
        setNotice(exists ? `Can't rename: "${basename(newPath)}" already exists` : `Can't rename: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      const summary = await updateLinksAfterRename({ root: r, oldPath, newPath, kind, records })
      if (summary.updated > 0 || summary.skipped > 0) setNotice(renameNotice(summary))
    },
    [root],
  )

  /**
   * In-app delete landed (GRO-2272). Reaches EVERY window, originator included.
   *
   * ORDER IS NOT NEGOTIABLE: retire the editor, THEN remap tabs. Removing a tab unmounts its
   * editor, and `useAutosave`'s unmount cleanup flushes the live buffer to disk — which would
   * recreate the file that was just trashed. Retiring first makes that flush a no-op. Reverse
   * these two lines and the delete silently fails a second later.
   *
   * A window ROOTED at (or under) a deleted folder is deliberately not repaired here: the
   * sidebar's existing `onRootMissing` probe owns that, and it also drops the dead MRU entry.
   */
  useEffect(
    () =>
      window.yaseenDocs.file.onDeleted(({ path, kind }) => {
        if (kind === 'dir') {
          retireDeletedDir(path)
          deleteDirTabs(path)
          return
        }
        retireDeletedPath(path)
        deleteTabPath(path)
      }),
    [deleteTabPath, deleteDirTabs],
  )

  /**
   * The sidebar's Delete commit (GRO-2272). Deliberately NOT the mirror of `renameFile`, and
   * the two omissions are both load-bearing:
   *
   *  - NO pre-delete flush. `renameFile` flushes so the unsaved buffer travels with the file;
   *    a delete has nowhere to travel to, so flushing would write the file to disk moments
   *    before trashing it — pointless at best, racy at worst.
   *  - NO link rewriting. LOCKED decision C (GRO-2272): notes referencing the deleted page are
   *    left BYTE-IDENTICAL; their `[[links]]` simply go unresolved (the Links A decoration
   *    already renders that) and create-on-click restores the page. Deleting one note must
   *    never silently edit N others — a far bigger blast radius than the gesture, and
   *    un-trashing the file would not undo those edits. Do not "fix" this by adding cleanup.
   *
   * Every failure lands in the passive notice, never a dialog; this promise never rejects back
   * into the caller, matching `onRenameFile`.
   */
  const deleteFile = useCallback(async (path: string): Promise<void> => {
    try {
      await api.delete({ path })
    } catch (err) {
      const name = basename(path)
      // A failed trash means NOTHING was deleted — say so, rather than a bare error string.
      setNotice(
        err instanceof BridgeRequestError && err.code === 'IO_ERROR'
          ? `Can't move "${name}" to the Trash — nothing was deleted`
          : `Can't delete "${name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [])

  const onRootMissing = useCallback(() => {
    storage.setRoot(null) // one identity write: { root: null, file: null, tabs: [] }
    setRoot(null)
    resetTabs(null, null)
  }, [resetTabs])
  // The ACTIVE file vanished on disk: close its tab, ⌘W-style (a neighbour takes over).
  const onFileMissing = useCallback(() => void closeActive(), [closeActive])

  return (
    <div className="app" style={settingsVars} data-threading={settings.bulletThreading ? 'on' : 'off'}>
      {notice !== null && (
        <div className="link-notice" role="status">
          {notice}
        </div>
      )}
      {/* E1c (GRO-2242): the passive external-rename confirmation banner — one hypothesis at a
          time, oldest first. Confirm-first, ALWAYS: no rewrite until Update; Dismiss drops it
          for this session. Passive: steals no focus, Esc is not bound, never a dialog. */}
      {renameBanner !== null && (
        <div className="rename-banner" role="status">
          <span className="rename-banner__text">
            Looks like <code>{relLabel(renameBanner.oldPath)}</code> became <code>{relLabel(renameBanner.newPath)}</code> — update {renameBanner.count} link{renameBanner.count === 1 ? '' : 's'}?
          </span>
          <button type="button" onClick={updateRenameBanner}>
            Update
          </button>
          <button type="button" onClick={dismissRenameBanner}>
            Dismiss
          </button>
        </div>
      )}
      {root !== null && !sidebarCollapsed && (
        <Sidebar
          key={root}
          root={root}
          activeFile={file}
          watch={watch}
          onOpenFile={openCurrent}
          onOpenFileBackground={openBackground}
          onPickFolder={pick}
          pickDisabled={picking}
          onCollapse={toggleSidebar}
          settings={settings}
          onChangeSettings={changeSettings}
          onRootMissing={onRootMissing}
          onFileMissing={onFileMissing}
          onRenameFile={renameFile}
          onDeleteFile={deleteFile}
          onNotice={setNotice}
          // The folder-page toggle's flag state (YAZ-840) reads the SAME per-window index source
          // WikilinkIndexBridge already feeds below — read-only, and no second feed.
          indexSource={wikilinks}
          pendingSearchFocus={pendingSearchFocus}
          onSearchFocusHandled={searchFocusHandled}
        />
      )}
      {root !== null && !sidebarCollapsed && <div className={`sidebar-resize${resizing ? ' sidebar-resize--active' : ''}`} aria-hidden onMouseDown={startSidebarResize} />}
      {root !== null && sidebarCollapsed && (
        <button type="button" className="sidebar-reopen" onClick={toggleSidebar} title="Show sidebar" aria-label="Show sidebar">
          <SidebarPanelIcon />
        </button>
      )}
      {root === null ? (
        <section className="editor">
          {/* No dialog opens by itself (C2, GRO-2164): the Welcome screen offers recents + Open folder…. */}
          <Welcome recents={storage.getRecentRoots()} onOpenRecent={openRoot} onPickFolder={pick} picking={picking} />
        </section>
      ) : (
        <div className="workspace">
          <WikilinkIndexBridge root={root} watch={watch} source={wikilinks} candidates={wikilinkCandidates} onSnapshot={onIndexSnapshot} />
          {/* Tabs rule 2: the strip shows whenever a folder is open — even with one (or zero) tabs. */}
          <TabBar tabs={tabs} active={file} onActivate={activate} onClose={closeTab} onMove={moveTab} canBack={canBack} canForward={canForward} onBack={back} onForward={forward} />
          <div className="tabstack">
            {mounted.length === 0 && <Editor root={root} path={null} watch={watch} onOpenFile={openCurrent} onOpenFileBackground={openBackground} onNotice={setNotice} createBase={createBase} wikilinks={wikilinks} wikilinkCandidates={wikilinkCandidates} properties={propertyDecls} />}
            {mounted.map((path) => (
              // Every VISITED tab keeps its editor mounted so scroll/cursor/undo/unsaved buffer
              // survive a switch (rule 6); inactive layers hide via visibility — see tabs.css
              // for why display:none would lose scroll positions.
              <div key={path} className={path === file ? 'tabstack__layer' : 'tabstack__layer tabstack__layer--hidden'}>
                {/* Wiki-link clicks (Links C, GRO-2192) ride the tabs API: plain → openCurrent, ⌘ → openBackground; create failures land in the link-notice. */}
                <Editor root={root} path={path} watch={watch} onOpenFile={openCurrent} onOpenFileBackground={openBackground} onNotice={setNotice} createBase={createBase} wikilinks={wikilinks} wikilinkCandidates={wikilinkCandidates} properties={propertyDecls} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
