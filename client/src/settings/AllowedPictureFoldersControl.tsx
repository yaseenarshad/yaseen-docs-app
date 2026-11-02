/**
 * "Allowed picture folders" (Files & Links, YAZ-3943 demo round 3): the folders OUTSIDE a vault where the app may save a
 * board's pictures on this Mac (`AppState.approvedPictureFolders`, through `picture-folders:list` / `remove`). A folder
 * gets here by a pick in "Choose a folder…" or the Settings "Choose…", or by "Allow" on a board that opens naming it.
 * Each shows as `~/…` with a "Remove" button, which takes it off the list only — no file moves or goes; a board that
 * uses it asks again the next time it opens. "None yet" when the list is empty. The same shape as `SettingsFolderControl`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { withHomeTilde } from '@shared/drawingAssets'
import { api } from '../api'

export function AllowedPictureFoldersControl() {
  /** null while the first answer is in flight, or when the bridge could not answer: the row then says "…". */
  const [folders, setFolders] = useState<string[] | null>(null)
  const [home, setHome] = useState('')
  const live = useRef(true)
  const read = useCallback(() => {
    api.pictureFolders.list().then(
      (next) => {
        if (live.current) setFolders(next)
      },
      () => {
        if (live.current) setFolders(null)
      },
    )
  }, [])
  useEffect(() => {
    live.current = true
    read()
    api.app.home().then(
      (h) => {
        if (live.current) setHome(h)
      },
      () => undefined,
    )
    return () => {
      live.current = false
    }
  }, [read])
  const remove = (folder: string) => {
    api.pictureFolders.remove(folder).then(read, read)
  }
  if (folders === null) return <p className="settings__path">…</p>
  if (folders.length === 0) return <p className="settings__path">None yet</p>
  return (
    <>
      {folders.map((folder) => (
        // One row per folder: the path, then its button, as the Settings folder row is laid out (YAZ-3308).
        <div key={folder} className="settings__options" role="group" aria-label={`Allowed picture folder ${withHomeTilde(folder, home)}`}>
          <p className="settings__path" title={folder}>
            {withHomeTilde(folder, home)}
          </p>
          <button type="button" className="settings__option" onClick={() => remove(folder)} aria-label={`Remove ${withHomeTilde(folder, home)} from the allowed picture folders`}>
            Remove
          </button>
        </div>
      ))}
    </>
  )
}
