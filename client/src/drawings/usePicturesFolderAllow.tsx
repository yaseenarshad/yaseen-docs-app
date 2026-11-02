/**
 * THE ASK FOR A BOARD'S OUTSIDE PICTURES FOLDER (YAZ-3943 demo round 3). A board whose block names a folder outside
 * the vault that this Mac has not approved asks ONCE when it opens — in a tab (`DrawingEditor`) or in the note popup
 * (`DrawingModal`) — in the app's confirm sheet. "Allow" puts the folder on the Mac's list (`picture-folders:allow`,
 * checked in main like a pick), and no other board using that folder asks again. "Not now" (Esc and a click outside
 * too) opens the board as it is: it shows every picture it can read, new pictures land in the vault's `assets/`
 * (main's fallback), and the tab's cog shows "Folder not allowed on this Mac" with "Allow…", which opens the same
 * sheet (`askAllow`). The board asks again the next time it opens. Never on a save or a keystroke: one `list` call per
 * open of such a board, none for a board with no outside folder (`folder` null). A folder inside the vault never asks.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { withHomeTilde } from '@shared/drawingAssets'
import { api, BridgeRequestError } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { NoticeKind } from '../lib/notice'

/** The sheet's words. */
export const ALLOW_FOLDER_TITLE = "Allow this board's pictures folder?"
export const allowFolderBody = (shown: string): string => `This board keeps its pictures in ${shown}. That folder is outside the vault. Allow the app to save pictures there on this Mac?`

/** `folder`: the board's OUTSIDE pictures folder (absolute), or null when it has none. `home` is the user's home folder, for `~/…` (the Welcome screen's rule). */
export function usePicturesFolderAllow(folder: string | null, onNotice?: (text: string, icon?: NoticeKind) => void): { allowed: boolean | null; askAllow: () => void; home: string; sheet: ReactNode } {
  const [home, setHome] = useState('')
  /** Whether this Mac's list holds `folder`; null: no outside folder, or main has not answered yet. */
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [asking, setAsking] = useState(false)
  /** The folder this open asked about already: a reload of the same board does not ask twice. */
  const asked = useRef<string | null>(null)
  useEffect(() => {
    let live = true
    api.app.home().then(
      (h) => {
        if (live) setHome(h)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (folder === null) {
      setAllowed(null)
      return
    }
    let live = true
    api.pictureFolders.list().then(
      (list) => {
        if (!live) return
        const ok = list.includes(folder)
        setAllowed(ok)
        if (!ok && asked.current !== folder) {
          asked.current = folder
          setAsking(true)
        }
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [folder])
  const allow = (): void => {
    if (folder === null) return
    setAsking(false)
    api.pictureFolders.allow(folder).then(
      () => setAllowed(true),
      (err: unknown) => onNotice?.(err instanceof BridgeRequestError && err.message !== '' ? err.message : "The folder couldn't be allowed.", 'error'),
    )
  }
  const sheet =
    asking && folder !== null ? (
      // The app's own sheet (YAZ-2201); `contained`, so its Esc, Enter and click-away never reach the canvas under it.
      <ConfirmSheet
        labelId="confirm-pictures-folder-allow-text"
        text={
          <>
            <span className="confirm__title">{ALLOW_FOLDER_TITLE}</span>
            {allowFolderBody(withHomeTilde(folder, home))}
          </>
        }
        confirmLabel="Allow"
        cancelLabel="Not now"
        keys="contained"
        onConfirm={allow}
        onCancel={() => setAsking(false)}
      />
    ) : null
  return { allowed, askAllow: () => setAsking(true), home, sheet }
}
