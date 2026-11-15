import type { ShellSyncEvent, ShellSyncState } from '../app/syncPort'

/**
 * YAZ-5469: the words of the quiet toast after a tap on the dot, from the pass that the tap ran. Its own chunk: the
 * first load keeps only the toast. The automatic 15 s pass says nothing.
 *  - "Synced · 3 pages updated" (the files that came in: added, changed, removed, renamed);
 *  - "Synced · up to date";
 *  - "No signal · will sync later", or the problem in a few words.
 */
export function passWords(state: ShellSyncState, events: readonly ShellSyncEvent[], online: boolean): string {
  if (!online || (state.status === 'off' && (state.problem === 'OFFLINE' || state.problem === null))) return 'No signal · will sync later'
  if (state.status === 'off') return state.problem === 'GITHUB_DOWN' ? 'GitHub is down · will sync later' : 'Sync failed · will try again'
  if (state.status === 'slowed') return 'GitHub asked to wait · will sync later'
  if (state.status === 'attention') return `Not synced · ${PROBLEM[state.problem ?? ''] ?? 'sign in again'}`
  if (state.status === 'idle') return 'No vault open'
  if (state.status === 'syncing') return 'Still syncing…'
  const paths = new Set<string>()
  for (const e of events) {
    if (e.type !== 'changed' || e.vault !== state.vault || !e.diff) continue
    for (const p of [...e.diff.added, ...e.diff.changed, ...e.diff.removed]) paths.add(p)
    for (const r of e.diff.renamed) paths.add(r.to)
  }
  if (paths.size === 0) return 'Synced · up to date'
  const pages = [...paths].filter((p) => p.toLowerCase().endsWith('.md')).length
  const [n, one] = pages > 0 ? [pages, 'page'] : [paths.size, 'file']
  return `Synced · ${n} ${one}${n === 1 ? '' : 's'} updated`
}

/** The red problems (`dot.ts`), in a few words. */
const PROBLEM: Record<string, string> = {
  UNAUTHORIZED: 'sign in again',
  NO_TOKEN: 'sign in again',
  READ_ONLY: 'sign in again',
  NOT_FOUND: 'vault not found',
  NO_ACCESS: 'vault not found',
  TREE_TRUNCATED: 'vault too large',
  STORAGE_FULL: 'phone is full',
}
