/**
 * The window's vaults as this panel holds them (YAZ-2202; one tree per vault, YAZ-2602 D3): each
 * tree and its watcher refresh, each load error, the expansion, the focus list, each vault's
 * Favorites list, and the checks that close a tab whose file is gone.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { MAX_FOCUS, rootOfPath, stripSlash, type TreeNode, type TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import type { WatchSource } from '../../hooks/useWatch'
import type { NoticeKind } from '../../lib/notice'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../../lib/leadingTrailing'
import { storage } from '../../lib/storage'
import { fetchTree, latestTree, onTree } from '../../lib/treeFeed'
import { allDirs, favoriteForest, favoriteRoots, findNode, otherFiles, treeHasPath, treeReducer } from '../../lib/treeState'
import type { SidebarVault } from '../Sidebar'

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** `list` itself while it holds what it held: App hands the panel a new array of the same vaults on each render. */
export function useSameList<T>(list: readonly T[]): readonly T[] {
  const held = useRef(list)
  if (held.current.length !== list.length || held.current.some((item, i) => item !== list[i])) held.current = list
  return held.current
}

/**
 * One landed tree's folders, outer before inner (`allDirs`), and its files that are no notes
 * (`otherFiles`): walked once per tree, so a tree of one vault walks no other vault again and the
 * lists of a vault that did not change keep their identity (YAZ-2602 R2).
 */
const walks = new WeakMap<TreeResponse, { dirs: string[]; files: string[] }>()
const NO_WALK: { dirs: string[]; files: string[] } = { dirs: [], files: [] }
function walkOf(landed: TreeResponse | undefined): { dirs: string[]; files: string[] } {
  if (landed === undefined) return NO_WALK
  let walk = walks.get(landed)
  if (walk === undefined) walks.set(landed, (walk = { dirs: allDirs(landed.tree), files: otherFiles(landed.tree) }))
  return walk
}

export function useVaultTree(
  vaults: readonly SidebarVault[],
  closedVaults: readonly string[],
  onSetVaultOpen: (root: string, open: boolean) => void,
  activeFile: string | null,
  onRootMissing: (root: string) => void,
  onFileMissing: () => void,
  onNotice: (message: string, kind?: NoticeKind) => void,
) {
  // The window's vaults (YAZ-2602 D1), in the order they were added. `root` is the FIRST: App keys
  // this panel on it.
  const roots = useSameList(vaults.map((vault) => vault.root))
  const watches = useSameList(vaults.map((vault) => vault.watch))
  const names = useSameList(vaults.map((vault) => vault.name))
  const root = roots[0]
  // What the callbacks below ask at call time, so each keeps its identity under the memoised Tree (YAZ-2194).
  const live = useRef({ roots, closedVaults, onSetVaultOpen, onRootMissing })
  live.current = { roots, closedVaults, onSetVaultOpen, onRootMissing }
  /** The vault that holds `path`, the most specific one; a path in no vault of the window gets the first. */
  const rootOf = useCallback((path: string): string => rootOfPath(live.current.roots, path) ?? live.current.roots[0], [])

  // Each vault's tree, by its root, once it has landed.
  const [trees, setTrees] = useState<ReadonlyMap<string, TreeResponse>>(() => new Map())
  // Each vault's load error, by its root: its own tree clears it, and it leaves with its vault.
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(() => new Map())
  const setFailure = useCallback((vault: string, message: string | null) => {
    setFailures((prev) => {
      if (prev.get(vault) === (message ?? undefined)) return prev
      const next = new Map(prev)
      if (message === null) next.delete(vault)
      else next.set(vault, message)
      return next
    })
  }, [])
  /** Every vault has its tree: only then can a path that no tree holds be called gone. */
  const loaded = roots.every((vault) => trees.has(vault))
  // One list here, one list PER VAULT in the store (YAZ-2602 D3): the vaults never nest (R8), so
  // each folder is its own vault's, and the write-back below splits them again.
  const [expanded, dispatch] = useReducer(treeReducer, roots, (all) => all.flatMap(storage.getExpanded))
  // The focus list (YAZ-2619 D1): the files and folders the Focus tab shows, in the order added —
  // of every vault of the window (YAZ-2602 A1). Per WINDOW since YAZ-1628 (`sidebarCollapsed`'s
  // rule), unlike the per-vault expansion above: restored from this window's identity and written
  // back the same way, so it survives a lens switch and a restart and follows its own rename, ⌘⇧N
  // inherits it, and another window on the same vault is never affected.
  const [focusList, setFocusList] = useState<readonly string[]>(storage.getFocusList)
  // Favorites (YAZ-1766 D2, in the vault since 6A/D11): each vault's pinned files and folders in the
  // user's order, read from ITS `.yaseendocs/favorites.json` through main (absolute paths) and kept
  // by its root (YAZ-2602 D5). Another window's — or another machine's, via sync — write lands here
  // through `favorites:changed` (below).
  const [favoritesByRoot, setFavoritesByRoot] = useState<Readonly<Record<string, readonly string[]>>>({})
  const favoritesRef = useRef(favoritesByRoot)
  favoritesRef.current = favoritesByRoot

  // What the Files tab draws (YAZ-2602 D3). One vault → its tree. Two or more → one
  // folder row per vault, in the order added, named as the app names the vault, its tree below it;
  // a vault whose tree has not landed has no row yet. Null until there is a tree to draw.
  const forest = useMemo<TreeNode[] | null>(() => {
    if (roots.length === 1) return trees.get(roots[0])?.tree ?? null
    const rows = roots.flatMap((vault, i): TreeNode[] => {
      const landed = trees.get(vault)
      return landed === undefined ? [] : [{ type: 'dir', name: names[i], path: stripSlash(vault), children: landed.tree }]
    })
    return rows.length === 0 ? null : rows
  }, [trees, roots, names])
  /** The vault rows' paths, each with what the app calls its vault; empty with one vault, which has no row (S11). */
  const vaultRows = useMemo<ReadonlyMap<string, string>>(() => new Map(roots.length === 1 ? [] : roots.map((vault, i) => [stripSlash(vault), names[i]])), [roots, names])
  const vaultRowsRef = useRef(vaultRows)
  vaultRowsRef.current = vaultRows
  /** The load errors to draw, in vault order; with two or more vaults each names its vault. */
  const errors = useMemo(
    () =>
      roots.flatMap((vault, i) => {
        const message = failures.get(vault)
        return message === undefined ? [] : [roots.length === 1 ? message : `${names[i]}: ${message}`]
      }),
    [failures, roots, names],
  )

  // Every directory of the CURRENT trees, outer before inner (`allDirs`), vault by vault: the
  // expand-all set (⚡ YAZ-862) and, since YAZ-1491, the search's folder rows (🔒 D1) — one
  // memo, no second feed. The REAL folders only: a vault row is not one, so "Collapse all" leaves
  // the vault rows open (YAZ-2602 S16).
  const dirsByVault = useMemo(() => roots.map((vault) => walkOf(trees.get(vault)).dirs), [trees, roots])
  const dirs = useMemo(() => (dirsByVault.length === 1 ? dirsByVault[0] : dirsByVault.flat()), [dirsByVault])
  /** One vault's own folders: what a rule about that vault alone resolves over. */
  const dirsOf = useCallback((vault: string): string[] => dirsByVault[roots.indexOf(vault)] ?? [], [dirsByVault, roots])
  // The files that are not notes, for the search (YAZ-2620 🔒 D3): the index holds notes only. Vault by vault, as `dirsByVault`.
  const filesByVault = useMemo(() => roots.map((vault) => walkOf(trees.get(vault)).files), [trees, roots])
  // The Focus tab's rows (YAZ-2619 D2): the list in the order ADDED, off the live trees, by the
  // Favorites rule (`favoriteRoots`) — a vanished path yields no row, and the prune below drops it.
  // It resolves over the forest, so the items of every vault stand in the one list (YAZ-2602 A1, A4).
  const focusNodes = useMemo(() => (forest === null ? [] : favoriteRoots(forest, focusList)), [forest, focusList])
  const focusDirs = useMemo(() => allDirs(focusNodes), [focusNodes])
  // The Favorites tab's rows (YAZ-1766 D4): the favorites in STORED order, off the live trees; nesting
  // and redundancy are kept (`favoriteRoots`). They stand under their vault's row when the window
  // has two or more (YAZ-2602 D5).
  const favoriteNodes = useMemo(
    () => favoriteForest(roots.map((vault, i) => ({ root: vault, name: names[i], tree: trees.get(vault)?.tree ?? [] })), favoritesByRoot),
    [trees, roots, names, favoritesByRoot],
  )
  // A vault row is no folder to fold with the rest, on this tab as on Files (S16).
  const favoriteDirs = useMemo(() => allDirs(favoriteNodes).filter((dir) => !vaultRows.has(dir)), [favoriteNodes, vaultRows])

  /** Read one vault's favorites; the answer for a vault that left the window meanwhile is dropped. */
  const loadFavorites = useCallback((vault: string) => {
    void api.favorites.get(vault).then((next) => {
      if (live.current.roots.includes(vault)) setFavoritesByRoot((prev) => (sameList(prev[vault] ?? [], next) ? prev : { ...prev, [vault]: next }))
    })
  }, [])

  /** Ask for a fresh tree of one vault; the answer lands through its feed below. A folder that is gone is App's to drop (R6). */
  const refresh = useCallback((vault: string) => {
    fetchTree(vault).catch((err: unknown) => {
      if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) live.current.onRootMissing(vault)
      else if (live.current.roots.includes(vault)) setFailure(vault, err instanceof BridgeRequestError ? err.message : 'Failed to load folder')
    })
  }, [setFailure])

  // PER VAULT, for as long as the vault is in the window (YAZ-2602 D3): its tree feed, its first
  // read, its watcher refresh and the first read of its favorites (D5). A vault that joins starts
  // its own and a vault that leaves ends its own, so a vault that stays is never read again for any.
  //
  // The feed (YAZ-2191): every answer for the vault lands here, whoever asked — this panel, its
  // active-file probe, the view-only catalog. A failure is only this panel's to report when it
  // asked (`refresh`), exactly as before the feed. A vault added to a mounted panel was just walked
  // by App's probe, and that walk is its first tree.
  //
  // The watcher: refresh on structural changes; `ready` also fires on every watch (re)subscription,
  // covering missed events, and refreshes at once. A lone event refreshes at once too; a burst (git
  // pull, Finder copy, bulk rename) is that read plus ONE more, 100 ms after its last event
  // (YAZ-2191, YAZ-2240): it used to be one full vault walk per event.
  const feeds = useRef(new Map<string, { watch: WatchSource; end: () => void }>())
  const started = useRef(false)
  useEffect(() => {
    const held = feeds.current
    for (const [vault, feed] of held) {
      const at = roots.indexOf(vault)
      if (at !== -1 && watches[at] === feed.watch) continue
      feed.end()
      held.delete(vault)
      if (at !== -1) continue
      setTrees((prev) => new Map([...prev].filter(([key]) => key !== vault)))
      setFavoritesByRoot(({ [vault]: _left, ...rest }) => rest)
      setFailure(vault, null)
    }
    roots.forEach((vault, at) => {
      if (held.has(vault)) return
      const land = (landed: TreeResponse): void => {
        setTrees((prev) => new Map(prev).set(vault, landed))
        setFailure(vault, null)
      }
      const offTree = onTree(vault, (outcome) => {
        if (outcome.status === 'fulfilled') land(outcome.value)
      })
      const burst = leadingTrailing(() => refresh(vault), WATCH_BURST_QUIET_MS)
      const offWatch = watches[at].subscribe((ev) => {
        if (ev.type === 'error') return setFailure(vault, ev.message)
        if (ev.type === 'change') return
        if (ev.type === 'ready') return burst.flush()
        burst.call()
      })
      held.set(vault, {
        watch: watches[at],
        end: () => {
          offTree()
          offWatch()
          burst.cancel()
        },
      })
      const walked = started.current ? latestTree(vault) : null
      if (walked === null) refresh(vault)
      else land(walked)
      loadFavorites(vault)
    })
    started.current = true
  }, [roots, watches, refresh, loadFavorites, setFailure])
  useEffect(
    () => () => {
      for (const feed of feeds.current.values()) feed.end()
      feeds.current.clear()
      started.current = false
    },
    [],
  )

  // The vaults whose stored lists `expanded` holds: a vault that joins brings its own, and one that
  // leaves takes its folders with it, as the store has them. The write waits for that render.
  const merged = useRef(roots)
  useEffect(() => {
    const before = merged.current
    merged.current = roots
    const joined = roots.filter((vault) => !before.includes(vault))
    const left = before.filter((vault) => !roots.includes(vault))
    if (joined.length > 0 || left.length > 0) {
      dispatch({ type: 'setAll', dirs: [...expanded.filter((dir) => rootOfPath(left, dir) === null), ...joined.flatMap(storage.getExpanded)] })
      return
    }
    for (const vault of roots) {
      // A folder of no vault of the window stays in the first vault's list, where one vault keeps it.
      const own = roots.length === 1 ? expanded : expanded.filter((dir) => (rootOfPath(roots, dir) ?? roots[0]) === vault)
      // Idempotent (⚡ YAZ-874): the first render holds exactly what was
      // just read, and re-sending it would make the main process commit, write and broadcast for nothing.
      if (sameList(storage.getExpanded(vault), own)) continue
      storage.setExpanded(vault, own)
    }
  }, [roots, expanded])

  // The focus list's write-back, idempotent like `expanded`'s above — into this window's identity
  // (YAZ-1628), not the vault bucket.
  useEffect(() => {
    if (sameList(storage.getFocusList(), focusList)) return
    storage.setFocusList(focusList)
  }, [focusList])

  // Favorites (6A/6C): read once per vault (above), then re-read on every `favorites:changed` for a
  // vault of the window (YAZ-2602 S27) — an own write's echo, another window's, or a synced file.
  useEffect(
    () =>
      api.favorites.onChanged((c) => {
        if (live.current.roots.includes(c.root)) loadFavorites(c.root)
      }),
    [loadFavorites],
  )
  /**
   * The ONE writer (6C), of one vault's list: optimistic, then main writes that vault's file; a
   * refusal (a malformed favorites.json → INVALID_CONFIG, D12) reverts the list and toasts. Main
   * drops dead entries on the way (D14).
   */
  const saveFavorites = useCallback(
    (vault: string, next: readonly string[]) => {
      const prev = favoritesRef.current[vault] ?? []
      setFavoritesByRoot((all) => ({ ...all, [vault]: next }))
      api.favorites.set(vault, next).catch((err: unknown) => {
        setFavoritesByRoot((all) => ({ ...all, [vault]: prev }))
        onNotice(`Can't save favorites: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    },
    [onNotice],
  )

  // The file this mount woke up with is SHOWN, not revealed (YAZ-1642): a relaunch restores the
  // tab and leaves the tree collapsed. Any file opened after that still opens its folders.
  // Its FOLDERS, in the vault that holds it: a vault row the user closed stays closed (YAZ-2602 R9).
  const restoredFile = useRef(activeFile)
  useEffect(() => {
    if (activeFile === restoredFile.current) return
    restoredFile.current = null
    if (activeFile !== null) dispatch({ type: 'expandTo', root: rootOf(activeFile), file: activeFile })
  }, [rootOf, activeFile])

  // A focus item that left its vault DROPS OUT of the list (YAZ-2619 R13) — deleted or moved out,
  // a file as a folder (`findNode`). The store repairs the FILE on delete; this component holds its
  // own copy, so it prunes against the live tree itself, as `useSelection` (rowGestures.ts) does
  // for the selection. Each item is asked of the tree of the vault that holds it, once that tree
  // has landed: a tree still on its way holds nothing yet. An item of a vault that left the window
  // has no tree to ask, so it leaves with its vault (YAZ-2602 A5).
  useEffect(() => {
    if (focusList.length === 0) return
    const kept = focusList.filter((path) => {
      const vault = rootOfPath(roots, path)
      const landed = vault === null ? undefined : trees.get(vault)
      return vault !== null && (landed === undefined || findNode(landed.tree, path) !== null)
    })
    if (kept.length !== focusList.length) setFocusList(kept)
  }, [trees, roots, focusList])
  // Favorites are NOT pruned against the tree here (D14): a path missing on this machine may simply not
  // have synced yet, so it draws no row (`favoriteRoots`) and main heals dead entries on the next write.

  // Stored lastFile that no longer exists → drop it (first tree only, so a file deleted on disk
  // EXTERNALLY while it is being edited stays open and is recreated by the next save — an
  // IN-APP delete never reaches here, it closes tabs through the `file:deleted` broadcast
  // which retires the editor first (GRO-2272); do not unify the two. Files OUTSIDE the
  // root (opened via a pasted `#/abs/path.md` URL, GRO-2069) are never in the tree — skip them.
  // A tab may be a FOLDER (YAZ-2290 D3), so both checks ask `treeHasPath`: a folder still in the
  // tree survives, one that left it closes like a file. The tree that can say is the one of the
  // vault that holds the file (YAZ-2602).
  const validated = useRef(false)
  const home = activeFile === null ? null : rootOfPath(roots, activeFile)
  const homeTree = trees.get(home ?? root) ?? null
  useEffect(() => {
    if (homeTree === null || validated.current) return
    validated.current = true
    if (activeFile !== null && home !== null && activeFile.startsWith(`${home.replace(/\/+$/, '')}/`) && !treeHasPath(homeTree.tree, activeFile))
      onFileMissing()
  }, [homeTree, activeFile, home, onFileMissing])

  // A stale tab ACTIVATED after its file vanished on disk (I3, GRO-2235): when the activation
  // CHANGES to an in-root file the cached tree does not show, confirm against a FRESH tree —
  // the inline-create flow activates a just-created file before `refresh()` lands, so the
  // cached tree can be behind — and close it through the same onFileMissing path. A file
  // deleted EXTERNALLY while it is the active editor stays open (no activation change —
  // recreated by the next save); an IN-APP delete never routes through here, it closes tabs
  // via the `file:deleted` broadcast, which also retires the editor first (GRO-2272). Do not
  // unify the two. Background tabs are never probed (out of scope, noted in GRO-2235).
  const lastActive = useRef(activeFile)
  const treesRef = useRef(trees)
  treesRef.current = trees
  useEffect(() => {
    if (activeFile === lastActive.current) return
    lastActive.current = activeFile
    const vault = activeFile === null ? null : rootOfPath(live.current.roots, activeFile)
    if (activeFile === null || vault === null || !activeFile.startsWith(`${vault.replace(/\/+$/, '')}/`)) return
    const held = treesRef.current.get(vault)
    if (held !== undefined && treeHasPath(held.tree, activeFile)) return
    let cancelled = false // the activation moved on (or the sidebar unmounted): the probe's verdict is stale
    fetchTree(vault).then(
      (res) => {
        if (!cancelled && !treeHasPath(res.tree, activeFile)) onFileMissing()
      },
      () => undefined, // a root-level failure is refresh()'s problem, not this probe's
    )
    return () => {
      cancelled = true
    }
  }, [activeFile, onFileMissing])

  /**
   * Open the way to `file` (YAZ-2602): every folder above it in the vault that holds it — a
   * synthetic child opens the folder itself — and that vault's row, if the user closed it. For the
   * gestures that SHOW a row: a reveal (S17), a create, a paste.
   */
  const openTo = useCallback(
    (file: string) => {
      const vault = rootOf(file)
      if (live.current.closedVaults.includes(vault)) live.current.onSetVaultOpen(vault, true)
      dispatch({ type: 'expandTo', root: vault, file })
    },
    [rootOf],
  )

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
      for (const path of paths) if (dirs.includes(path)) dispatch({ type: 'expandTo', root: rootOf(path), file: `${path}/x` })
      if (next.length > MAX_FOCUS) onNotice(`Focus limit reached: ${MAX_FOCUS} items`, 'error')
      else onNotice(`Added ${n}to focus`)
    },
    [rootOf, dirs, focusList, onNotice],
  )
  const clearFocus = useCallback(() => setFocusList([]), [])

  /**
   * The favorite toggle (YAZ-1766 D3/D6): remove every path, or append the ones not yet pinned —
   * insertion order, no duplicates. `isOn` arrives with the paths. Each path goes to the list of
   * the vault that holds it, so a selection across two vaults writes one file per vault (YAZ-2602
   * S25). The toast confirms with its own glyph and counts every row; `saveFavorites` persists.
   */
  const toggleFavorite = useCallback(
    (paths: string[], isOn: boolean) => {
      const n = paths.length > 1 ? `${paths.length} ` : ''
      for (const vault of live.current.roots) {
        const own = paths.filter((p) => rootOf(p) === vault)
        if (own.length === 0) continue
        const prev = favoritesRef.current[vault] ?? []
        saveFavorites(vault, isOn ? prev.filter((p) => !own.includes(p)) : [...prev, ...own.filter((p) => !prev.includes(p))])
      }
      onNotice(isOn ? `Removed ${n}from favorites` : `Added ${n}to favorites`, 'favorite')
    },
    [rootOf, onNotice, saveFavorites],
  )

  // Stable for the per-level memoised Tree (YAZ-2194). A vault row is open unless the user closed
  // it (YAZ-2602 R9): App's list, for the session, so it is neither in `expanded` nor in the store.
  const expandedSet = useMemo(() => new Set([...expanded, ...(roots.length === 1 ? [] : roots.filter((vault) => !closedVaults.includes(vault)).map(stripSlash))]), [expanded, roots, closedVaults])
  const toggleDir = useCallback(
    (dir: string) => {
      if (!vaultRowsRef.current.has(dir)) return dispatch({ type: 'toggle', dir })
      const vault = rootOf(dir)
      live.current.onSetVaultOpen(vault, live.current.closedVaults.includes(vault))
    },
    [rootOf],
  )

  return { roots, rootOf, trees, forest, loaded, vaultRows, errors, refresh, expanded, dispatch, openTo, expandedSet, toggleDir, focusList, focusNodes, focusDirs, toggleFocus, clearFocus, favoritesByRoot, favoritesRef, saveFavorites, toggleFavorite, dirs, dirsByVault, dirsOf, filesByVault, favoriteNodes, favoriteDirs }
}
