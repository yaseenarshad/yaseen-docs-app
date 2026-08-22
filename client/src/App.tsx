import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import type { SettingsState } from '@shared/types'
import { api, ApiRequestError } from './api'
import { applyCrepeTheme } from './editor/crepeTheme'
import { Editor } from './editor/Editor'
import { useLinkEvents } from './hooks/useLinkEvents'
import { useMenuEvents } from './hooks/useMenuEvents'
import { usePickFolder } from './hooks/usePickFolder'
import { useWatch } from './hooks/useWatch'
import { storage } from './lib/storage'
import { resolveTheme, useSystemPrefersDark } from './lib/theme'
import { fileHash, hashFilePath } from './lib/urlHash'
import { windowTitle } from './lib/windowTitle'
import { Sidebar, SidebarPanelIcon } from './sidebar/Sidebar'
import { Welcome } from './Welcome'

/** Reflect the open file in the URL (GRO-2069); replaceState keeps Back sane. */
function syncHash(path: string | null): void {
  history.replaceState(null, '', fileHash(path) || location.pathname + location.search)
}

/** A can't-open-link notice (E1, GRO-2171) dismisses itself after this long. */
export const LINK_NOTICE_MS = 4000

export function App() {
  const [root, setRoot] = useState<string | null>(storage.getRoot)
  // A pasted `#/abs/path.md` URL wins (GRO-2069), then this window's restored file (GRO-2160),
  // then the folder's remembered last file (a fresh window on the folder).
  const [file, setFile] = useState<string | null>(() =>
    root === null ? null : (hashFilePath(location.hash) ?? storage.getFile() ?? storage.getLastFile(root)),
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storage.getSidebarCollapsed)
  const [settings, setSettings] = useState(storage.getSettings)
  const watch = useWatch(root)

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

  // Mount only: the restored-from-storage file also shows in the URL from the start;
  // later changes sync through openFile/openRoot themselves.
  useEffect(() => syncHash(file), [])

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
      if (err instanceof ApiRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) {
        storage.removeRecentRoot(path)
        return false
      }
    }
    storage.setRoot(path)
    storage.pushRecentRoot(path)
    setRoot(path)
    const nextFile = storage.getLastFile(path)
    // Record the restored file on the window entry too (D6): setRoot just cleared it.
    if (nextFile !== null) storage.setLastFile(path, nextFile)
    setFile(nextFile)
    syncHash(nextFile)
    return true
  }, [])

  const openFile = useCallback(
    (path: string | null) => {
      if (root !== null) storage.setLastFile(root, path)
      setFile(path)
      syncHash(path)
    },
    [root],
  )

  const { pick, picking } = usePickFolder({ onPicked: openRoot })

  // File › Open Folder… / Open Recent (GRO-2161) reuse the same flows as the in-app buttons.
  useMenuEvents({ onOpenFolder: pick, onOpenRoot: openRoot })

  // Deep links (E1, GRO-2171): a routed link opens its file exactly like a sidebar click;
  // a link that could not open shows a transient notice — unobtrusive, never a dialog.
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), LINK_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
  useLinkEvents({ onOpenFile: openFile, onNotice: setNotice })

  const onRootMissing = useCallback(() => {
    storage.setRoot(null)
    setRoot(null)
    setFile(null)
    syncHash(null)
  }, [])
  const onFileMissing = useCallback(() => openFile(null), [openFile])

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
          onOpenFile={openFile}
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
        <Editor root={root} path={file} watch={watch} onOpenFile={openFile} />
      )}
    </div>
  )
}
