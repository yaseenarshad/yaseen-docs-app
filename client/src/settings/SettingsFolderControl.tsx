/**
 * "Settings folder" (Settings › General, YAZ-3276 D7): where the settings that travel are kept, so that each
 * Mac that points at one synced folder uses the same settings. The same shape as `LibraryFolderControl`.
 *
 * The pointer is this Mac's (`AppState.settingsFolder`), not a setting, and only main knows whether a
 * chosen folder is missing now (D5) — so the row asks main when it shows, and again after each choice.
 * "Choose…" is the native folder dialog (`usePickFolder`); "Reset to default" sends null, which keeps the
 * settings this Mac has and leaves its file in the folder (D6).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { usePickFolder } from '../hooks/usePickFolder'

interface FolderStatus {
  folder: string | null
  missing: boolean
}

export function SettingsFolderControl() {
  /** null while the first answer is in flight, or when the bridge could not answer: the row then says "…". */
  const [status, setStatus] = useState<FolderStatus | null>(null)
  const live = useRef(true)
  const read = useCallback(() => {
    api.state.settingsFolder().then(
      (next) => {
        if (live.current) setStatus(next)
      },
      () => {
        if (live.current) setStatus(null)
      },
    )
  }, [])
  useEffect(() => {
    live.current = true
    read()
    return () => {
      live.current = false
    }
  }, [read])
  const set = (folder: string | null) => {
    // A refused path (it can't come from the dialog) leaves the row as it was; read again either way.
    api.state.setSettingsFolder(folder).then(read, read)
  }
  const { pick, picking } = usePickFolder({ onPicked: set })
  return (
    <>
      <p className="settings__path" data-testid="settings-folder-path">
        {status === null ? '…' : (status.folder ?? 'On this Mac only (default)')}
      </p>
      {status?.missing === true && (
        <p className="settings__error" role="alert">
          Can't find this folder. This Mac uses its last settings. It reads the folder again when it comes back.
        </p>
      )}
      {/* One row of normal-size buttons, as the Library folder row has: a wide row stretches each direct child (YAZ-3308). */}
      <div className="settings__options" role="group" aria-label="Settings folder">
        <button type="button" className="settings__option" onClick={pick} disabled={picking} aria-label="Choose settings folder">
          Choose…
        </button>
        <button type="button" className="settings__option" onClick={() => set(null)} disabled={status?.folder == null}>
          Reset to default
        </button>
      </div>
    </>
  )
}
