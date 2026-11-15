import { useMemo } from 'react'
import { runFolderView, type FolderModel } from './folderModel'

/**
 * THE OPEN VIEW OF A FOLDER'S PAGE (YAZ-5460): the Mac's engine runs the view (`runFolderView`), and the phone draws it,
 * read only, made for a narrow screen.
 */
export function FolderViewPane({ model, index, vault }: { model: FolderModel; index: number; vault: string }) {
  const run = useMemo(() => runFolderView(model, index, vault), [model, index, vault])
  return (
    <div className="folder-view" role="tabpanel" aria-label={run.view.name}>
      <p className="muted folder-view__none">This view shows on the Mac.</p>
    </div>
  )
}
