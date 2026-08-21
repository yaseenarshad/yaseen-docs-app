import { useState } from 'react'
import { MAX_RECENT_ROOTS, type RecentRoots } from '@shared/types'
import { basename } from './lib/paths'

/**
 * The Welcome screen (C2, GRO-2164): shown only when this window has no folder (D3) — the app
 * name, the recent folders as one-click rows, and the Open folder… button. No dialog opens by
 * itself. The rows are snapshotted at mount, so a row whose folder turned out to be gone stays
 * visible with its "Folder not found" note after App drops the MRU entry.
 */

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/** "just now" under a minute, then the largest whole unit ("2 hours ago", "yesterday", "last week"). */
export function relativeLastOpened(lastOpened: number, now: number): string {
  const diff = now - lastOpened
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) return RTF.format(-Math.floor(diff / ms), unit)
  }
  return 'just now'
}

interface WelcomeProps {
  /** MRU order, straight from `AppState.recents`. */
  recents: RecentRoots
  /** Resolves false when the folder is gone on disk (App drops the MRU entry; the row shows the note). */
  onOpenRecent: (path: string) => Promise<boolean>
  onPickFolder: () => void
  /** True while the native folder dialog is open; the button is disabled meanwhile. */
  picking: boolean
}

export function Welcome({ recents, onOpenRecent, onPickFolder, picking }: WelcomeProps) {
  const [rows] = useState(() => recents.slice(0, MAX_RECENT_ROOTS))
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const now = Date.now()

  const open = (path: string): void =>
    void onOpenRecent(path).then((opened) => {
      if (!opened) setMissing((prev) => new Set(prev).add(path))
    })

  return (
    <div className="welcome">
      <h1 className="welcome__title">Yaseen Docs</h1>
      {rows.length === 0 ? (
        <p className="welcome__empty">No recent folders yet.</p>
      ) : (
        <ul className="welcome__recents">
          {rows.map((r) => (
            <li key={r.path}>
              <button type="button" className="welcome__recent" disabled={missing.has(r.path)} onClick={() => open(r.path)}>
                <span className="welcome__recent-name">{basename(r.path)}</span>
                <span className={`welcome__recent-when${missing.has(r.path) ? ' welcome__recent-when--missing' : ''}`}>
                  {missing.has(r.path) ? 'Folder not found' : relativeLastOpened(r.lastOpened, now)}
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
