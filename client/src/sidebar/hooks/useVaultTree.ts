/**
 * The vault as this panel holds it (YAZ-2202, moved out of `Sidebar.tsx` as-is): the tree and its
 * watcher refresh, both expansions, the three Focus Mode lists, the Favorites list, and the checks
 * that close a tab whose file is gone.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { SidebarLens, TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import type { WikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../../hooks/useWatch'
import type { NoticeKind } from '../../lib/notice'
import { storage } from '../../lib/storage'
import { fetchTree, onTree } from '../../lib/treeFeed'
import { allDirs, favoriteRoots, findDirNode, focusRoots, treeHasFile, treeReducer } from '../../lib/treeState'
import { isFolderPage } from '../../links/folderPages'

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
/** Quiet time before a watcher burst's one tree read (YAZ-2191, measured in main-process.md F1). */
const STRUCTURAL_REFRESH_MS = 100

export function useVaultTree(
  root: string,
  watch: WatchSource,
  activeFile: string | null,
  lens: SidebarLens,
  indexSource: WikilinkResolveSource,
  onRootMissing: () => void,
  onFileMissing: () => void,
  onNotice: (message: string, kind?: NoticeKind) => void,
) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, dispatch] = useReducer(treeReducer, root, storage.getExpanded)
  // The TOPICS tree's open pages (🔒 D4), lifted here by ⚡ YAZ-873 so the lens row's one button
  // can read and replace them; the tree itself is controlled. PAGE PATHS, restored from the
  // main-owned per-vault bucket, so it opens where it was left — across a lens switch, a window
  // and a restart alike. A lens switch never touches it: this state outlives the tree's mount.
  const [topicsExpanded, setTopicsExpanded] = useState<ReadonlySet<string>>(() => new Set(storage.getTopicsExpanded(root)))
  // Focus Mode (YAZ-1605): one path LIST per lens — dirs for Files, folder pages for Topics; empty
  // is no focus. Per WINDOW since YAZ-1628 (`sidebarCollapsed`'s rule), unlike the two per-vault
  // expansions above: restored from this window's identity and written back the same way, so it
  // survives a lens switch and a restart and follows its own rename, ⌘⇧N inherits it, and another
  // window on the same vault is never affected.
  const [focusDirs, setFocusDirs] = useState<readonly string[]>(storage.getFocusDirs)
  const [focusTopics, setFocusTopics] = useState<readonly string[]>(storage.getFocusTopics)
  const [focusFavorites, setFocusFavorites] = useState<readonly string[]>(storage.getFocusFavorites)
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
  // The focused top rows (YAZ-1605), resolved off the LIVE tree in tree order — a vanished dir yields
  // no row, and the prune below drops it. `dirs` stays the WHOLE vault: reveal must still find what is hidden.
  const focusNodes = useMemo(() => (tree === null || focusDirs.length === 0 ? [] : focusRoots(tree.tree, focusDirs)), [tree, focusDirs])
  // The expand/collapse-all button acts on the dirs ON SCREEN: the focused subtrees, or all of them.
  const shownDirs = useMemo(() => (focusNodes.length === 0 ? dirs : allDirs(focusNodes)), [dirs, focusNodes])
  // The Favorites tab's rows (YAZ-1766 D4/D5): its own focus list when set, else the favorites — each
  // in STORED order, off the live tree; nesting and redundancy are kept (`favoriteRoots`, not `focusRoots`).
  const favoriteNodes = useMemo(() => (tree === null ? [] : favoriteRoots(tree.tree, focusFavorites.length > 0 ? focusFavorites : favorites)), [tree, favorites, focusFavorites])
  const favoriteDirs = useMemo(() => allDirs(favoriteNodes), [favoriteNodes])
  const topicRecords = useSyncExternalStore(indexSource.subscribe, () => indexSource.records)

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
  // missed events, and refreshes at once. Any other burst (git pull, Finder copy, bulk rename) is
  // ONE read, 100 ms after its last event (YAZ-2191): it used to be one full vault walk per event.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = watch.subscribe((ev) => {
      if (ev.type === 'error') return setError(ev.message)
      if (ev.type === 'change') return
      if (timer !== null) clearTimeout(timer)
      timer = null
      if (ev.type === 'ready') return refresh()
      timer = setTimeout(() => {
        timer = null
        refresh()
      }, STRUCTURAL_REFRESH_MS)
    })
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [watch, refresh])

  useEffect(() => {
    // Idempotent like its Topics twin below (⚡ YAZ-874): the first render holds exactly what was
    // just read, and re-sending it would make the main process commit, write and broadcast for nothing.
    if (sameList(storage.getExpanded(root), expanded)) return
    storage.setExpanded(root, expanded)
  }, [root, expanded])

  // Focus Mode's write-back (YAZ-1605), idempotent like the two above it — into this window's
  // identity (YAZ-1628), not the vault bucket.
  useEffect(() => {
    if (sameList(storage.getFocusDirs(), focusDirs)) return
    storage.setFocusDirs(focusDirs)
  }, [focusDirs])
  useEffect(() => {
    if (sameList(storage.getFocusTopics(), focusTopics)) return
    storage.setFocusTopics(focusTopics)
  }, [focusTopics])
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

  // The Topics bucket's write-back, `expanded`'s twin (🔒 D4) — it came up from the tree with the
  // state in ⚡ YAZ-873, unchanged. Idempotent: the first render after a mount holds exactly what
  // was just read, and re-sending it would make the main process commit, write and broadcast for
  // nothing — including on every Files-lens mount, where the tree is not even on screen.
  useEffect(() => {
    const next = [...topicsExpanded]
    if (sameList(storage.getTopicsExpanded(root), next)) return
    storage.setTopicsExpanded(root, next)
  }, [root, topicsExpanded])

  // The file this mount woke up with is SHOWN, not revealed (YAZ-1642): a relaunch restores the
  // tab and leaves the tree collapsed. Any file opened after that still opens its folders.
  const restoredFile = useRef(activeFile)
  useEffect(() => {
    if (activeFile === restoredFile.current) return
    restoredFile.current = null
    if (activeFile !== null) dispatch({ type: 'expandTo', root, file: activeFile })
  }, [root, activeFile])

  // Focus Mode (YAZ-1605): a focus target that left the vault DROPS OUT — deleted, moved out, or a
  // topic that lost its flag — and the last one leaving ends the focus: never an empty tree under a
  // lit eye. The store repairs the FILE on delete; this component holds its own copy, so it prunes
  // against the live tree / index itself, exactly as the selection does above.
  useEffect(() => {
    if (tree === null || focusDirs.length === 0) return
    const kept = focusDirs.filter((dir) => findDirNode(tree.tree, dir) !== null)
    if (kept.length !== focusDirs.length) setFocusDirs(kept)
  }, [tree, focusDirs])
  useEffect(() => {
    if (focusTopics.length === 0 || topicRecords.length === 0) return // the empty pre-index snapshot must not clear a restored focus
    const kept = focusTopics.filter((page) => topicRecords.some((r) => r.path === page && isFolderPage(r)))
    if (kept.length !== focusTopics.length) setFocusTopics(kept)
  }, [topicRecords, focusTopics])
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
  const validated = useRef(false)
  useEffect(() => {
    if (tree === null || validated.current) return
    validated.current = true
    if (activeFile !== null && activeFile.startsWith(`${root.replace(/\/+$/, '')}/`) && !treeHasFile(tree.tree, activeFile))
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
    if (treeRef.current !== null && treeHasFile(treeRef.current.tree, activeFile)) return
    let cancelled = false // the activation moved on (or the sidebar unmounted): the probe's verdict is stale
    fetchTree(root).then(
      (res) => {
        if (!cancelled && !treeHasFile(res.tree, activeFile)) onFileMissing()
      },
      () => undefined, // a root-level failure is refresh()'s problem, not this probe's
    )
    return () => {
      cancelled = true
    }
  }, [activeFile, root, onFileMissing])

  /**
   * Focus Mode (YAZ-1605): narrow `inLens` — the menu's pinned lens, FILES for a search row (🔒 D1,
   * YAZ-2050) — to these folders / topics, REPLACING any focus,
   * one or many — and OPEN each row (the synthetic-child idiom `startCreate` uses), so the tree
   * never lands on closed chevrons.
   */
  const focusOn = useCallback(
    (paths: string[], inLens: SidebarLens) => {
      if (inLens === 'topics') {
        setFocusTopics(paths)
        setTopicsExpanded((prev) => (paths.every((p) => prev.has(p)) ? prev : new Set([...prev, ...paths])))
      } else {
        // Favorites keeps its OWN list (YAZ-1766 D5); both disk lenses share the one expansion (D7).
        if (inLens === 'favorites') setFocusFavorites(paths)
        else setFocusDirs(paths)
        for (const path of paths) dispatch({ type: 'expandTo', root, file: `${path}/x` })
      }
    },
    [root],
  )
  const focused = lens === 'topics' ? focusTopics.length > 0 : lens === 'favorites' ? focusFavorites.length > 0 : focusNodes.length > 0
  const exitFocus = useCallback(() => (lens === 'topics' ? setFocusTopics([]) : lens === 'favorites' ? setFocusFavorites([]) : setFocusDirs([])), [lens])

  /**
   * The favorite toggle (YAZ-1766 D3/D6): remove every path, or append the ones not yet pinned —
   * insertion order, no duplicates. `isOn` arrives with the paths (the folder-page toggle's idiom).
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

  return { tree, error, refresh, expanded, dispatch, expandedSet, toggleDir, topicsExpanded, setTopicsExpanded, focusDirs, setFocusDirs, focusTopics, focusFavorites, focusNodes, focused, focusOn, exitFocus, favorites, favoritesRef, saveFavorites, toggleFavorite, dirs, shownDirs, favoriteNodes, favoriteDirs, topicRecords }
}
