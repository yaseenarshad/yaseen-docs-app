/**
 * The vault as this panel holds it (YAZ-2202, moved out of `Sidebar.tsx` as-is): the tree and its
 * watcher refresh, its expansion, the focus list, the Favorites list, and the checks
 * that close a tab whose file is gone.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { MAX_FOCUS, type TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import type { WatchSource } from '../../hooks/useWatch'
import type { NoticeKind } from '../../lib/notice'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../../lib/leadingTrailing'
import { storage } from '../../lib/storage'
import { fetchTree, onTree } from '../../lib/treeFeed'
import { allDirs, favoriteRoots, findNode, treeHasPath, treeReducer } from '../../lib/treeState'

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function useVaultTree(
  root: string,
  watch: WatchSource,
  activeFile: string | null,
  onRootMissing: () => void,
  onFileMissing: () => void,
  onNotice: (message: string, kind?: NoticeKind) => void,
) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, dispatch] = useReducer(treeReducer, root, storage.getExpanded)
  // The focus list (YAZ-2619 D1): the files and folders the Focus tab shows, in the order added.
  // Per WINDOW since YAZ-1628 (`sidebarCollapsed`'s rule), unlike the per-vault expansion above:
  // restored from this window's identity and written back the same way, so it survives a lens
  // switch and a restart and follows its own rename, ⌘⇧N inherits it, and another window on the
  // same vault is never affected.
  const [focusList, setFocusList] = useState<readonly string[]>(storage.getFocusList)
  // Favorites (YAZ-1766 D2, in the vault since 6A/D11): the vault's pinned files and folders in the
  // user's order, read from `.yaseendocs/favorites.json` through main (absolute paths). Another
  // window's — or another machine's, via sync — write lands here through `favorites:changed` (below).
  const [favorites, setFavorites] = useState<readonly string[]>([])
  const favoritesRef = useRef(favorites)
  favoritesRef.current = favorites

  // Every directory of the CURRENT tree, outer before inner (`allDirs`): the expand-all set
  // (⚡ YAZ-862) and, since YAZ-1491, the search list's folder rows (🔒 D1) — one memo, no second
  // feed.
  const dirs = useMemo(() => (tree === null ? [] : allDirs(tree.tree)), [tree])
  // The Focus tab's rows (YAZ-2619 D2): the list in the order ADDED, off the live tree, by the
  // Favorites rule below (`favoriteRoots`) — a vanished path yields no row, and the prune below drops it.
  const focusNodes = useMemo(() => (tree === null ? [] : favoriteRoots(tree.tree, focusList)), [tree, focusList])
  const focusDirs = useMemo(() => allDirs(focusNodes), [focusNodes])
  // The Favorites tab's rows (YAZ-1766 D4): the favorites in STORED order, off the live tree; nesting
  // and redundancy are kept (`favoriteRoots`).
  const favoriteNodes = useMemo(() => (tree === null ? [] : favoriteRoots(tree.tree, favorites)), [tree, favorites])
  const favoriteDirs = useMemo(() => allDirs(favoriteNodes), [favoriteNodes])

  // The window's one tree feed (YAZ-2191): every answer lands here, whoever asked — this panel,
  // its active-file probe, the view-only catalog. A failure is only this panel's to report when it
  // asked (`refresh`), exactly as before the feed.
  useEffect(
    () =>
      onTree(root, (outcome) => {
        if (outcome.status === 'rejected') return
        setTree(outcome.value)
        setError(null)
      }),
    [root],
  )

  const refresh = useCallback(() => {
    fetchTree(root).catch((err: unknown) => {
      if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) onRootMissing()
      else setError(err instanceof BridgeRequestError ? err.message : 'Failed to load folder')
    })
  }, [root, onRootMissing])

  useEffect(() => refresh(), [refresh])

  // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering
  // missed events, and refreshes at once. A lone event refreshes at once too; a burst (git pull,
  // Finder copy, bulk rename) is that read plus ONE more, 100 ms after its last event (YAZ-2191,
  // YAZ-2240): it used to be one full vault walk per event.
  useEffect(() => {
    const burst = leadingTrailing(refresh, WATCH_BURST_QUIET_MS)
    const off = watch.subscribe((ev) => {
      if (ev.type === 'error') return setError(ev.message)
      if (ev.type === 'change') return
      if (ev.type === 'ready') return burst.flush()
      burst.call()
    })
    return () => {
      off()
      burst.cancel()
    }
  }, [watch, refresh])

  useEffect(() => {
    // Idempotent (⚡ YAZ-874): the first render holds exactly what was
    // just read, and re-sending it would make the main process commit, write and broadcast for nothing.
    if (sameList(storage.getExpanded(root), expanded)) return
    storage.setExpanded(root, expanded)
  }, [root, expanded])

  // The focus list's write-back, idempotent like `expanded`'s above — into this window's identity
  // (YAZ-1628), not the vault bucket.
  useEffect(() => {
    if (sameList(storage.getFocusList(), focusList)) return
    storage.setFocusList(focusList)
  }, [focusList])

  // Favorites (6A/6C): read once per root, then re-read on every `favorites:changed` for this root —
  // an own write's echo, another window's, or a synced file. A stale root's answer is dropped.
  useEffect(() => {
    let cancelled = false
    const load = () =>
      void api.favorites.get(root).then((next) => {
        if (!cancelled) setFavorites((prev) => (sameList(prev, next) ? prev : next))
      })
    load()
    const off = api.favorites.onChanged((c) => {
      if (c.root === root) load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [root])
  /**
   * The ONE writer (6C): optimistic, then main writes the file; a refusal (a malformed favorites.json
   * → INVALID_CONFIG, D12) reverts the list and toasts. Main drops dead entries on the way (D14).
   */
  const saveFavorites = useCallback(
    (next: readonly string[]) => {
      const prev = favoritesRef.current
      setFavorites(next)
      api.favorites.set(root, next).catch((err: unknown) => {
        setFavorites(prev)
        onNotice(`Can't save favorites: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    },
    [root, onNotice],
  )

  // The file this mount woke up with is SHOWN, not revealed (YAZ-1642): a relaunch restores the
  // tab and leaves the tree collapsed. Any file opened after that still opens its folders.
  const restoredFile = useRef(activeFile)
  useEffect(() => {
    if (activeFile === restoredFile.current) return
    restoredFile.current = null
    if (activeFile !== null) dispatch({ type: 'expandTo', root, file: activeFile })
  }, [root, activeFile])

  // A focus item that left the vault DROPS OUT of the list (YAZ-2619 R13) — deleted or moved out,
  // a file as a folder (`findNode`). The store repairs the FILE on delete; this component holds its
  // own copy, so it prunes against the live tree itself, as `useSelection` (rowGestures.ts) does
  // for the selection.
  useEffect(() => {
    if (tree === null || focusList.length === 0) return
    const kept = focusList.filter((path) => findNode(tree.tree, path) !== null)
    if (kept.length !== focusList.length) setFocusList(kept)
  }, [tree, focusList])
  // Favorites are NOT pruned against the tree here (D14): a path missing on this machine may simply not
  // have synced yet, so it draws no row (`favoriteRoots`) and main heals dead entries on the next write.

  // Stored lastFile that no longer exists → drop it (first tree only, so a file deleted on disk
  // EXTERNALLY while it is being edited stays open and is recreated by the next save — an
  // IN-APP delete never reaches here, it closes tabs through the `file:deleted` broadcast
  // which retires the editor first (GRO-2272); do not unify the two. Files OUTSIDE the
  // root (opened via a pasted `#/abs/path.md` URL, GRO-2069) are never in the tree — skip them.
  // A tab may be a FOLDER (YAZ-2290 D3), so both checks ask `treeHasPath`: a folder still in the
  // tree survives, one that left it closes like a file.
  const validated = useRef(false)
  useEffect(() => {
    if (tree === null || validated.current) return
    validated.current = true
    if (activeFile !== null && activeFile.startsWith(`${root.replace(/\/+$/, '')}/`) && !treeHasPath(tree.tree, activeFile))
      onFileMissing()
  }, [tree, activeFile, root, onFileMissing])

  // A stale tab ACTIVATED after its file vanished on disk (I3, GRO-2235): when the activation
  // CHANGES to an in-root file the cached tree does not show, confirm against a FRESH tree —
  // the inline-create flow activates a just-created file before `refresh()` lands, so the
  // cached tree can be behind — and close it through the same onFileMissing path. A file
  // deleted EXTERNALLY while it is the active editor stays open (no activation change —
  // recreated by the next save); an IN-APP delete never routes through here, it closes tabs
  // via the `file:deleted` broadcast, which also retires the editor first (GRO-2272). Do not
  // unify the two. Background tabs are never probed (out of scope, noted in GRO-2235).
  const lastActive = useRef(activeFile)
  const treeRef = useRef(tree)
  treeRef.current = tree
  useEffect(() => {
    if (activeFile === lastActive.current) return
    lastActive.current = activeFile
    if (activeFile === null || !activeFile.startsWith(`${root.replace(/\/+$/, '')}/`)) return
    if (treeRef.current !== null && treeHasPath(treeRef.current.tree, activeFile)) return
    let cancelled = false // the activation moved on (or the sidebar unmounted): the probe's verdict is stale
    fetchTree(root).then(
      (res) => {
        if (!cancelled && !treeHasPath(res.tree, activeFile)) onFileMissing()
      },
      () => undefined, // a root-level failure is refresh()'s problem, not this probe's
    )
    return () => {
      cancelled = true
    }
  }, [activeFile, root, onFileMissing])

  /**
   * The focus toggle (YAZ-2619 D3): remove every path, or append the ones not yet in the list — the
   * order given, no duplicates, `MAX_FOCUS` at most (R2). `isOn` arrives with the paths. A folder
   * just added shows OPEN on the tab (R4; the synthetic-child idiom `startCreate` uses), and the
   * toast confirms, as the favorite toggle's does (R3).
   */
  const toggleFocus = useCallback(
    (paths: string[], isOn: boolean) => {
      const n = paths.length > 1 ? `${paths.length} ` : ''
      if (isOn) {
        setFocusList(focusList.filter((p) => !paths.includes(p)))
        return onNotice(`Removed ${n}from focus`)
      }
      const next = [...focusList, ...paths.filter((p) => !focusList.includes(p))]
      setFocusList(next.slice(0, MAX_FOCUS))
      for (const path of paths) if (dirs.includes(path)) dispatch({ type: 'expandTo', root, file: `${path}/x` })
      if (next.length > MAX_FOCUS) onNotice(`Focus limit reached: ${MAX_FOCUS} items`, 'error')
      else onNotice(`Added ${n}to focus`)
    },
    [root, dirs, focusList, onNotice],
  )
  const clearFocus = useCallback(() => setFocusList([]), [])

  /**
   * The favorite toggle (YAZ-1766 D3/D6): remove every path, or append the ones not yet pinned —
   * insertion order, no duplicates. `isOn` arrives with the paths.
   * The toast confirms with its own glyph; `saveFavorites` persists.
   */
  const toggleFavorite = useCallback(
    (paths: string[], isOn: boolean) => {
      const n = paths.length > 1 ? `${paths.length} ` : ''
      const prev = favoritesRef.current
      saveFavorites(isOn ? prev.filter((p) => !paths.includes(p)) : [...prev, ...paths.filter((p) => !prev.includes(p))])
      onNotice(isOn ? `Removed ${n}from favorites` : `Added ${n}to favorites`, 'favorite')
    },
    [onNotice, saveFavorites],
  )

  // Stable for the per-level memoised Tree (YAZ-2194).
  const expandedSet = useMemo(() => new Set(expanded), [expanded])
  const toggleDir = useCallback((dir: string) => dispatch({ type: 'toggle', dir }), [])

  return { tree, error, refresh, expanded, dispatch, expandedSet, toggleDir, focusList, focusNodes, focusDirs, toggleFocus, clearFocus, favorites, favoritesRef, saveFavorites, toggleFavorite, dirs, favoriteNodes, favoriteDirs }
}
