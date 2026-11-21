import { useApp } from '../app/AppState'
import type { Help } from '../app/help'
import { ForwardButton, Frame, vaultName } from './Frame'

/**
 * The first download (row F2; round 10, item 8): a progress bar, then the open tab. The download goes on if it stops
 * (row F5, 3B): the files on the phone stay, and the next open goes on from there.
 */
export function FirstDownload({ help }: { help: Help | null }) {
  const app = useApp()
  const vault = app.vault!
  const progress = app.sync.progress
  const percent = progress === null || progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  return (
    <Frame title={vaultName(vault.repo)} gear>
      <h2 className="title">{app.unit('Downloading your pages')}</h2>
      <p className="lead">{vault.repo}</p>
      <div className="progress" role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="progress__bar" style={{ width: `${percent}%` }} />
      </div>
      <p className="muted">{progress === null ? 'Getting the list of files…' : `${progress.done} of ${progress.total} files`}</p>
      {help === null ? (
        <p className="muted">You can close the app. The download goes on the next time you open it.</p>
      ) : (
        <div className="problem" role="alert">
          <p>{help.message}</p>
          <ForwardButton forward={help.forward} />
        </div>
      )}
    </Frame>
  )
}
