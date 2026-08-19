import { useCallback, useEffect, useState } from 'react'
import type { RecentRoots } from '@shared/types'
import { Editor } from './editor/Editor'
import { usePickFolder } from './hooks/usePickFolder'
import { useWatch } from './hooks/useWatch'
import { storage } from './lib/storage'
import { FolderPicker } from './sidebar/FolderPicker'
import { Sidebar } from './sidebar/Sidebar'

export function App() {
  const [root, setRoot] = useState<string | null>(storage.getRoot)
  const [file, setFile] = useState<string | null>(() => (root === null ? null : storage.getLastFile(root)))
  const [recent, setRecent] = useState<RecentRoots>(storage.getRecentRoots)
  const [pickerOpen, setPickerOpen] = useState(false)
  const watch = useWatch(root)

  const openRoot = useCallback((path: string) => {
    storage.setRoot(path)
    setRecent(storage.pushRecentRoot(path))
    setRoot(path)
    setFile(storage.getLastFile(path))
    setPickerOpen(false)
  }, [])

  const openFile = useCallback(
    (path: string | null) => {
      if (root !== null) storage.setLastFile(root, path)
      setFile(path)
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
  }, [])
  const onFileMissing = useCallback(() => openFile(null), [openFile])

  // First launch (or lost root): offer a folder straight away.
  useEffect(() => {
    if (root === null) pick()
  }, [root, pick])

  return (
    <div className="app">
      {root !== null && (
        <Sidebar
          key={root}
          root={root}
          activeFile={file}
          watch={watch}
          onOpenFile={openFile}
          onPickFolder={pick}
          pickDisabled={picking}
          onRootMissing={onRootMissing}
          onFileMissing={onFileMissing}
        />
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
        <Editor path={file} watch={watch} />
      )}
      {pickerOpen && (
        <FolderPicker initialPath={root} recent={recent} onOpen={openRoot} onCancel={root === null ? undefined : closePicker} />
      )}
    </div>
  )
}
