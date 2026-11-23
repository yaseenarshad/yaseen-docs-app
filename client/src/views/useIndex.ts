import { useCallback, useEffect, useRef, useState } from 'react'
import { fileKind } from '@shared/fileKind'
import { IDS_FILE } from '@shared/pageId'
import type { IndexRecord, IndexResponse, WatchEvent } from '@shared/types'
import { api } from '../api'
import { consumeRetitleHint, fetchIndex, onFileRenamed, onIndex } from '../lib/indexFeed'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../lib/leadingTrailing'
import { basename, stripExt } from '../lib/paths'
import type { WatchSource } from '../hooks/useWatch'

export type IndexStatus = 'pending' | 'ready' | 'error'

export interface IndexState {
  status: IndexStatus
  /** `[]` until the first fetch resolves (and after a failed one). */
  records: IndexRecord[]
  /** The same snapshot's folder settings records (YAZ-2290 D8); `[]` whenever `records` is. */
  folders: IndexRecord[]
  /** Does this vault give its pages IDs (YAZ-2523 🔒 V5)? false until the first fetch resolves. */
  ids: boolean
  /** The vault's ID letters (`IndexResponse.letters`, YAZ-2677 R5): the same array until they change; none where the vault does not use IDs. */
  letters: readonly string[]
  /** What a yes would write, while the vault's answer is not yes (`IndexResponse.ask`). */
  ask: IndexResponse['ask']
  /** A run of "Give old IDs numbers" stopped with files left (`IndexResponse.unfinished`). */
  unfinished: boolean
  /** Each board with an ID of this vault (`IndexResponse.boards`, YAZ-3943 4C): the same array until it changes. */
  boards: readonly IndexBoard[]
  /** Fetch failure message; null unless `status` is 'error'. */
  error: string | null
  /** Refetch immediately, skipping the debounce. */
  refresh: () => void
}

const NO_LETTERS: readonly string[] = []

/** A board with an ID (YAZ-3943 4C). */
export type IndexBoard = NonNullable<IndexResponse['boards']>[number]
const NO_BOARDS: readonly IndexBoard[] = []

/**
 * The first event after a quiet spell re-reads the index almost at once, `LEADING_MS` (YAZ-3746 13AK: a cell's Delete, a duplicate, a rename
 * waited this long for the index's echo); more events within this window cost ONE more read at its end, and so on
 * while they keep coming, so a burst (a paste of files) costs a read every 300 ms at most.
 */
const REFETCH_DEBOUNCE_MS = 300
/** The first read's short wait: a move's unlink and add come in one burst, so the read sees both, never the gap. */
const LEADING_MS = 30

/** Could this watch event change what the index holds? Markdown pages are the only records. */
function touchesIndex(ev: WatchEvent): boolean {
  switch (ev.type) {
    case 'ready': // late join / (re)connect: refetch what may have been missed
    case 'unlinkDir': // a removed directory may have held pages
      return true
    case 'add':
    case 'change':
    case 'unlink':
      return fileKind(ev.path) === 'markdown'
    default:
      return false
  }
}

/**
 * The vault index behind every view (GRO-2129): one `api.index(root)` fetch per root
 * over the bridge, kept fresh by the shared watch fan-out. Refetches keep the previous
 * records on screen (`status` stays 'ready') until the new snapshot lands. A change to the
 * vault's `ids.json` refetches at once: the same pages are handed out as the other kind of vault.
 */
export function useIndex(root: string, watch: WatchSource): IndexState {
  const [status, setStatus] = useState<IndexStatus>('pending')
  const [records, setRecords] = useState<IndexRecord[]>([])
  const [folders, setFolders] = useState<IndexRecord[]>([])
  const [ids, setIds] = useState(false)
  const [letters, setLetters] = useState(NO_LETTERS)
  const [ask, setAsk] = useState<IndexResponse['ask']>()
  const [unfinished, setUnfinished] = useState(false)
  const [boards, setBoards] = useState(NO_BOARDS)
  const [error, setError] = useState<string | null>(null)
  // Bumped on every fetch and on unmount/root change: only the latest fetch may commit.
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Did an event come in since the last read of this window (13AK)? Read when the window ends. */
  const more = useRef(false)

  const applySnapshot = useCallback((res: IndexResponse) => {
    setRecords(res.records)
    setFolders(res.folders)
    setIds(res.ids)
    // Kept by identity while they read the same: the link resolver is rebuilt when they change, never on each fetch.
    const next = res.letters ?? NO_LETTERS
    setLetters((prev) => (prev.length === next.length && prev.every((held, i) => held === next[i]) ? prev : next))
    setAsk(res.ask)
    setUnfinished(res.unfinished === true)
    const held = res.boards ?? NO_BOARDS
    setBoards((prev) => (prev.length === held.length && prev.every((b, i) => b.path === held[i]!.path && b.id === held[i]!.id) ? prev : held))
    setStatus('ready')
    setError(null)
  }, [])

  const runRefresh = useCallback(
    (fresh: boolean) => {
      const gen = ++generation.current
      fetchIndex(root, fresh).then(
        (res) => {
          if (gen !== generation.current) return
          applySnapshot(res)
        },
        (err: unknown) => {
          if (gen !== generation.current) return
          setStatus('error')
          setError(err instanceof Error ? err.message : String(err))
        },
      )
    },
    [root, applySnapshot],
  )
  const refresh = useCallback(() => runRefresh(false), [runRefresh])

  useEffect(() => {
    setStatus('pending')
    setRecords([])
    setFolders([])
    setIds(false)
    setLetters(NO_LETTERS)
    setAsk(undefined)
    setUnfinished(false)
    setBoards(NO_BOARDS)
    setError(null)
    // Keep the shared feed alive for this root so search and other consumers share snapshots without duplicate IPCs (YAZ-6027).
    const offFeed = onIndex(root, () => undefined)
    refresh()
    // Leading and trailing (13AK): a read now, then one at the end of each window that had events.
    const settle = (): void => {
      timer.current = setTimeout(() => {
        if (!more.current) {
          timer.current = null
          return
        }
        more.current = false
        refresh()
        settle()
      }, REFETCH_DEBOUNCE_MS)
    }
    const unsubscribe = watch.subscribe((ev) => {
      if (!touchesIndex(ev)) return
      if (timer.current !== null) {
        more.current = true
        return
      }
      timer.current = setTimeout(() => {
        // what came in during the short wait, this read sees
        more.current = false
        refresh()
        settle()
      }, LEADING_MS)
    })
    const unsubscribeIds = api.vaultConfig.onChange((c) => {
      if (c.root === root && c.name === IDS_FILE) refresh()
    })
    // "Change letters" and "Give old IDs numbers" renamed many pages: read now, not when the events settle (YAZ-3102).
    // So does a board that took an ID, or one with an ID that came, went or moved (YAZ-3943 4C).
    const unsubscribeChange = api.ids.onChanged((c) => {
      if (c.root === root) refresh()
    })
    // In-app renames/retitles already updated main's live index (`indexMoved`) before broadcasting `file:renamed`.
    // Refresh on the leading edge so sidebar/tab titles match the new path immediately instead of flashing the raw
    // filename slug behind the watcher settle + 300 ms debounce; coalesce bulk renames via leadingTrailing (YAZ-6008).
    const trimmedRoot = root.replace(/[\\/]+$/, '')
    const insideRoot = (p: string): boolean => p === trimmedRoot || p.startsWith(`${trimmedRoot}/`) || p.startsWith(`${trimmedRoot}\\`)
    const renameBurst = leadingTrailing(() => runRefresh(true), WATCH_BURST_QUIET_MS)
    /** A record's `folder` as the index writes it: the vault-relative folder, `/`-separated, '' at the root. */
    const folderOf = (p: string): string => {
      const dir = p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')))
      return dir.length <= trimmedRoot.length ? '' : dir.slice(trimmedRoot.length + 1).split('\\').join('/')
    }
    const unsubscribeRename = onFileRenamed(({ oldPath, newPath, kind }) => {
      if (!insideRoot(oldPath) && !insideRoot(newPath)) return
      // Every rename event makes any read already on the wire stale: main's `getIndex` may have built its records
      // before this rename landed, and applying it would put the old path back (new → old → new). Only the
      // burst's trailing read, which post-dates every event, may commit (YAZ-6056 checker round 1).
      generation.current++
      const hintedTitle = consumeRetitleHint(oldPath)
      // Optimistic remap ONLY for a title edit (`fs:retitle` left a hint): one record, the case that flashed the
      // raw file name. Plain renames, pastes and "Change letters" wait for the read: no array per event.
      if (hintedTitle !== undefined) {
        const oldPrefix = `${oldPath.replace(/[\\/]+$/, '')}/`
        const remapList = (prev: IndexRecord[], isFolders: boolean): IndexRecord[] => {
          let changed = false
          const next = prev.map((r) => {
            if (kind !== 'dir') {
              if (r.path !== oldPath) return r
              changed = true
              const name = basename(newPath)
              return { ...r, path: newPath, name, basename: stripExt(name), folder: folderOf(newPath), title: hintedTitle }
            }
            if (r.path !== oldPath && !r.path.startsWith(oldPrefix)) return r
            changed = true
            const movedPath = newPath + r.path.slice(oldPath.length)
            const isDirectFolderMeta = isFolders && movedPath.slice(newPath.length + 1).indexOf('/') === -1
            return { ...r, path: movedPath, folder: folderOf(movedPath), ...(isDirectFolderMeta ? { title: hintedTitle } : {}) }
          })
          return changed ? next : prev
        }
        setRecords((prev) => remapList(prev, false))
        if (kind === 'dir') setFolders((prev) => remapList(prev, true))
      }
      renameBurst.call()
    })
    return () => {
      generation.current++
      offFeed()
      unsubscribe()
      unsubscribeIds()
      unsubscribeChange()
      unsubscribeRename()
      renameBurst.cancel()
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      more.current = false
    }
  }, [root, watch, refresh, runRefresh])

  return { status, records, folders, ids, letters, ask, unfinished, boards, error, refresh }
}
