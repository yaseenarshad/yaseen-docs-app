/**
 * The search bar's results (YAZ-803): one index snapshot per root, kept current by the watcher,
 * ranked per keystroke by `searchTitles`. No debounce — the ranking scan is synchronous over
 * title-scale data (guarded by `searchCandidates.perf.test.ts`). Since YAZ-1491 the list also
 * carries the tree's FOLDERS (🔒 D1): `dirs` is the Sidebar's own `allDirs` memo, named by the
 * Sidebar's own `titles` (YAZ-2420 🔒 D14) — no second feed, no extra read — spliced in FIRST so a
 * folder sits above a note it ties with (tree order: dirs before files). A query that holds an id
 * is answered by it alone (`searchRows`, 🔒 D32); a folder's id is on the snapshot's `folders`.
 *
 * The feed is LAZY (F1 finding 1, YAZ-808). The ALWAYS-ON per-window index feed is
 * WikilinkIndexBridge's; search must not duplicate it in every window for a bar nobody typed
 * into, so it pays for its data only once someone searches.
 */
import { useEffect, useMemo, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { api } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../lib/leadingTrailing'
import type { PathTitles } from '../lib/pageLabel'
import { folderCandidates, searchCandidates, searchRows, type SearchCandidate } from './searchCandidates'

export function useSearchResults(root: string, watch: WatchSource, query: string, dirs: readonly string[], titles: PathTitles): SearchCandidate[] {
  const [records, setRecords] = useState<readonly IndexRecord[]>([])
  const [folders, setFolders] = useState<readonly IndexRecord[]>([])
  // Latched by the first non-empty query and never unlatched: after that the snapshot stays warm
  // and watch-fresh for the rest of this component's life, so clearing the bar and typing again
  // costs nothing. Until then there is no fetch and no subscription at all.
  const [activated, setActivated] = useState(false)
  useEffect(() => {
    if (query.trim() !== '') setActivated(true)
  }, [query])

  useEffect(() => {
    if (!activated) return
    /** Bumped per read and on teardown: only the newest read's answer is ever applied (YAZ-2191). */
    let generation = 0
    const load = () => {
      const mine = ++generation
      // An unreadable index leaves search with no rows — quietly. Search is an accelerator, not a
      // view: a banner here would shout about something the tree below is already showing fine.
      api.index(root).then(
        (res) => {
          if (mine !== generation) return
          setRecords(res.records)
          setFolders(res.folders)
        },
        () => undefined,
      )
    }
    load()
    // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering
    // missed events, and reads at once. A lone event reads at once too; a burst is that read plus
    // ONE more, 100 ms after its last event (YAZ-2191, YAZ-2240): it used to be one whole-index
    // fetch per event.
    const burst = leadingTrailing(load, WATCH_BURST_QUIET_MS)
    const off = watch.subscribe((ev) => {
      if (ev.type === 'change' || ev.type === 'error') return
      if (ev.type === 'ready') return burst.flush()
      burst.call()
    })
    return () => {
      generation++
      off()
      burst.cancel()
    }
  }, [root, watch, activated])

  const folderRows = useMemo(() => folderCandidates(root, dirs, titles, folders), [root, dirs, titles, folders])
  const noteRows = useMemo(() => searchCandidates(records), [records])
  const candidates = useMemo(() => [...folderRows, ...noteRows], [folderRows, noteRows])
  // An empty query matches EVERYTHING through the shared matcher (`indexOf('')` is 0), so the
  // no-query case is answered here rather than by the ranker.
  return useMemo(() => (query.trim() === '' ? [] : searchRows(candidates, query)), [candidates, query])
}
