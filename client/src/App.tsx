import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { RecentRoots, SettingsState } from '@shared/types'
import { Editor } from './editor/Editor'
import { usePickFolder } from './hooks/usePickFolder'
import { useWatch } from './hooks/useWatch'
import { storage } from './lib/storage'
import { fileHash, hashFilePath } from './lib/urlHash'
import { FolderPicker } from './sidebar/FolderPicker'
import { Sidebar, SidebarPanelIcon } from './sidebar/Sidebar'

/** Reflect the open file in the URL (GRO-2069); replaceState keeps Back sane. */
function syncHash(path: string | null): void {
  history.replaceState(null, '', fileHash(path) || location.pathname + location.search)
}

export function App() {
  const [root, setRoot] = useState<string | null>(storage.getRoot)
  // A pasted `#/abs/path.md` URL wins over the remembered last file (GRO-2069).
  const [file, setFile] = useState<string | null>(() =>
    root === null ? null : (hashFilePath(location.hash) ?? storage.getLastFile(root)),
  )
  const [recent, setRecent] = useState<RecentRoots>(storage.getRecentRoots)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storage.getSidebarCollapsed)
  const [settings, setSettings] = useState(storage.getSettings)
  const watch = useWatch(root)

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
  const settingsVars = {
    '--edit-line-height': settings.lineSpacing,
    '--edit-block-gap': `${settings.blockGap}px`,
  } as CSSProperties

  // Mount only: the restored-from-storage file also shows in the URL from the start;
  // later changes sync through openFile/openRoot themselves.
  useEffect(() => syncHash(file), [])

  const openRoot = useCallback((path: string) => {
    storage.setRoot(path)
    setRecent(storage.pushRecentRoot(path))
    setRoot(path)
    const nextFile = storage.getLastFile(path)
    setFile(nextFile)
    syncHash(nextFile)
    setPickerOpen(false)
  }, [])

  const openFile = useCallback(
    (path: string | null) => {
      if (root !== null) storage.setLastFile(root, path)
      setFile(path)
      syncHash(path)
    },
    [root],
  )

  const openPicker = useCallback(() => setPickerOpen(true), [])
  const closePicker = useCallback(() => setPickerOpen(false), [])
  const { pick, picking } = usePickFolder({ onPicked: openRoot, onFallback: openPicker })

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
    <div className="app" style={settingsVars}>
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
            <p className="editor-msg">{picking ? 'Choose a folder in the Finder dialog…' : 'No folder open.'}</p>
            <button type="button" className="btn btn--primary" disabled={picking} onClick={pick}>
              Open folder…
            </button>
          </div>
        </section>
      ) : (
        <Editor root={root} path={file} watch={watch} />
      )}
      {pickerOpen && (
        <FolderPicker initialPath={root} recent={recent} onOpen={openRoot} onCancel={root === null ? undefined : closePicker} />
      )}
    </div>
  )
}
