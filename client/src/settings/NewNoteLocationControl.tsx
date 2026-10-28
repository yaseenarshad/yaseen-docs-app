/**
 * "Default location for new notes" (Files & Links, Links C2- — GRO-2240): Obsidian's three
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
import { useEffect, useState } from 'react'
import { isValidNewNoteFolder, type SettingsState } from '@shared/types'
import { placePath, placeRel } from '../sidebar/goToPlace'
import { PlacePicker, type PlaceVault } from '../sidebar/PlacePicker'
import { Select } from './controls'
import { NEW_NOTE_LOCATION_OPTIONS } from './options'

interface NewNoteLocationControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  /** The window's vaults, the active tab's first (`SettingsCtx.places`); absent in a window with no vault. */
  vaults?: readonly PlaceVault[]
}

export function NewNoteLocationControl({ settings, onChange, vaults }: NewNoteLocationControlProps) {
  const [folderDraft, setFolderDraft] = useState(settings.newNoteFolder)
  const [picking, setPicking] = useState(false)
  const [folderInvalid, setFolderInvalid] = useState(false)
  useEffect(() => {
    setFolderDraft(settings.newNoteFolder)
    setFolderInvalid(false)
  }, [settings.newNoteFolder])

  const commitFolder = (raw: string) => {
    const value = raw.trim()
    if (!isValidNewNoteFolder(value)) {
      setFolderInvalid(true)
      return
    }
    setFolderInvalid(false)
    setFolderDraft(value)
    if (value !== settings.newNoteFolder) onChange({ ...settings, newNoteFolder: value })
  }

  return (
    <>
      <Select options={NEW_NOTE_LOCATION_OPTIONS} value={settings.newNoteLocation} onChange={(newNoteLocation) => onChange({ ...settings, newNoteLocation })} ariaLabel="Default location for new notes" />
      {settings.newNoteLocation === 'folder' && vaults !== undefined && vaults.length > 0 && (
        <button type="button" className="settings__option" onClick={() => setPicking(true)}>
          Choose…
        </button>
      )}
      {picking && vaults !== undefined && (
        <PlacePicker
          vaults={vaults}
          start={placePath(vaults[0].root, settings.newNoteFolder)}
          label="Choose a folder"
          onPick={(path, vault) => {
            setPicking(false)
            commitFolder(placeRel(vault, path))
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {settings.newNoteLocation === 'folder' && (
        <input
          type="text"
          className={`settings__input${folderInvalid ? ' settings__input--error' : ''}`}
          aria-label="Folder to create new notes in"
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
