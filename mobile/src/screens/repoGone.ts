import { useEffect, useState } from 'react'
import type { AppModel } from '../app/AppState'

/**
 * YAZ-5645 slice 2 (edge case 5): true when the open vault's repo answers 404 (or no access) AND its GitHub account no
 * longer lists it: it was taken off the app's list on GitHub. The check (`repoStanding`) loads with the GitHub chunk,
 * only then. A pasted-token vault, or no answer from GitHub: false, and row R12's words stay.
 */
export function useRepoGone(app: AppModel): boolean {
  const key = app.vaultKey
  const repo = app.vault?.repo ?? null
  const asks = key !== null && repo !== null && app.sync.vault === key && (app.sync.problem === 'NOT_FOUND' || app.sync.problem === 'NO_ACCESS')
  const { tokens, fetch, now } = app.services
  const [gone, setGone] = useState<string | null>(null)
  useEffect(() => {
    if (!asks) return
    let live = true
    void import('../auth/githubApp')
      .then((m) => m.repoStanding(key, repo, { tokens, fetch, now }))
      .then((standing) => live && setGone(standing === 'removed' ? key : null))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [asks, key, repo, tokens, fetch, now])
  return asks && gone === key
}
