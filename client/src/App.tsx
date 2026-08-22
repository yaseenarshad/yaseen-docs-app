import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import type { SettingsState } from '@shared/types'
import { api, BridgeRequestError } from './api'
import { applyCrepeTheme } from './editor/crepeTheme'
import { Editor } from './editor/Editor'
import { createWikilinkResolveSource } from './editor/wikilink/wikilinkPlugin'
import { WikilinkIndexBridge } from './editor/wikilink/WikilinkIndexBridge'
import { useLinkEvents } from './hooks/useLinkEvents'
import { useMenuEvents } from './hooks/useMenuEvents'
import { usePickFolder } from './hooks/usePickFolder'
import { useWatch } from './hooks/useWatch'
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
  const { tabs, active: file, mounted, openCurrent, openBackground, activate, close: closeTab, move: moveTab, closeActive, next: nextTab, prev: prevTab, reset: resetTabs } = useTabs(root)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storage.getSidebarCollapsed)
  const [settings, setSettings] = useState(storage.getSettings)
  const watch = useWatch(root)
  // Wikilinks (Links A, GRO-2190): ONE resolve source per window — a stable object every
  // editor's wikilink plugin subscribes to; WikilinkIndexBridge (below) keeps it fed from the
  // vault index, so index changes restyle links live without any editor remounting.
  const [wikilinks] = useState(createWikilinkResolveSource)

  // Settings and the sidebar toggle are global (D9): a change made in another window lands here live.
  useEffect(
    () =>
      storage.subscribe(() => {
        setSettings(storage.getSettings())
        setSidebarCollapsed(storage.getSidebarCollapsed())
      }),
    [],
  )

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      storage.setSidebarCollapsed(!collapsed)
      return !collapsed
    })
  }, [])

  const changeSettings = useCallback((next: SettingsState) => {
    storage.setSettings(next)
    setSettings(next)
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

  // File › Open Folder… / Open Recent (GRO-2161) reuse the same flows as the in-app buttons;
  // File › Close Tab and Window › Next/Previous Tab (GRO-2232) drive the tab model.
  useMenuEvents({ onOpenFolder: pick, onOpenRoot: openRoot, onCloseTab: closeTabOrWindow, onNextTab: nextTab, onPrevTab: prevTab })

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
        />
      )}
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
          <WikilinkIndexBridge root={root} watch={watch} source={wikilinks} />
          {/* Tabs rule 2: the strip shows whenever a folder is open — even with one (or zero) tabs. */}
          <TabBar tabs={tabs} active={file} onActivate={activate} onClose={closeTab} onMove={moveTab} />
          <div className="tabstack">
            {mounted.length === 0 && <Editor root={root} path={null} watch={watch} onOpenFile={openCurrent} wikilinks={wikilinks} />}
            {mounted.map((path) => (
              // Every VISITED tab keeps its editor mounted so scroll/cursor/undo/unsaved buffer
              // survive a switch (rule 6); inactive layers hide via visibility — see tabs.css
              // for why display:none would lose scroll positions.
              <div key={path} className={path === file ? 'tabstack__layer' : 'tabstack__layer tabstack__layer--hidden'}>
                <Editor root={root} path={path} watch={watch} onOpenFile={openCurrent} wikilinks={wikilinks} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
