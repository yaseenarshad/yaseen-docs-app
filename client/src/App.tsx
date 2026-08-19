import { useCallback, useState } from 'react'
import type { RecentRoots } from '@shared/types'
import { Editor } from './editor/Editor'
import { useWatch } from './hooks/useWatch'
import { storage } from './lib/storage'
import { FolderPicker } from './sidebar/FolderPicker'
import { Sidebar } from './sidebar/Sidebar'

export function App() {
  const [root, setRoot] = useState<string | null>(storage.getRoot)
  const [file, setFile] = useState<string | null>(() => (root === null ? null : storage.getLastFile(root)))
  const [recent, setRecent] = useState<RecentRoots>(storage.getRecentRoots)
  const [pickerOpen, setPickerOpen] = useState(root === null)
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

  const onRootMissing = useCallback(() => {
    storage.setRoot(null)
    setRoot(null)
    setFile(null)
    setPickerOpen(true)
  }, [])
  const onFileMissing = useCallback(() => openFile(null), [openFile])
  const openPicker = useCallback(() => setPickerOpen(true), [])
  const closePicker = useCallback(() => setPickerOpen(false), [])

  return (
    <div className="app">
      {root !== null && (
        <Sidebar
          key={root}
          root={root}
          activeFile={file}
          watch={watch}
          onOpenFile={openFile}
          onPickFolder={openPicker}
          onRootMissing={onRootMissing}
          onFileMissing={onFileMissing}
        />
      )}
      <Editor path={file} watch={watch} />
      {pickerOpen && (
        <FolderPicker initialPath={root} recent={recent} onOpen={openRoot} onCancel={root === null ? undefined : closePicker} />
      )}
    </div>
  )
}
