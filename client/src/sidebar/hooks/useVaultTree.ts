/**
 * The window's vaults as this panel holds them (YAZ-2202; one tree per vault, YAZ-2602 D3): each
 * tree and its watcher refresh, each load error, the expansion, each vault's Favorites list and
 * focus list (both kept in the vault), and the checks that close a tab whose file is gone.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { copyFoldKey } from '@shared/foldKey'
import { MAX_FOCUS, rootOfPath, stripSlash, type TreeNode, type TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import type { WatchSource } from '../../hooks/useWatch'
import type { NoticeKind } from '../../lib/notice'
import { leadingTrailing, WATCH_BURST_QUIET_MS } from '../../lib/leadingTrailing'
import { storage } from '../../lib/storage'
import { fetchTree, latestTree, onTree } from '../../lib/treeFeed'
import { allDirs, ancestorDirs, copyDirs, favoriteOrder, favoriteRoots, otherFiles, treeHasPath, treeReducer } from '../../lib/treeState'
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

/**
 * The two lists a vault keeps IN the vault, each with one namespace on the bridge that has the same
 * three calls (`get`, `set`, `onChanged`): Favorites (`.yaseendocs/favorites.json`, YAZ-1766 D11)
 * and focus (`.yaseendocs/focus.<mac id>.json`, YAZ-2702 Decisions 1 and 2).
 */
type ListKind = 'favorites' | 'focus'
type ListsByRoot = Readonly<Record<string, readonly string[]>>
/** Each kind's order ACROSS the vaults of a window, in the store (YAZ-2631 D1; focus: YAZ-2702 Decision 3). */
const ORDER: Record<ListKind, { get: () => string[]; set: (roots: readonly string[], paths: readonly string[]) => void }> = {
  favorites: { get: () => storage.getFavoritesOrder(), set: (roots, paths) => storage.setFavoritesOrder(roots, paths) },
  focus: { get: () => storage.getFocusOrder(), set: (roots, paths) => storage.setFocusOrder(roots, paths) },
}

/** One kind's lists as the callbacks reach them: the same object for the life of the panel. */
interface VaultLists {
  kind: ListKind
  /** The lists as the last render had them. A vault has an entry once this window has READ its list, an empty one too (YAZ-2631 R25). */
  held: { readonly current: ListsByRoot }
  /** Read one vault's list; the answer for a vault that left the window meanwhile is dropped. */
  load(vault: string): void
  /** The vault left the window: its list leaves this panel. Nothing is written — the list is the vault's (YAZ-2702 S9). */
  drop(vault: string): void
  /**
   * The ONE writer (6C), of one vault's list: optimistic, then main writes that vault's file; a
   * refusal (a malformed favorites.json → INVALID_CONFIG, D12; a focus file that cannot be written,
   * YAZ-2702 S14) puts the list back and toasts. Main drops dead entries on the way (D14; focus: R7).
   */
  save(vault: string, next: readonly string[]): void
}

/**
 * One kind of vault list for the vaults of the window (YAZ-1766 6A/6C; focus by the same rule since
 * YAZ-2702): each vault's paths in the user's order, read from ITS file through main (absolute
 * paths) and kept by its root. `useVaultTree` reads each vault once, when it joins; every
 * `<kind>:changed` for a vault of the window reads it again (YAZ-2602 S27; focus: S7, S12) — an own
 * write's echo, another window's, or a file that a sync brought. So two windows on one vault, and
 * two Macs, show one list.
 */
function useVaultLists(kind: ListKind, live: { readonly current: { roots: readonly string[] } }, onNotice: (message: string, kind?: NoticeKind) => void): [ListsByRoot, VaultLists] {
  const [byRoot, setByRoot] = useState<ListsByRoot>({})
  const held = useRef(byRoot)
  held.current = byRoot
  const notice = useRef(onNotice)
  notice.current = onNotice
  const lists = useMemo<VaultLists>(
    () => ({
      kind,
      held,
      load(vault) {
        void api[kind].get(vault).then((next) => {
          if (live.current.roots.includes(vault)) setByRoot((prev) => (prev[vault] !== undefined && sameList(prev[vault], next) ? prev : { ...prev, [vault]: next }))
        })
      },
      drop: (vault) => setByRoot(({ [vault]: _left, ...rest }) => rest),
      save(vault, next) {
        const prev = held.current[vault] ?? []
        setByRoot((all) => ({ ...all, [vault]: next }))
        api[kind].set(vault, next).catch((err: unknown) => {
          // Only for a vault still in the window: one that left must not come back with a list this window did not read (YAZ-2702 S6).
          if (live.current.roots.includes(vault)) setByRoot((all) => ({ ...all, [vault]: prev }))
          notice.current(`Can't save ${kind}: ${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      },
    }),
    [kind, live],
  )
  useEffect(
    () =>
      api[kind].onChanged((c) => {
        if (live.current.roots.includes(c.root)) lists.load(c.root)
      }),
    [kind, live, lists],
  )
  return [byRoot, lists]
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
  // The window's vaults (YAZ-2602 D1), in the window's order. `root` is the FIRST.
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
  // Favorites (YAZ-1766 D2, in the vault since 6A/D11): each vault's pinned files and folders in the
  // user's order, from ITS `.yaseendocs/favorites.json`, kept by its root (`useVaultLists`).
  const [favoritesByRoot, favorites] = useVaultLists('favorites', live, onNotice)
  // Focus (YAZ-2619 D1): the files and folders the Focus tab shows. ONE list for each VAULT, kept in
  // the vault, since YAZ-2702 (Decision 1) — no longer one for each window (YAZ-1628): each window
  // on a vault shows the same list, as does each Mac that syncs the vault, and it stays after a
  // quit, a closed window, and a change to a different vault and back (S7, S8, S10, S12). This panel
  // holds what it read and writes nothing back on its own: a vault that leaves takes its rows off
  // the tab and keeps its file (S9).
  const [focusByRoot, focus] = useVaultLists('focus', live, onNotice)

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
  // The Focus tab's rows (YAZ-2619 D2): ONE flat list across the vaults of the window (YAZ-2602 A1, A4),
  // in ITS order, never the tree's, off the live trees, by the Favorites rule below. `focusList` is
  // every focus item in the tab's order — the store's order across vaults over each vault's own file
  // (`favoriteOrder`; YAZ-2702 Decision 3) — and also holds the items this Mac has no file for, which
  // draw no row and STAY in the list (S13): the note may simply not have synced yet.
  const focusOrder = useSyncExternalStore(storage.subscribe, storage.getFocusOrder)
  const focusList = useMemo(() => favoriteOrder(roots, focusByRoot, focusOrder), [roots, focusByRoot, focusOrder])
  const focusNodes = useMemo(() => (forest === null ? [] : favoriteRoots(forest, focusList)), [forest, focusList])
  // Each copy folds on its own (YAZ-3131 Decision 2), so the tab's expand-all set is its copies' keys.
  const focusDirs = useMemo(() => copyDirs(focusNodes), [focusNodes])
  // The Favorites tab's rows (YAZ-1766 D4; YAZ-2631 D1): ONE flat list across the vaults of the window,
  // off the live trees, by the Focus rule above; nesting and redundancy are kept. `favoritePaths` is
  // every favorite in the tab's order — the store's order across vaults over each vault's own file
  // (`favoriteOrder`) — and also holds the ones this machine has no file for yet, which draw no row (D14).
  const storedOrder = useSyncExternalStore(storage.subscribe, storage.getFavoritesOrder)
  const favoritePaths = useMemo(() => favoriteOrder(roots, favoritesByRoot, storedOrder), [roots, favoritesByRoot, storedOrder])
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
  // read, its watcher refresh and the first read of its favorites (YAZ-2631 D1) and of its focus
  // list (YAZ-2702). A vault that joins starts its own and a vault that leaves ends its own, so a
  // vault that stays is never read again for any.
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
      favorites.drop(vault)
      focus.drop(vault)
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
      favorites.load(vault)
      focus.load(vault)
    })
    started.current = true
  }, [roots, watches, refresh, favorites, focus, setFailure])
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

  /**
   * A drag on the Favorites tab (YAZ-2631 D1) or of a top row of the Focus tab (D3; YAZ-2702 S11):
   * `next` is every item of that tab in the new order. Each vault's file gets its own part, and only
   * when that part changed (R3); the store gets the order across the vaults, where the window has
   * two or more (R4), for the vaults whose list this window has read: one whose list is still on its
   * way keeps its places (R25). Each write is whole alone.
   */
  const saveOrder = useCallback(
    (lists: VaultLists, next: string[]) => {
      for (const vault of live.current.roots) {
        const own = next.filter((p) => rootOf(p) === vault)
        if (!sameList(own, lists.held.current[vault] ?? [])) lists.save(vault, own)
      }
      if (live.current.roots.length > 1) ORDER[lists.kind].set(live.current.roots.filter((vault) => lists.held.current[vault] !== undefined), next)
    },
    [rootOf],
  )
  const saveFavoriteOrder = useCallback((next: string[]) => saveOrder(favorites, next), [saveOrder, favorites])
  const reorderFocus = useCallback((next: string[]) => saveOrder(focus, next), [saveOrder, focus])

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
   * The toggle of a vault list (Favorites: YAZ-1766 D3/D6; focus: YAZ-2619 D3, YAZ-2702 S1–S3):
   * remove every path, or append the ones not yet in the list — insertion order, no duplicates, `max`
   * at most for each vault. Each path goes to the list of the vault that holds it, so a selection
   * across two vaults writes one file per vault (YAZ-2602 S25; S2). A remove also takes its paths
   * out of the store's order across vaults, where that order holds one (YAZ-2631 R23; S3): the same
   * path, in the list again, then goes last (S6). An add writes no order (R13).
   * Answers null, with nothing written, when a vault that holds a path has no list here yet (R26;
   * YAZ-2702 S6): a write would replace the list on disk. Else whether a list went past `max`.
   */
  const toggleIn = useCallback(
    (lists: VaultLists, paths: string[], isOn: boolean, max = Infinity): boolean | null => {
      if (paths.some((p) => lists.held.current[rootOf(p)] === undefined)) return null
      let full = false
      for (const vault of live.current.roots) {
        const own = paths.filter((p) => rootOf(p) === vault)
        if (own.length === 0) continue
        const prev = lists.held.current[vault] ?? []
        const next = isOn ? prev.filter((p) => !own.includes(p)) : [...prev, ...own.filter((p) => !prev.includes(p))]
        if (next.length > max) full = true
        const kept = next.slice(0, max)
        // A list that did not change — an add to a full list — is not written.
        if (!sameList(kept, prev)) lists.save(vault, kept)
      }
      const order = ORDER[lists.kind].get()
      if (isOn && order.some((p) => paths.includes(p))) ORDER[lists.kind].set(live.current.roots, order.filter((p) => !paths.includes(p)))
      return full
    },
    [rootOf],
  )

  /**
   * The focus toggle (YAZ-2619 D3), into the vaults' own lists since YAZ-2702 (`toggleIn`):
   * `MAX_FOCUS` at most for EACH VAULT (R2; S5) — an add past it keeps the first `MAX_FOCUS` of that
   * vault and says so. `isOn` arrives with the paths. A folder just added shows OPEN on the tab (R4),
   * as its own top row's copy (YAZ-3131 S4), the items go last on the tab, and the toast
   * confirms, as the favorite toggle's does (R3).
   */
  const toggleFocus = useCallback(
    (paths: string[], isOn: boolean) => {
      const full = toggleIn(focus, paths, isOn, MAX_FOCUS)
      if (full === null) return onNotice('Focus is still loading. Try again.', 'error')
      const n = paths.length > 1 ? `${paths.length} ` : ''
      if (isOn) return onNotice(`Removed ${n}from focus`)
      // A folder joins open (R4) in its own copy only (YAZ-3131 S4): Files and the other copies keep their folds.
      dispatch({ type: 'open', dirs: paths.filter((path) => dirs.includes(path)).map((path) => copyFoldKey(path, path)) })
      if (full) return onNotice(`Focus limit reached: ${MAX_FOCUS} items`, 'error')
      // With two or more vaults the new items go LAST on the tab, "the order added" (YAZ-2619 D1), as
      // before the lists were the vaults': the order across vaults takes them. Favorites writes no order
      // on an add (YAZ-2631 R13), so there a new favorite stands with its vault.
      if (live.current.roots.length > 1) storage.setFocusOrder(live.current.roots.filter((vault) => focus.held.current[vault] !== undefined), [...focusList, ...paths.filter((p) => !focusList.includes(p))])
      onNotice(`Added ${n}to focus`)
    },
    [dirs, focus, focusList, toggleIn, onNotice],
  )
  /**
   * "Clear" (YAZ-2619; YAZ-2702 S4): the list of each vault of the window that has items becomes
   * empty — one write for each such vault, so the change goes to each window and each Mac — and
   * those vaults lose their places in the store's order across vaults.
   */
  const clearFocus = useCallback(() => {
    const cleared = live.current.roots.filter((vault) => (focus.held.current[vault] ?? []).length > 0)
    for (const vault of cleared) focus.save(vault, [])
    if (storage.getFocusOrder().some((p) => rootOfPath(cleared, p) !== null)) storage.setFocusOrder(cleared, [])
  }, [focus])

  /**
   * The favorite toggle (YAZ-1766 D3/D6; `toggleIn`). `isOn` arrives with the paths. The toast
   * confirms with its own glyph and counts every row; `favorites.save` persists.
   */
  const toggleFavorite = useCallback(
    (paths: string[], isOn: boolean) => {
      if (toggleIn(favorites, paths, isOn) === null) return onNotice('Favorites are still loading. Try again.', 'error')
      const n = paths.length > 1 ? `${paths.length} ` : ''
      onNotice(isOn ? `Removed ${n}from favorites` : `Added ${n}to favorites`, 'favorite')
    },
    [favorites, toggleIn, onNotice],
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
