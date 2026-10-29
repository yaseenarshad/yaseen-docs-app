/**
 * Settings › Sidebar › Show in sidebar (YAZ-3556 D8): where "Show in sidebar" (⌘D) goes. One dropdown: the five tabs of the
 * sidebar, "A folder…" and "A file…". The last two open the place picker (D6) on the window's vaults, files too for
 * "A file…", and the pick is stored by its path in the vault (D2). A folder or a file shows its path and "Change…".
 * A window with no vault has no picker: the two rows do nothing there.
 */
import { useState } from 'react'
import type { GoToPlace, SettingsState, SidebarLens } from '@shared/types'
import { placePath, placeRel } from '../sidebar/goToPlace'
import { PlacePicker, type PlaceVault } from '../sidebar/PlacePicker'
import { Select } from './controls'
import type { Option } from './options'

type GoToChoice = SidebarLens | 'folder' | 'file'

export const GO_TO_OPTIONS: readonly Option<GoToChoice>[] = [
  { label: 'Files tab', value: 'files' },
  { label: 'Focus tab', value: 'focus' },
  { label: 'Favorites tab', value: 'favorites' },
  { label: 'Sessions tab', value: 'sessions' },
  { label: 'Recents tab', value: 'recents' },
  { label: 'A folder…', value: 'folder' },
  { label: 'A file…', value: 'file' },
]

interface GoToControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  /** The window's vaults, the active tab's first (`SettingsCtx.places`); absent in a window with no vault. */
  vaults?: readonly PlaceVault[]
}

export function GoToControl({ settings, onChange, vaults }: GoToControlProps) {
  const goTo = settings.goTo
  const [picking, setPicking] = useState<'folder' | 'file' | null>(null)
  const set = (next: GoToPlace) => onChange({ ...settings, goTo: next })
  const choose = (choice: GoToChoice) => {
    if (choice === 'folder' || choice === 'file') {
      if (vaults !== undefined && vaults.length > 0) setPicking(choice)
    } else set({ kind: 'tab', tab: choice })
  }
  // The picker opens where the place is: the folder itself, or the folder of the file.
  const start = vaults === undefined || goTo.kind === 'tab' ? undefined : placePath(vaults[0].root, goTo.kind === 'file' ? goTo.path.slice(0, Math.max(0, goTo.path.lastIndexOf('/'))) : goTo.path)

  return (
    <>
      <Select options={GO_TO_OPTIONS} value={goTo.kind === 'tab' ? goTo.tab : goTo.kind} onChange={choose} ariaLabel="What Show in sidebar shows" />
      {goTo.kind !== 'tab' && (
        <span className="settings__place">
          <span className="settings__place-path" title={goTo.path}>
            {goTo.path === '' ? 'The vault folder' : goTo.path}
          </span>
          <button type="button" className="settings__option" disabled={vaults === undefined || vaults.length === 0} onClick={() => setPicking(goTo.kind)}>
            Change…
          </button>
        </span>
      )}
      {picking !== null && vaults !== undefined && (
        <PlacePicker
          vaults={vaults}
          mode={picking === 'file' ? 'files' : 'folders'}
          start={start}
          label={picking === 'file' ? 'Choose a file' : 'Choose a folder'}
          onPick={(path, vault) => {
            set({ kind: picking, path: placeRel(vault, path) })
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
