/**
 * SETTINGS › IMAGES › ICON PACKS (YAZ-4359; round 2 decision 8, the D5 update, extra 24). The row that the Add panel's
 * "Download all icon packs" line has a twin of: what is on this Mac, the download with the same confirm box
 * (`PacksConfirm`) and the same progress, "Check for new icons" (only the packs that changed; GitHub's limit is said
 * in the status line), "Remove…" after a confirm, and where the packs live: "Choose a folder…" — ONE folder for every
 * vault and window of this Mac (`SettingsState.iconPacksFolder`, this Mac only); main moves the packs there.
 *
 * The status is main's (`useIconPacks`): Settings and the Add panel in two windows show the same run.
 */
import { useState } from 'react'
import { formatPackBytes, packsBusy, packsProgressText, type IconPacksStatus } from '@shared/iconPacks'
import type { SettingsState } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { usePickFolder } from '../hooks/usePickFolder'
import { PacksConfirm } from '../image-studio/IconPacksLine'
import { packsDo, useIconPacks } from '../image-studio/useIconPacks'

/** The row's status sentence. */
export function packsStatusText(status: IconPacksStatus | null): string {
  if (status === null) return '…'
  if (packsBusy(status)) return packsProgressText(status)
  if (status.state === 'complete') return `All ${status.packs} packs are on this Mac: ${formatPackBytes(status.bytes)}, version ${status.version}. Icon search, tiles and adds work offline.`
  if (status.state === 'partial') return `${status.packs} of ${status.total} packs are on this Mac (${formatPackBytes(status.bytes)}).`
  return 'Not on this Mac. Icons stream from Iconify as you search.'
}

export function IconPacksControl({ settings, onChange }: { settings: SettingsState; onChange: (next: SettingsState) => void }) {
  const status = useIconPacks()
  const [asking, setAsking] = useState<'download' | 'remove' | null>(null)
  const { pick, picking } = usePickFolder({ onPicked: (path) => onChange({ ...settings, iconPacksFolder: path }) })
  const busy = status !== null && packsBusy(status)
  const some = status !== null && (status.state === 'partial' || status.state === 'complete')
  const running = status?.state === 'downloading' || status?.state === 'checking'
  return (
    <>
      <p className="settings__key-status" data-testid="icon-packs-status">
        {packsStatusText(status)}
      </p>
      {status?.message != null && !busy && (
        <p className={status.failed ? 'settings__error' : 'settings__key-status'} role={status.failed ? 'alert' : 'status'} data-testid="icon-packs-message">
          {status.message}
        </p>
      )}
      <p className="settings__path" data-testid="icon-packs-folder">
        {status === null ? '…' : status.folder}
        {status !== null && settings.iconPacksFolder === null ? ' (default)' : ''}
      </p>
      <div className="settings__options" role="group" aria-label="Icon packs">
        {running ? (
          <button type="button" className="settings__option" onClick={() => void packsDo('stop')}>
            Stop
          </button>
        ) : status?.state === 'partial' ? (
          <button type="button" className="settings__option" disabled={busy} onClick={() => void packsDo('download')}>
            Download the rest
          </button>
        ) : status?.state !== 'complete' ? (
          <button type="button" className="settings__option" disabled={status === null || busy} onClick={() => setAsking('download')}>
            Download all icon packs
          </button>
        ) : null}
        {some && (
          <button type="button" className="settings__option" disabled={busy} onClick={() => void packsDo('check')}>
            Check for new icons
          </button>
        )}
        {some && (
          <button type="button" className="settings__option" disabled={busy} onClick={() => setAsking('remove')}>
            Remove…
          </button>
        )}
        <button type="button" className="settings__option" onClick={pick} disabled={picking || busy} aria-label="Choose a folder for the icon packs">
          Choose a folder…
        </button>
        <button type="button" className="settings__option" onClick={() => onChange({ ...settings, iconPacksFolder: null })} disabled={settings.iconPacksFolder === null || busy}>
          Reset to default
        </button>
      </div>
      {asking === 'download' && status !== null && <PacksConfirm status={status} onClose={() => setAsking(null)} />}
      {asking === 'remove' && status !== null && (
        <ConfirmSheet
          labelId="confirm-icon-packs-remove-text"
          text={
            <>
              <span className="confirm__title">Remove the icon packs?</span>
              They take {formatPackBytes(status.bytes)} on this Mac. Icons then stream from Iconify again, and you can download the packs again later.
            </>
          }
          confirmLabel="Remove"
          danger
          keys="contained"
          onConfirm={() => {
            setAsking(null)
            void packsDo('remove')
          }}
          onCancel={() => setAsking(null)}
        />
      )}
    </>
  )
}
