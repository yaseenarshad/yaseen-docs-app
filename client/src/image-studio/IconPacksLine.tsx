/**
 * "DOWNLOAD ALL ICON PACKS" AT THE BOTTOM OF THE ICON RESULTS (YAZ-4359, round 2 decision 8). Streaming stays the
 * default; this line offers the rest: "Want every icon, also offline?". The button opens the confirm box
 * (`ConfirmSheet`), and only its Download starts anything — packs never download by themselves. The progress shows in
 * the same place, with Cancel; a stop keeps the finished packs, and the line then offers "Download the rest". With
 * every pack on the Mac the line is gone. Settings › Images › Icon packs has the same box (`PacksConfirm`).
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatPackBytes, packsBusy, packsProgressText, type IconPacksStatus } from '@shared/iconPacks'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { packsDo, useIconPacks } from './useIconPacks'

/** The confirm box's sentence, in the approved words, with the plan's numbers when there is one. */
export const packsConfirmText = (status: Pick<IconPacksStatus, 'total' | 'totalBytes'>): string =>
  `All ${status.total} free icon packs from Iconify come to this Mac: about ${formatPackBytes(status.totalBytes)}.`
export const PACKS_CONFIRM_MORE = 'Then icon search, tiles and adds work from the Mac: instant, complete, and offline.'

/**
 * The confirm box (Download / Cancel). Download starts the run and closes the box; the progress shows where it was
 * opened. Drawn on `document.body`: the canvas panel sits inside the engine's layers, where a fixed sheet is clipped.
 */
export function PacksConfirm({ status, onClose }: { status: IconPacksStatus; onClose: () => void }) {
  return createPortal(
    <ConfirmSheet
      labelId="confirm-icon-packs-text"
      text={
        <>
          <span className="confirm__title">Download all icon packs?</span>
          {packsConfirmText(status)} {PACKS_CONFIRM_MORE}
        </>
      }
      confirmLabel="Download"
      focusConfirm
      keys="contained"
      onConfirm={() => {
        onClose()
        void packsDo('download')
      }}
      onCancel={onClose}
    />,
    document.body,
  )
}

export function IconPacksLine() {
  const status = useIconPacks()
  const [asking, setAsking] = useState(false)
  if (status === null || status.state === 'complete' || status.state === 'removing' || status.state === 'moving') return null
  const busy = packsBusy(status)
  return (
    <div className="image-studio__packs" role="status" aria-label="Icon packs">
      {busy ? (
        <>
          <span>{packsProgressText(status)}</span>
          <button type="button" onClick={() => void packsDo('stop')}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className={status.failed ? 'image-studio__packs-error' : undefined}>
            {status.failed && status.message !== null ? status.message : status.state === 'partial' ? `${status.packs} of ${status.total} icon packs are on this Mac.` : 'Want every icon, also offline?'}
          </span>
          {status.state === 'partial' ? (
            <button type="button" onClick={() => void packsDo('download')}>
              Download the rest
            </button>
          ) : (
            <button type="button" onClick={() => setAsking(true)}>
              Download all icon packs
            </button>
          )}
        </>
      )}
      {asking && <PacksConfirm status={status} onClose={() => setAsking(false)} />}
    </div>
  )
}
