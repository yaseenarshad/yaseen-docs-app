/**
 * "Library folder" (Settings › Images, YAZ-3038; Draw's 🔒 YAZ-1775 D5): the one folder every vault shares, where media
 * favorites and saved components live (`library/mediaStore.ts`, `library/componentStore.ts`). With a settings folder
 * and no folder chosen, it is `<settings folder>/library` (YAZ-4364); a new folder gets a copy, and the old one stays.
 *
 * A component rather than an inline `render` because the row shows the RESOLVED path, and only
 * main knows what null resolves to (`<userData>/library`) — so it asks, once per value.
 * Choosing goes through the native folder dialog, the same `pickFolder` door the vault switcher
 * uses, and "Reset to default" writes null, never `''`: an empty string would resolve to the
 * process cwd.
 */
import { useEffect, useState } from 'react'
import type { SettingsState } from '@shared/types'
import { api } from '../api'
import { usePickFolder } from '../hooks/usePickFolder'

interface LibraryFolderControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
}

/**
 * The resolved folder for the current setting; `''` while the first fetch is in flight. `inSettings`: the default is
 * `<settings folder>/library` (YAZ-4364), so the library syncs with the settings.
 */
function useResolvedLibraryFolder(setting: string | null): { resolved: string; inSettings: boolean } {
  const [resolved, setResolved] = useState({ resolved: setting ?? '', inSettings: false })
  useEffect(() => {
    let live = true
    // A chosen path IS the answer — main would only echo it back.
    if (setting !== null) {
      setResolved({ resolved: setting, inSettings: false })
      return
    }
    Promise.all([api.drawing.libraryFolder(), api.state.settingsFolder().catch(() => ({ folder: null }))]).then(
      ([p, settings]) => {
        if (live) setResolved({ resolved: p, inSettings: settings.folder !== null })
      },
      // A bridge that cannot answer leaves the row saying "…" rather than a wrong path.
      () => {
        if (live) setResolved({ resolved: '', inSettings: false })
      },
    )
    return () => {
      live = false
    }
  }, [setting])
  return resolved
}

/** The resolved path, as the row's live hint. */
export function LibraryFolderHint({ setting }: { setting: string | null }) {
  const { resolved, inSettings } = useResolvedLibraryFolder(setting)
  return (
    <p className="settings__path" data-testid="library-folder-path">
      {resolved === '' ? '…' : resolved}
      {setting === null && resolved !== '' ? (inSettings ? ' (default: in your settings folder, so it syncs)' : ' (default)') : ''}
    </p>
  )
}

export function LibraryFolderControl({ settings, onChange }: LibraryFolderControlProps) {
  const { pick, picking } = usePickFolder({ onPicked: (path) => onChange({ ...settings, libraryFolder: path }) })
  return (
    <>
      <button type="button" className="settings__option" onClick={pick} disabled={picking} aria-label="Choose library folder">
        Choose…
      </button>
      <button type="button" className="settings__option" onClick={() => onChange({ ...settings, libraryFolder: null })} disabled={settings.libraryFolder === null}>
        Reset to default
      </button>
    </>
  )
}
