/**
 * "Default location for new pages" (Files & Links, Links C2- — GRO-2240): Obsidian's three
 * options in a dropdown (a stack of sentence-long buttons was too easy to change by accident —
 * YAZ-1679's fourth call), and for the third a root-relative folder input under the row. A
 * component rather than an inline render because the input carries DRAFT state; the logic moved
 * as-is from the popover (sidebar/SettingsPanel.tsx).
 *
 * The folder input is draft + commit (Enter/blur), CreateInline-style: an invalid path —
 * absolute, `..`/`.`/empty segments — keeps the STORED value and marks the input; the typed
 * text stays for fixing up. An external settings change (another window) resets the draft.
 *
 * "Choose…" beside it opens the in-app place picker (YAZ-3556 D6) on the window's folders, the active tab's vault
 * first; the pick is stored by its path in the vault, as a typed one is. A window with no vault has no picker.
 */
import { useUnit } from '../vault/unitWord'
import { useEffect, useState } from 'react'
import { isValidNewPageFolder, type SettingsState } from '@shared/types'
import { placePath, placeRel } from '../sidebar/goToPlace'
import { PlacePicker, type PlaceVault } from '../sidebar/PlacePicker'
import { Select } from './controls'
import { NEW_PAGE_LOCATION_OPTIONS } from './options'

interface NewPageLocationControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  /** The window's vaults, the active tab's first (`SettingsCtx.places`); absent in a window with no vault. */
  vaults?: readonly PlaceVault[]
}

export function NewPageLocationControl({ settings, onChange, vaults }: NewPageLocationControlProps) {
  const unit = useUnit()
  const [folderDraft, setFolderDraft] = useState(settings.newPageFolder)
  const [picking, setPicking] = useState(false)
  const [folderInvalid, setFolderInvalid] = useState(false)
  useEffect(() => {
    setFolderDraft(settings.newPageFolder)
    setFolderInvalid(false)
  }, [settings.newPageFolder])

  const commitFolder = (raw: string) => {
    const value = raw.trim()
    if (!isValidNewPageFolder(value)) {
      setFolderInvalid(true)
      return
    }
    setFolderInvalid(false)
    setFolderDraft(value)
    if (value !== settings.newPageFolder) onChange({ ...settings, newPageFolder: value })
  }

  return (
    <>
      <Select options={NEW_PAGE_LOCATION_OPTIONS} value={settings.newPageLocation} onChange={(newPageLocation) => onChange({ ...settings, newPageLocation })} ariaLabel={unit('Default location for new pages')} />
      {settings.newPageLocation === 'folder' && vaults !== undefined && vaults.length > 0 && (
        <button type="button" className="settings__option" onClick={() => setPicking(true)}>
          Choose…
        </button>
      )}
      {picking && vaults !== undefined && (
        <PlacePicker
          vaults={vaults}
          start={placePath(vaults[0].root, settings.newPageFolder)}
          label="Choose a folder"
          onPick={(path, vault) => {
            setPicking(false)
            commitFolder(placeRel(vault, path))
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {settings.newPageLocation === 'folder' && (
        <input
          type="text"
          className={`settings__input${folderInvalid ? ' settings__input--error' : ''}`}
          aria-label={unit('Folder to create new pages in')}
          aria-invalid={folderInvalid}
          placeholder="Example: folder 1/folder 2"
          spellCheck={false}
          value={folderDraft}
          onChange={(e) => {
            setFolderDraft(e.target.value)
            setFolderInvalid(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitFolder(e.currentTarget.value)
          }}
          onBlur={(e) => commitFolder(e.target.value)}
        />
      )}
    </>
  )
}
