import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { SettingsState } from '@shared/types'
import { Editor } from './editor/Editor'
import { usePickFolder } from './hooks/usePickFolder'
import { useWatch } from './hooks/useWatch'
import { storage } from './lib/storage'
import { fileHash, hashFilePath } from './lib/urlHash'
import { Sidebar, SidebarPanelIcon } from './sidebar/Sidebar'

/** Reflect the open file in the URL (GRO-2069); replaceState keeps Back sane. */
function syncHash(path: string | null): void {
  history.replaceState(null, '', fileHash(path) || location.pathname + location.search)
}

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

  const openRoot = useCallback((path: string) => {
    storage.setRoot(path)
    storage.pushRecentRoot(path)
    setRoot(path)
    const nextFile = storage.getLastFile(path)
    setFile(nextFile)
    syncHash(nextFile)
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

  const onRootMissing = useCallback(() => {
    storage.setRoot(null)
    setRoot(null)
    setFile(null)
    syncHash(null)
  }, [])
  const onFileMissing = useCallback(() => openFile(null), [openFile])

  // First launch (or lost root): offer a folder straight away.
  useEffect(() => {
    if (root === null) pick()
  }, [root, pick])

  return (
    <div className="app" style={settingsVars} data-threading={settings.bulletThreading ? 'on' : 'off'}>
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
          <div className="landing">
            <p className="editor-msg">{picking ? 'Choose a folder in the dialog…' : 'No folder open.'}</p>
            <button type="button" className="btn btn--primary" disabled={picking} onClick={pick}>
              Open folder…
            </button>
          </div>
        </section>
      ) : (
        <Editor root={root} path={file} watch={watch} onOpenFile={openFile} />
      )}
    </div>
  )
}
