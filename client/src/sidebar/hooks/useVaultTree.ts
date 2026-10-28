/**
 * The window's vaults as this panel holds them (YAZ-2202; one tree per vault, YAZ-2602 D3): each
 * tree and its watcher refresh, each load error, the expansion, and the checks that close a tab
 * whose file is gone. Each vault's Favorites list and focus list are App's since YAZ-3264 (D1,
 * `useVaultListsHere`): the panel draws them and opens a folder just added to focus.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { copyFoldKey } from '@shared/foldKey'
import { rootOfPath, stripSlash, type TreeNode, type TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import type { WatchSource } from '../../hooks/useWatch'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../../lib/leadingTrailing'
import { storage } from '../../lib/storage'
import { fetchTree, latestTree, onTree } from '../../lib/treeFeed'
import { allDirs, ancestorDirs, copyDirs, favoriteRoots, otherFiles, treeHasPath, treeReducer } from '../../lib/treeState'
import { sameList, type VaultListsHere } from '../../lists/useVaultListsHere'
import type { SidebarVault } from '../Sidebar'
import { withMtime } from '../treeSort'

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

/** The trees with one file's time patched (YAZ-3227 D2): a new time adds no folder and no file, so the vault's walk carries over. */
function withTime(trees: ReadonlyMap<string, TreeResponse>, vault: string, file: string, mtime: number): ReadonlyMap<string, TreeResponse> {
  const next = withMtime(trees, vault, file, mtime)
  const [was, now] = [trees.get(vault), next.get(vault)]
  const walk = was === undefined ? undefined : walks.get(was)
  if (now !== undefined && now !== was && walk !== undefined) walks.set(now, walk)
  return next
}

export function useVaultTree(
  vaults: readonly SidebarVault[],
  closedVaults: readonly string[],
  onSetVaultOpen: (root: string, open: boolean) => void,
  activeFile: string | null,
  onRootMissing: (root: string) => void,
  onFileMissing: () => void,
  /** The window's Focus and Favorites (YAZ-3264 D1): App's, so they live on while the panel is hidden. */
  lists: VaultListsHere,
  /** The shown tab sorts by Last updated (YAZ-3227 D2): each save puts its file's time into the tree. */
  liveTimes = false,
) {
  // The window's vaults (YAZ-2602 D1), in the window's order. `root` is the FIRST.
  const roots = useSameList(vaults.map((vault) => vault.root))
  const watches = useSameList(vaults.map((vault) => vault.watch))
  const names = useSameList(vaults.map((vault) => vault.name))
  const root = roots[0]
  // What the callbacks below ask at call time, so each keeps its identity under the memoised Tree (YAZ-2194).
  const live = useRef({ roots, closedVaults, onSetVaultOpen, onRootMissing, liveTimes })
  live.current = { roots, closedVaults, onSetVaultOpen, onRootMissing, liveTimes }
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
  // A NEW window starts with every folder closed (YAZ-3487): the vault's open folders are another window's.
  const [expanded, dispatch] = useReducer(treeReducer, roots, (all) => (storage.isCollapsedStart() ? [] : all.flatMap(storage.getExpanded)))
  // A NEW window's closed tree is no choice of the user: it writes nothing until a folder opens or closes here, so the
  // vault keeps the list its other windows saved (bug YAZ-3513). The reducer answers a new list for each change.
  const startList = useRef(storage.isCollapsedStart() ? expanded : null)

  // What the Files tab draws (YAZ-2602 D3). One vault → its tree. Two or more → one
  // folder row per vault, in the window's order, named as the app names the vault, its tree below it;
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
  // memo, no second feed. The REAL folders only: a vault row is not one, and "Collapse all" closes
  // it through App's list (YAZ-2631 D6).
  const dirsByVault = useMemo(() => roots.map((vault) => walkOf(trees.get(vault)).dirs), [trees, roots])
  const dirs = useMemo(() => (dirsByVault.length === 1 ? dirsByVault[0] : dirsByVault.flat()), [dirsByVault])
  /** One vault's own folders: what a rule about that vault alone resolves over. */
  const dirsOf = useCallback((vault: string): string[] => dirsByVault[roots.indexOf(vault)] ?? [], [dirsByVault, roots])
  // The files that are not notes, for the search (YAZ-2620 🔒 D3): the index holds notes only. Vault by vault, as `dirsByVault`.
  const filesByVault = useMemo(() => roots.map((vault) => walkOf(trees.get(vault)).files), [trees, roots])
  // The Focus tab's rows (YAZ-2619 D2), off the live trees, in the order of `focusList` (App's, YAZ-3264 D1),
  // never the tree's. An item this Mac has no file for draws no row and STAYS in the list (YAZ-2702 S13).
  const { focusList, favoritesByRoot, favoritePaths, clearFocus, toggleFavorite, reorderFocus, saveFavoriteOrder, toggleFocus: toggleListFocus } = lists
  const focusNodes = useMemo(() => (forest === null ? [] : favoriteRoots(forest, focusList)), [forest, focusList])
  // Each copy folds on its own (YAZ-3131 Decision 2), so the tab's expand-all set is its copies' keys.
  const focusDirs = useMemo(() => copyDirs(focusNodes), [focusNodes])
  // The Favorites tab's rows (YAZ-1766 D4; YAZ-2631 D1), by the Focus rule above; nesting and redundancy are kept.
  const favoriteNodes = useMemo(() => (forest === null ? [] : favoriteRoots(forest, favoritePaths)), [forest, favoritePaths])
  const favoriteDirs = useMemo(() => copyDirs(favoriteNodes), [favoriteNodes])

  /** Ask for a fresh tree of one vault; the answer lands through its feed below. A folder that is gone is App's to drop (R6). */
  const refresh = useCallback((vault: string) => {
    fetchTree(vault).catch((err: unknown) => {
      if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) live.current.onRootMissing(vault)
      else if (live.current.roots.includes(vault)) setFailure(vault, err instanceof BridgeRequestError ? err.message : 'Failed to load folder')
    })
  }, [setFailure])

  // PER VAULT, for as long as the vault is in the window (YAZ-2602 D3): its tree feed, its first
  // read and its watcher refresh (its two lists are App's, YAZ-3264 D1). A vault that joins starts
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
        // A save moves no row by name; by Last updated it does (YAZ-3227 D2). Patch the one file's time, no walk.
        if (ev.type === 'change') return live.current.liveTimes ? setTrees((prev) => withTime(prev, vault, ev.path, ev.mtime)) : undefined
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
    })
    started.current = true
  }, [roots, watches, refresh, setFailure])
  // The tree's times are as old as its last walk (a save walks nothing): turning Last updated on walks each vault once.
  useEffect(() => {
    if (liveTimes) for (const vault of live.current.roots) refresh(vault)
  }, [liveTimes, refresh])
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
      const dirs = [...expanded.filter((dir) => rootOfPath(left, dir) === null), ...joined.flatMap(storage.getExpanded)]
      // A new window that the user has not touched stays untouched: a vault that joins or leaves is no open or close (YAZ-3513).
      if (expanded === startList.current) startList.current = dirs
      dispatch({ type: 'setAll', dirs })
      return
    }
    if (expanded === startList.current) return
    startList.current = null
    for (const vault of roots) {
      // A folder of no vault of the window stays in the first vault's list, where one vault keeps it.
      const own = roots.length === 1 ? expanded : expanded.filter((dir) => (rootOfPath(roots, dir) ?? roots[0]) === vault)
      // Idempotent (⚡ YAZ-874): the first render holds exactly what was
      // just read, and re-sending it would make the main process commit, write and broadcast for nothing.
      if (sameList(storage.getExpanded(vault), own)) continue
      storage.setExpanded(vault, own)
    }
  }, [roots, expanded])

  // The file this mount woke up with is SHOWN, not revealed (YAZ-1642): a relaunch restores the
  // tab and leaves the tree collapsed. Any file opened after that still opens its folders.
  // Its FOLDERS, in the vault that holds it: a vault row the user closed stays closed (YAZ-2602 R9).
  const restoredFile = useRef(activeFile)
  useEffect(() => {
    if (activeFile === restoredFile.current) return
    restoredFile.current = null
    if (activeFile !== null) dispatch({ type: 'expandTo', root: rootOf(activeFile), file: activeFile })
  }, [rootOf, activeFile])

  // Neither list is pruned against the tree here (Favorites: D14; focus: YAZ-2702 S13, which overturns
  // the prune of YAZ-2619 R13): a path missing on this machine may simply not have synced yet, and a
  // prune here would take it out of the list on every Mac. It draws no row (`favoriteRoots`); main
  // repairs an in-app rename or delete (`focus.ts`, R10) and drops dead entries on the next write (R7).

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
   * gestures that SHOW a row: a reveal (S17), a create, a paste. With `top`, the gesture came from a
   * copy of Focus or Favorites (YAZ-3131 Decision 4), whose folds are its own: the way down from that
   * top row opens too, in that copy alone.
   */
  const openTo = useCallback(
    (file: string, top?: string) => {
      const vault = rootOf(file)
      if (live.current.closedVaults.includes(vault)) live.current.onSetVaultOpen(vault, true)
      dispatch({ type: 'expandTo', root: vault, file })
      if (top !== undefined && file.startsWith(`${top}/`)) dispatch({ type: 'open', dirs: [top, ...ancestorDirs(top, file)].map((dir) => copyFoldKey(top, dir)) })
    },
    [rootOf],
  )

  /**
   * The focus toggle of the sidebar (YAZ-2619 D3): App's lists add or remove and toast (YAZ-3264 D1,
   * `useVaultListsHere`). A folder just added shows OPEN on the tab (R4), as its own top row's copy
   * (YAZ-3131 S4). The jump to the Focus tab is `Sidebar.tsx`'s.
   */
  const toggleFocus = useCallback(
    (paths: string[], isOn: boolean) => {
      if (!toggleListFocus(paths, isOn) || isOn) return
      // A folder joins open (R4) in its own copy only (YAZ-3131 S4): Files and the other copies keep their folds.
      dispatch({ type: 'open', dirs: paths.filter((path) => dirs.includes(path)).map((path) => copyFoldKey(path, path)) })
    },
    // The toggle alone, not `lists`: a Favorites change must not give the memoised Tree (YAZ-2194) a new handler.
    [dirs, toggleListFocus],
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

  return { roots, watches, rootOf, trees, forest, loaded, vaultRows, errors, refresh, expanded, dispatch, openTo, expandedSet, toggleDir, focusList, reorderFocus, focusNodes, focusDirs, toggleFocus, clearFocus, favoritesByRoot, favoritePaths, saveFavoriteOrder, toggleFavorite, dirs, dirsByVault, dirsOf, filesByVault, favoriteNodes, favoriteDirs }
}
