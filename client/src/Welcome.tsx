import { useState } from 'react'
import { MAX_RECENT_ROOTS, type RecentRoots, type VaultSet } from '@shared/types'
import { relativeTime } from './lib/relativeTime'
import { storage } from './lib/storage'
import { GROUP_SETS_TEXT, SETS_MISSING_TEXT } from './sidebar/VaultSwitcher'

/**
 * The Welcome screen (C2, GRO-2164): shown only when this window has no folder (D3) — the app
 * name, the recent folders as one-click rows, and the Open folder… button. No dialog opens by
 * itself. The rows are snapshotted at mount, so a row whose folder turned out to be gone stays
 * visible with its "Folder not found" note after App drops the MRU entry.
 *
 * The saved workspaces (YAZ-3886) stand first, under "Workspaces", as in the ⌘O panel (YAZ-2602 S64):
 * every one, last used first, then a line and "Folders" above the recent folders. With none saved the
 * page has no label and no line. A workspace row opens through main's `openSet` door; with no folder
 * left it greys with "Folders not found", the panel's words. Its rows are snapshotted at mount too: a row
 * does not move when main makes its workspace the last used.
 */

/** The row's "2 hours ago" is `lib/relativeTime` (shared with the comment stream since YAZ-1472); the old name stays for its test. */
export { relativeTime as relativeLastOpened }

interface WelcomeProps {
  /** MRU order, straight from `AppState.recents`. */
  recents: RecentRoots
  /** The saved workspaces, last used first, as `AppState.vaultSets` holds them at mount (MAX_VAULT_SETS at most). */
  sets: VaultSet[]
  /** Resolves false when the folder is gone on disk (App drops the MRU entry; the row shows the note). */
  onOpenRecent: (path: string) => Promise<boolean>
  /** Resolves false when none of the workspace's folders is left (the row shows the note). */
  onOpenSet: (id: string) => Promise<boolean>
  onPickFolder: () => void
  /** True while the native folder dialog is open; the button is disabled meanwhile. */
  picking: boolean
}

export function Welcome({ recents, sets, onOpenRecent, onOpenSet, onPickFolder, picking }: WelcomeProps) {
  const [rows] = useState(() => recents.slice(0, MAX_RECENT_ROOTS))
  const [setRows] = useState(() => sets)
  /** The rows whose door answered false: a folder's path, or a workspace's id. */
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const now = Date.now()

  const settle = (key: string, opening: Promise<boolean>): void =>
    void opening.then((opened) => {
      if (!opened) setMissing((prev) => new Set(prev).add(key))
    })

  return (
    <div className="welcome">
      <h1 className="welcome__title">Yaseen Docs</h1>
      {setRows.length > 0 && (
        <>
          <div className="welcome__label">{GROUP_SETS_TEXT}</div>
          <ul className="welcome__recents">
            {setRows.map((s) => (
              <li key={s.id}>
                <button type="button" className="welcome__recent" disabled={missing.has(s.id)} onClick={() => settle(s.id, onOpenSet(s.id))}>
                  <span className="welcome__recent-name">{s.name}</span>
                  <span className={`welcome__recent-when${missing.has(s.id) ? ' welcome__recent-when--missing' : ''}`}>
                    {missing.has(s.id) ? SETS_MISSING_TEXT : s.lastUsed === 0 ? '' : relativeTime(s.lastUsed, now)}
                  </span>
                  <span className="welcome__recent-path">{s.roots.map(storage.vaultName).join(' + ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="welcome__label welcome__label--rule">Folders</div>
        </>
      )}
      {rows.length === 0 ? (
        <p className="welcome__empty">No recent folders yet.</p>
      ) : (
        <ul className="welcome__recents">
          {rows.map((r) => (
            <li key={r.path}>
              <button type="button" className="welcome__recent" disabled={missing.has(r.path)} onClick={() => settle(r.path, onOpenRecent(r.path))}>
                <span className="welcome__recent-name">{storage.vaultName(r.path)}</span>
                <span className={`welcome__recent-when${missing.has(r.path) ? ' welcome__recent-when--missing' : ''}`}>
                  {missing.has(r.path) ? 'Folder not found' : relativeTime(r.lastOpened, now)}
                </span>
                <span className="welcome__recent-path">{r.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--primary" disabled={picking} onClick={onPickFolder}>
        Open folder…
      </button>
    </div>
  )
}
