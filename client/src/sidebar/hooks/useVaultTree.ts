/**
 * The window's vaults as this panel holds them (YAZ-2202, moved out of `Sidebar.tsx` as-is; one
 * tree per vault since YAZ-2602): each tree and its watcher refresh, the expansion, the two Focus
 * Mode lists, the Favorites list, and the checks that close a tab whose file is gone.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { rootOfPath, stripSlash, type SidebarLens, type TreeNode, type TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import type { WatchSource } from '../../hooks/useWatch'
import type { NoticeKind } from '../../lib/notice'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../../lib/leadingTrailing'
import { storage } from '../../lib/storage'
import { fetchTree, latestTree, onTree } from '../../lib/treeFeed'
import { allDirs, favoriteRoots, findDirNode, focusRoots, treeHasPath, treeReducer } from '../../lib/treeState'
import type { SidebarVault } from '../Sidebar'

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** `list` itself while it holds what it held: App hands the panel a new array of the same vaults on each render. */
export function useSameList<T>(list: readonly T[]): readonly T[] {
  const held = useRef(list)
  if (held.current.length !== list.length || held.current.some((item, i) => item !== list[i])) held.current = list
  return held.current
}

export function useVaultTree(
  vaults: readonly SidebarVault[],
  closedVaults: readonly string[],
  onSetVaultOpen: (root: string, open: boolean) => void,
  activeFile: string | null,
  lens: SidebarLens,
  onRootMissing: (root: string) => void,
  onFileMissing: () => void,
  onNotice: (message: string, kind?: NoticeKind) => void,
) {
  // The window's vaults (YAZ-2602 D1), in the order they were added. `root` is the FIRST: App keys
  // this panel on it, and the Favorites tab stands on it.
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
  const [failure, setFailure] = useState<{ root: string; message: string } | null>(null)
  const error = failure?.message ?? null
  const tree = trees.get(root) ?? null
  /** Every vault has its tree: only then can a path that no tree holds be called gone. */
  const loaded = roots.every((vault) => trees.has(vault))
  // One list here, one list PER VAULT in the store (YAZ-2602 D3): the vaults never nest (R8), so
  // each folder is its own vault's, and the write-back below splits them again.
  const [expanded, dispatch] = useReducer(treeReducer, roots, (all) => all.flatMap(storage.getExpanded))
  // Focus Mode (YAZ-1605): one path LIST of dirs per lens; empty
  // is no focus. Per WINDOW since YAZ-1628 (`sidebarCollapsed`'s rule), unlike the per-vault
  // expansion above: restored from this window's identity and written back the same way, so it
  // survives a lens switch and a restart and follows its own rename, ⌘⇧N inherits it, and another
  // window on the same vault is never affected.
  const [focusDirs, setFocusDirs] = useState<readonly string[]>(storage.getFocusDirs)
  const [focusFavorites, setFocusFavorites] = useState<readonly string[]>(storage.getFocusFavorites)
  // Favorites (YAZ-1766 D2, in the vault since 6A/D11): the vault's pinned files and folders in the
  // user's order, read from `.yaseendocs/favorites.json` through main (absolute paths). Another
  // window's — or another machine's, via sync — write lands here through `favorites:changed` (below).
  const [favorites, setFavorites] = useState<readonly string[]>([])
  const favoritesRef = useRef(favorites)
  favoritesRef.current = favorites

  // What the Files tab draws (YAZ-2602 D3). One vault → its tree, as before. Two or more → one
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
  /** The vault rows' paths; empty with one vault, which has no row (S11). */
  const vaultRows = useMemo<ReadonlySet<string>>(() => new Set(roots.length === 1 ? [] : roots.map(stripSlash)), [roots])
  const vaultRowsRef = useRef(vaultRows)
  vaultRowsRef.current = vaultRows

  // Every directory of the CURRENT trees, outer before inner (`allDirs`), vault by vault: the
  // expand-all set (⚡ YAZ-862) and, since YAZ-1491, the search list's folder rows (🔒 D1) — one
  // memo, no second feed. The REAL folders only: a vault row is not one, so "Collapse all" leaves
  // the vault rows open (YAZ-2602 S16).
  const dirsByVault = useMemo(() => roots.map((vault) => allDirs(trees.get(vault)?.tree ?? [])), [trees, roots])
  const dirs = useMemo(() => (dirsByVault.length === 1 ? dirsByVault[0] : dirsByVault.flat()), [dirsByVault])
  /** One vault's own folders: what a rule about that vault alone resolves over. */
  const dirsOf = useCallback((vault: string): string[] => dirsByVault[roots.indexOf(vault)] ?? [], [dirsByVault, roots])
  // The focused top rows (YAZ-1605), resolved off the LIVE trees in tree order — a vanished dir yields
  // no row, and the prune below drops it. `dirs` stays the WHOLE of every vault: reveal must still find what is hidden.
  const focusNodes = useMemo(() => (forest === null || focusDirs.length === 0 ? [] : focusRoots(forest, focusDirs)), [forest, focusDirs])
  // The expand/collapse-all button acts on the dirs ON SCREEN: the focused subtrees, or all of them.
  const shownDirs = useMemo(() => (focusNodes.length === 0 ? dirs : allDirs(focusNodes).filter((dir) => !vaultRows.has(dir))), [dirs, focusNodes, vaultRows])
  // The Favorites tab's rows (YAZ-1766 D4/D5): its own focus list when set, else the favorites — each
  // in STORED order, off the live tree; nesting and redundancy are kept (`favoriteRoots`, not `focusRoots`).
  const favoriteNodes = useMemo(() => (tree === null ? [] : favoriteRoots(tree.tree, focusFavorites.length > 0 ? focusFavorites : favorites)), [tree, favorites, focusFavorites])
  const favoriteDirs = useMemo(() => allDirs(favoriteNodes), [favoriteNodes])

  /** Ask for a fresh tree of one vault; the answer lands through its feed below. A folder that is gone is App's to drop (R6). */
  const refresh = useCallback((vault: string) => {
    fetchTree(vault).catch((err: unknown) => {
      if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) live.current.onRootMissing(vault)
      else setFailure({ root: vault, message: err instanceof BridgeRequestError ? err.message : 'Failed to load folder' })
    })
  }, [])

  // PER VAULT, for as long as the vault is in the window (YAZ-2602 D3): its tree feed, its first
  // read and its watcher refresh. A vault that joins starts its own and a vault that leaves ends
  // its own, so a vault that stays is never read again for either.
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
      if (at === -1) setTrees((prev) => new Map([...prev].filter(([key]) => key !== vault)))
    }
    roots.forEach((vault, at) => {
      if (held.has(vault)) return
      const land = (landed: TreeResponse): void => {
        setTrees((prev) => new Map(prev).set(vault, landed))
        setFailure((prev) => (prev?.root === vault ? null : prev))
      }
      const offTree = onTree(vault, (outcome) => {
        if (outcome.status === 'fulfilled') land(outcome.value)
      })
      const burst = leadingTrailing(() => refresh(vault), WATCH_BURST_QUIET_MS)
      const offWatch = watches[at].subscribe((ev) => {
        if (ev.type === 'error') return setFailure({ root: vault, message: ev.message })
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
    })
    started.current = true
  }, [roots, watches, refresh])
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

  // Focus Mode's write-back (YAZ-1605), idempotent like `expanded`'s above
  // — into this window's identity (YAZ-1628), not the vault bucket.
  useEffect(() => {
    if (sameList(storage.getFocusDirs(), focusDirs)) return
    storage.setFocusDirs(focusDirs)
  }, [focusDirs])
  useEffect(() => {
    if (sameList(storage.getFocusFavorites(), focusFavorites)) return
    storage.setFocusFavorites(focusFavorites)
  }, [focusFavorites])

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
  // Its FOLDERS, in the vault that holds it: a vault row the user closed stays closed (YAZ-2602 R9).
  const restoredFile = useRef(activeFile)
  useEffect(() => {
    if (activeFile === restoredFile.current) return
    restoredFile.current = null
    if (activeFile !== null) dispatch({ type: 'expandTo', root: rootOf(activeFile), file: activeFile })
  }, [rootOf, activeFile])

  // Focus Mode (YAZ-1605): a focus target that left the vault DROPS OUT — deleted or moved out
  // — and the last one leaving ends the focus: never an empty tree under a
  // lit eye. The store repairs the FILE on delete; this component holds its own copy, so it prunes
  // against the live tree itself, as `useSelection` (rowGestures.ts) does for the selection.
  // The live tree is the forest (YAZ-2602 D4), so the folders of a vault that left the window drop
  // out the same way (S21) — and only once EVERY vault's tree has landed: a tree still on its way holds nothing yet.
  useEffect(() => {
    if (forest === null || !loaded || focusDirs.length === 0) return
    const kept = focusDirs.filter((dir) => findDirNode(forest, dir) !== null)
    if (kept.length !== focusDirs.length) setFocusDirs(kept)
  }, [forest, loaded, focusDirs])
  useEffect(() => {
    if (tree === null || focusFavorites.length === 0) return
    const kept = focusFavorites.filter((dir) => findDirNode(tree.tree, dir) !== null)
    if (kept.length !== focusFavorites.length) setFocusFavorites(kept)
  }, [tree, focusFavorites])
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
   * Focus Mode (YAZ-1605): narrow `inLens` — the menu's pinned lens, FILES for a search row (🔒 D1,
   * YAZ-2050) — to these folders, REPLACING any focus,
   * one or many — and OPEN each row (the synthetic-child idiom `startCreate` uses), so the tree
   * never lands on closed chevrons.
   */
  const focusOn = useCallback(
    (paths: string[], inLens: SidebarLens) => {
      // Favorites keeps its OWN list (YAZ-1766 D5); both lenses share the one expansion (D7).
      if (inLens === 'favorites') setFocusFavorites(paths)
      else setFocusDirs(paths)
      // A focused folder is a top row, so its vault's row is not asked; a focused VAULT row opens itself.
      for (const path of paths) {
        if (vaultRowsRef.current.has(path)) live.current.onSetVaultOpen(rootOf(path), true)
        else dispatch({ type: 'expandTo', root: rootOf(path), file: `${path}/x` })
      }
    },
    [rootOf],
  )
  const focused = lens === 'favorites' ? focusFavorites.length > 0 : focusNodes.length > 0
  const exitFocus = useCallback(() => (lens === 'favorites' ? setFocusFavorites([]) : setFocusDirs([])), [lens])

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

  return { roots, rootOf, trees, tree, forest, loaded, vaultRows, error, refresh, expanded, dispatch, openTo, expandedSet, toggleDir, focusDirs, setFocusDirs, focusFavorites, focusNodes, focused, focusOn, exitFocus, favorites, favoritesRef, saveFavorites, toggleFavorite, dirs, dirsByVault, dirsOf, shownDirs, favoriteNodes, favoriteDirs }
}
