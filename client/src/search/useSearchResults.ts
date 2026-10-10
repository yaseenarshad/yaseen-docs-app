/**
 * The search bar's results (YAZ-803): one index snapshot per vault of the window (YAZ-2602 R2),
 * each kept current by its own watcher, ranked per keystroke by `searchTitles` — ONE scan of ONE
 * list, however many vaults. No debounce — the ranking scan is synchronous over title-scale data
 * (guarded by `searchCandidates.perf.test.ts`). Since YAZ-1491 the list also carries the tree's
 * FOLDERS (🔒 D1): `dirs` is the Sidebar's own `allDirs` memo — no second feed, no extra read —
 * spliced in FIRST so a folder ranks above a note it ties with (tree order: dirs before files).
 * Since YAZ-2620 it carries the tree's files that are no notes as well (🔒 D3): `files` is the
 * Sidebar's `otherFiles` memo, spliced in LAST. Vault by vault, in the order of the window's
 * vaults. A query that holds an id gets its ID matches first, then the title matches (`searchRows`,
 * YAZ-2677 🔒 D9; 🔒 D32); a folder's title
 * (YAZ-2420 🔒 D14) and id are on the snapshot's `folders`. The rows come back RANKED; the sidebar
 * draws them as a tree (`searchTree`). The matches that are a pinned item or are inside one lead the
 * ranking (YAZ-2662 D4): `pinned` is the paths of the pinned items.
 *
 * The feed is LAZY (F1 finding 1, YAZ-808). The ALWAYS-ON per-window index feed is
 * WikilinkIndexBridge's; search must not duplicate it in every window for a bar nobody typed
 * into, so it pays for its data only once someone searches.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { api } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../lib/leadingTrailing'
import { atOrBelow } from '../lib/treeState'
import { fileCandidates, folderCandidates, searchCandidates, searchRows, type SearchCandidate } from './searchCandidates'

/** One vault the search covers: its folder, its watcher, and its folders and its files that are no notes (the Sidebar's own `allDirs` and `otherFiles`). */
export interface SearchVault {
  root: string
  watch: WatchSource
  dirs: readonly string[]
  files: readonly string[]
}

type Snapshot = Readonly<{ records: readonly IndexRecord[]; folders: readonly IndexRecord[]; letters?: readonly string[] }>
const NO_SNAPSHOT: Snapshot = { records: [], folders: [] }

/** One vault's rows as they were last built, with what each part was built from. */
type Rows = Snapshot & { dirs: readonly string[]; files: readonly string[]; folderRows: SearchCandidate[]; noteRows: SearchCandidate[]; fileRows: SearchCandidate[]; all: SearchCandidate[] }

export function useSearchResults(vaults: readonly SearchVault[], query: string, pinned: ReadonlySet<string>): SearchCandidate[] {
  // Each vault's index snapshot, by its root, once it has landed.
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, Snapshot>>(() => new Map())
  // Latched by the first non-empty query and never unlatched: after that the snapshots stay warm
  // and watch-fresh for the rest of this component's life, so clearing the bar and typing again
  // costs nothing. Until then there is no fetch and no subscription at all.
  const [activated, setActivated] = useState(false)
  useEffect(() => {
    if (query.trim() !== '') setActivated(true)
  }, [query])

  // PER VAULT, for as long as the vault is in the window: its index read and its watcher refresh.
  // `vaults` is a new list whenever a tree changed its `dirs`, so a feed is kept while its vault
  // and watcher stand: a vault that stays is not read again when another joins, leaves or changes.
  const feeds = useRef(new Map<string, { watch: WatchSource; end: () => void }>())
  useEffect(() => {
    if (!activated) return
    const held = feeds.current
    for (const [root, feed] of held) {
      const now = vaults.find((vault) => vault.root === root)
      if (now?.watch === feed.watch) continue
      feed.end()
      held.delete(root)
      if (now === undefined) setSnapshots((prev) => new Map([...prev].filter(([key]) => key !== root)))
    }
    for (const { root, watch } of vaults) {
      if (held.has(root)) continue
      /** Bumped per read and on teardown: only the newest read's answer is ever applied (YAZ-2191). */
      let generation = 0
      const load = () => {
        const mine = ++generation
        // An unreadable index leaves search with no NOTE rows — quietly (the folders and the other
        // files come from the tree, S35 on YAZ-2620). Search is an accelerator, not a view: a banner
        // here would shout about something the tree below is already showing fine.
        api.index(root).then(
          (res) => {
            if (mine === generation) setSnapshots((prev) => new Map(prev).set(root, { records: res.records, folders: res.folders, letters: res.letters }))
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
      held.set(root, {
        watch,
        end: () => {
          generation++
          off()
          burst.cancel()
        },
      })
    }
  }, [vaults, activated])
  useEffect(
    () => () => {
      for (const feed of feeds.current.values()) feed.end()
      feeds.current.clear()
    },
    [],
  )

  // One list over every vault. Each vault's folder rows, note rows and other-file rows are rebuilt
  // only when what they were built from changed — its `dirs` or folder records, its records, its
  // `files` — so a snapshot or a tree of one vault rebuilds no row of another. One vault → its own
  // list: folders, notes, other files (a tie in a rank reads in that order, YAZ-2620 S19).
  const built = useRef(new Map<string, Rows>())
  const candidates = useMemo(() => {
    const next = new Map<string, Rows>()
    for (const { root, dirs, files } of vaults) {
      // `letters` arrive with the snapshot they belong to (YAZ-2677 D9, S77), so the rows built from it carry them.
      const { records, folders, letters } = snapshots.get(root) ?? NO_SNAPSHOT
      const last = built.current.get(root)
      const folderRows = last !== undefined && last.dirs === dirs && last.folders === folders ? last.folderRows : folderCandidates(root, dirs, folders, letters)
      const noteRows = last !== undefined && last.records === records ? last.noteRows : searchCandidates(records, letters)
      const fileRows = last !== undefined && last.files === files ? last.fileRows : fileCandidates(root, files)
      const same = last !== undefined && last.folderRows === folderRows && last.noteRows === noteRows && last.fileRows === fileRows
      next.set(root, { dirs, files, records, folders, folderRows, noteRows, fileRows, all: same ? last.all : [...folderRows, ...noteRows, ...fileRows] })
    }
    built.current = next
    const lists = [...next.values()].map((rows) => rows.all)
    return lists.length === 1 ? lists[0] : lists.flat()
  }, [vaults, snapshots])
  // The rows that rank first (YAZ-2662 D4): the path of each row that is a pinned item or is inside
  // one. Built when the rows or a list changes, so a keystroke pays one look in it for each match (R1).
  const first = useMemo(() => (pinned.size === 0 ? pinned : new Set(candidates.flatMap((c) => (atOrBelow(pinned, c.path) ? [c.path] : [])))), [candidates, pinned])
  // An empty query matches EVERYTHING through the shared matcher (`indexOf('')` is 0), so the
  // no-query case is answered here rather than by the ranker.
  return useMemo(() => (query.trim() === '' ? [] : searchRows(candidates, query, first)), [candidates, query, first])
}
