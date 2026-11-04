/**
 * THE ICON PACKS DOWNLOAD IN THE ADD PANEL'S FOOTER (YAZ-4359, round 2 decision 8; in the footer since the YAZ-4348
 * demo). Streaming stays the default; "↓ All icon packs", beside "Google Images ↗", offers the rest. It opens the
 * confirm box (`ConfirmSheet`), and only its Download starts anything: packs never download by themselves. The
 * progress shows in the same place, with Cancel; a stop keeps the finished packs, and the link then says "↓ The rest of
 * the icon packs". With every pack on the Mac only Google Images shows. Settings › Images › Icon packs has the same box
 * (`PacksConfirm`).
 */
import { useState, type ReactNode } from 'react'
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
  // YAZ-4348 demo: the app's sheets sit at z-index 60, under the board's side panel (the engine's
  // `--zIndex-ui-library`, 120): opened from the Add panel, the box showed BEHIND the panel and a click
  // fell through it. This layer lifts it to the engine's modal level (`--zIndex-modal`, 1000), and its
  // `data-prevent-outside-click` keeps the side panel open: a click on the box is not a click outside the panel,
  // which would close the panel and take the box (a child of the panel) with it before Download ran.
  return createPortal(
    <div className="image-studio__sheet-layer" data-prevent-outside-click>
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
      />
    </div>,
    document.body
  )
}

/**
 * YAZ-4348 demo: the panel's footer row. While packs are missing, the download (or its progress with Cancel) sits on
 * the left and `google` on the right; with every pack on the Mac only `google` shows, centred.
 */
export function IconPacksFooter({ google }: { google: ReactNode }) {
  const status = useIconPacks()
  const [asking, setAsking] = useState(false)
  const shown = status !== null && status.state !== 'complete' && status.state !== 'removing' && status.state !== 'moving'
  let packs: ReactNode = null
  if (shown) {
    if (packsBusy(status)) {
      // YAZ-4348 demo round 2 ("ugly UI"): one quiet line, like the links beside it: a short word, a thin bar and its
      // percent, then Cancel. The full count (packs and MB) is in the tooltip and is what a screen reader hears.
      const share = status.totalBytes > 0 ? Math.min(100, Math.round((status.bytes / status.totalBytes) * 100)) : status.total > 0 ? Math.min(100, Math.round((status.packs / status.total) * 100)) : 0
      const full = packsProgressText(status)
      packs = (
        <span className="image-studio__footer-packs is-busy" role="status" aria-label={full} title={full}>
          <span aria-hidden="true">{status.state === 'checking' ? 'Checking icons' : 'Downloading icons'}</span>
          <span className="image-studio__footer-bar" aria-hidden="true">
            <i style={{ width: `${share}%` }} />
          </span>
          <span className="image-studio__footer-share" aria-hidden="true">
            {share}%
          </span>
          <button type="button" onClick={() => void packsDo('stop')}>
            Cancel
          </button>
        </span>
      )
    } else if (status.failed && status.message !== null) {
      packs = (
        <span className="image-studio__footer-packs" role="status">
          <span className="image-studio__packs-error">{status.message}</span>
          <button type="button" onClick={() => void packsDo('download')}>
            Try again
          </button>
        </span>
      )
    } else {
      packs = (
        <button
          type="button"
          className="image-studio__footer-download"
          title="Every Iconify icon on this Mac: instant, complete and offline"
          onClick={() => (status.state === 'partial' ? void packsDo('download') : setAsking(true))}
        >
          {status.state === 'partial' ? '↓ The rest of the icon packs' : '↓ All icon packs'}
        </button>
      )
    }
  }
  return (
    <div className={packs === null ? 'image-studio__footer-actions is-centered' : 'image-studio__footer-actions'}>
      {packs}
      {google}
      {asking && status !== null && <PacksConfirm status={status} onClose={() => setAsking(false)} />}
    </div>
  )
}
