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
import { placeOnly } from '../vault/placeScope'
import { fileCandidates, folderCandidates, searchCandidates, searchRows, type SearchCandidate } from './searchCandidates'
import type { IdsInSearch } from './showIds'

/** One vault the search covers: its folder, its watcher, and its folders and its files that are no notes (the Sidebar's own `allDirs` and `otherFiles`). */
export interface SearchVault {
  root: string
  watch: WatchSource
  dirs: readonly string[]
  files: readonly string[]
  /** This vault's "Show IDs in search" (YAZ-4940), read at each draw of a result list; absent → Always. */
  idsInSearch?: () => IdsInSearch
  /** This vault's "Show IDs in the title" (YAZ-4940), read where the explore stack's note head draws; absent → On. */
  idsInTitle?: () => boolean
  /** "A folder of" the vault (YAZ-4922 🔒 D3): the vault's index is read, and only the notes under this folder are found (`placeOnly`). */
  folder?: string
  /** The vault's Review is on (YAZ-5037): its cards are rows, each a Card (`searchCandidates`). Absent: none is. */
  cards?: boolean
}

type Snapshot = Readonly<{ records: readonly IndexRecord[]; folders: readonly IndexRecord[]; letters?: readonly string[] }>
const NO_SNAPSHOT: Snapshot = { records: [], folders: [] }

/** A snapshot cut to a folder of its vault (YAZ-4922 D3), once per snapshot and folder: the rows built from it are kept while both stay. */
const cuts = new WeakMap<Snapshot, { folder: string; cut: Snapshot }>()
function scoped(snapshot: Snapshot, folder: string | undefined): Snapshot {
  if (folder === undefined) return snapshot
  const held = cuts.get(snapshot)
  if (held !== undefined && held.folder === folder) return held.cut
  const cut = { ...snapshot, records: placeOnly(folder, snapshot.records), folders: placeOnly(folder, snapshot.folders) }
  cuts.set(snapshot, { folder, cut })
  return cut
}

/** One vault's rows as they were last built, with what each part was built from. */
type Rows = Snapshot & { dirs: readonly string[]; files: readonly string[]; cards: boolean; folderRows: SearchCandidate[]; noteRows: SearchCandidate[]; fileRows: SearchCandidate[]; extra?: (records: readonly IndexRecord[]) => SearchCandidate[]; extraRows: SearchCandidate[]; all: SearchCandidate[] }
const NO_ROWS: SearchCandidate[] = []

/**
 * The rows the search ranks, over every vault (split out of `useSearchResults`, which ranks them, by YAZ-2571 for the
 * explore stack): each vault's feed and its rows, rebuilt only for what changed. `activated` latches the feeds on:
 * false until the first search, then true for the component's life. `extra` (the explore search's text rows) adds a
 * vault's rows AFTER its other-file rows, built from its records as the note rows are; the caller keeps the function
 * while it stands.
 */
export function useSearchCandidates(vaults: readonly SearchVault[], activated: boolean, extra?: (records: readonly IndexRecord[]) => SearchCandidate[]): SearchCandidate[] {
  // Each vault's index snapshot, by its root, once it has landed.
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, Snapshot>>(() => new Map())
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
  return useMemo(() => {
    const next = new Map<string, Rows>()
    for (const { root, dirs, files, folder, cards = false } of vaults) {
      // `letters` arrive with the snapshot they belong to (YAZ-2677 D9, S77), so the rows built from it carry them.
      const { records, folders, letters } = scoped(snapshots.get(root) ?? NO_SNAPSHOT, folder)
      const last = built.current.get(root)
      const folderRows = last !== undefined && last.dirs === dirs && last.folders === folders ? last.folderRows : folderCandidates(root, dirs, folders, letters)
      const noteRows = last !== undefined && last.records === records && last.cards === cards ? last.noteRows : searchCandidates(records, letters, cards)
      const fileRows = last !== undefined && last.files === files ? last.fileRows : fileCandidates(root, files)
      // The extra rows (YAZ-2571) follow the records, as the note rows do, and the function: a new one builds anew.
      const extraRows = extra === undefined ? NO_ROWS : last !== undefined && last.records === records && last.extra === extra ? last.extraRows : extra(records)
      const same = last !== undefined && last.folderRows === folderRows && last.noteRows === noteRows && last.fileRows === fileRows && last.extraRows === extraRows
      next.set(root, { dirs, files, cards, records, folders, folderRows, noteRows, fileRows, extra, extraRows, all: same ? last.all : [...folderRows, ...noteRows, ...fileRows, ...extraRows] })
    }
    built.current = next
    const lists = [...next.values()].map((rows) => rows.all)
    return lists.length === 1 ? lists[0] : lists.flat()
  }, [vaults, snapshots, extra])
}

/** `keep` is the Search tab's filters (YAZ-3511 D16): the rows it fails never reach the ranking, so the cap cuts only rows that pass. The caller keeps it while the filters stay. */
export function useSearchResults(vaults: readonly SearchVault[], query: string, pinned: ReadonlySet<string>, keep?: (row: SearchCandidate) => boolean): SearchCandidate[] {
  // Latched by the first non-empty query and never unlatched: after that the snapshots stay warm
  // and watch-fresh for the rest of this component's life, so clearing the bar and typing again
  // costs nothing. Until then there is no fetch and no subscription at all.
  const [activated, setActivated] = useState(false)
  useEffect(() => {
    if (query.trim() !== '') setActivated(true)
  }, [query])
  const candidates = useSearchCandidates(vaults, activated)
  // The rows that rank first (YAZ-2662 D4): the path of each row that is a pinned item or is inside
  // one. Built when the rows or a list changes, so a keystroke pays one look in it for each match (R1).
  const first = useMemo(() => (pinned.size === 0 ? pinned : new Set(candidates.flatMap((c) => (atOrBelow(pinned, c.path) ? [c.path] : [])))), [candidates, pinned])
  // The rows the filters keep, built when the rows or the filters change, not on each keystroke (D16).
  const kept = useMemo(() => (keep === undefined ? candidates : candidates.filter(keep)), [candidates, keep])
  // An empty query matches EVERYTHING through the shared matcher (`indexOf('')` is 0), so the
  // no-query case is answered here rather than by the ranker.
  return useMemo(() => (query.trim() === '' ? [] : searchRows(kept, query, first)), [kept, query, first])
}
