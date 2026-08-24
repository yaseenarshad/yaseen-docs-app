/**
 * The search bar's results (YAZ-803): one index snapshot per root, kept current by the watcher,
 * ranked per keystroke by `searchTitles`. No debounce — the ranking scan is synchronous over
 * title-scale data (guarded by `searchCandidates.perf.test.ts`).
 */
import { useEffect, useMemo, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { api } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { searchCandidates, searchTitles, type SearchCandidate } from './searchCandidates'

export function useSearchResults(root: string, watch: WatchSource, query: string): SearchCandidate[] {
  const [records, setRecords] = useState<readonly IndexRecord[]>([])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      // An unreadable index leaves search with no rows — quietly. Search is an accelerator, not a
      // view: a banner here would shout about something the tree below is already showing fine.
      api.index(root).then(
        (res) => {
          if (!cancelled) setRecords(res.records)
        },
        () => undefined,
      )
    }
    load()
    // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering missed events.
    const off = watch.subscribe((ev) => {
      if (ev.type !== 'change' && ev.type !== 'error') load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [root, watch])

  const candidates = useMemo(() => searchCandidates(records), [records])
  // An empty query matches EVERYTHING through the shared matcher (`indexOf('')` is 0), so the
  // no-query case is answered here rather than by the ranker.
  return useMemo(() => (query.trim() === '' ? [] : searchTitles(candidates, query)), [candidates, query])
}
