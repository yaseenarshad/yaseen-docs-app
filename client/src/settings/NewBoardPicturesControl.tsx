/**
 * "New boards keep pictures" (Files & Links, YAZ-3943 demo 2; the third choice is demo round 3): inside the board,
 * in the assets folder, or in a folder the user picks. With the third, the chosen folder shows under the control
 * with "Choose…", which opens the native folder dialog on the CURRENT vault (`dialog:pick-pictures-folder`, the
 * cog's own door): a folder inside that vault is stored relative to its root, one outside the vault (anywhere on the
 * Mac) absolute and shown as `~/…`; the setting is app-wide, so it applies in whatever vault a board is made in (a
 * folder that is not there yet is made when the first picture lands). A pick the door refuses — the vault itself, a
 * system folder, a hidden folder — shows its one-line reason and changes nothing. No folder chosen yet behaves as
 * "In the assets folder". A window with no vault has no "Choose…".
 */
import { useEffect, useRef, useState } from 'react'
import { withHomeTilde } from '@shared/drawingAssets'
import type { SettingsState } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { PlaceVault } from '../sidebar/PlacePicker'
import { Segmented } from './controls'

/** Files & Links › New boards keep pictures (YAZ-3943 demo 2, demo round 3). */
const NEW_BOARD_PICTURES_OPTIONS: readonly { label: string; value: SettingsState['newBoardPictures'] }[] = [
  { label: 'Inside the board', value: 'inside' },
  { label: 'In the assets folder', value: 'assets' },
  { label: 'In a folder you pick', value: 'folder' },
]

/** What the row says while no folder is chosen. */
export const NO_PICTURES_FOLDER_YET = 'No folder chosen yet: the assets folder is used.'

interface NewBoardPicturesControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  /** The window's vaults, the active tab's first (`SettingsCtx.places`); absent in a window with no vault. */
  vaults?: readonly PlaceVault[]
}

export function NewBoardPicturesControl({ settings, onChange, vaults }: NewBoardPicturesControlProps) {
  const [picking, setPicking] = useState(false)
  /** The door's one-line reason for refusing the last pick; cleared by the next pick. */
  const [refused, setRefused] = useState<string | null>(null)
  /** The user's home folder, for an outside folder shown as `~/…`; '' until main answers. */
  const [home, setHome] = useState('')
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    api.app.home().then(
      (h) => {
        if (live.current) setHome(h)
      },
      () => undefined,
    )
    return () => {
      live.current = false
    }
  }, [])
  const root = vaults?.[0]?.root
  const choose = () => {
    if (root === undefined || picking) return
    setPicking(true)
    setRefused(null)
    api
      .pickPicturesFolder({ root, ...(settings.newBoardPicturesFolder === '' ? {} : { current: settings.newBoardPicturesFolder }) })
      .then(
        (res) => {
          if (live.current && 'folder' in res) onChange({ ...settings, newBoardPicturesFolder: res.folder })
        },
        (err: unknown) => {
          if (live.current) setRefused(err instanceof BridgeRequestError && err.message !== '' ? err.message : "The folder couldn't be chosen.")
        },
      )
      .finally(() => {
        if (live.current) setPicking(false)
      })
  }
  return (
    <>
      <Segmented options={NEW_BOARD_PICTURES_OPTIONS} value={settings.newBoardPictures} onChange={(newBoardPictures) => onChange({ ...settings, newBoardPictures })} ariaLabel="New boards keep pictures" />
      {settings.newBoardPictures === 'folder' && (
        <>
          <p className="settings__path" data-testid="new-board-pictures-folder">
            {settings.newBoardPicturesFolder === '' ? NO_PICTURES_FOLDER_YET : withHomeTilde(settings.newBoardPicturesFolder, home)}
          </p>
          {refused !== null && (
            <p className="settings__error" role="alert">
              {refused}
            </p>
          )}
          {root !== undefined && (
            // One row of normal-size buttons, as the Library folder row has: a wide row stretches each direct child (YAZ-3308).
            <div className="settings__options" role="group" aria-label="Pictures folder for new boards">
              <button type="button" className="settings__option" onClick={choose} disabled={picking} aria-label="Choose pictures folder for new boards">
                Choose…
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
