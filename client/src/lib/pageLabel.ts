import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { rootOfPath, type TreeResponse } from '@shared/types'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { fetchTree, latestTree, onTree } from './treeFeed'
import { findDirNode, treeHasFile } from './treeState'
import { NO_TITLES, fileLabel, pageLabel, pathTitles, type PathTitles } from './pathTitles'

// The titles of paths moved to their own file (YAZ-5161), so code the phone shares reads them with no bridge; the names stay here too.
export { fileLabel, pageLabel, pathTitles, type PathTitles }

/**
 * Whether `path` is a FOLDER, by the window's newest Files tree (YAZ-2290 D3). Only the tree can
 * say: a folder may be named `Pages.md`. False until the first tree answers.
 */
export function isFolderPath(root: string | null, path: string): boolean {
  if (root === null) return false
  // The vault root is a folder with no row of its own (YAZ-4921): its page is a tab, as any folder's.
  if (isVaultRoot(root, path)) return true
  const tree = latestTree(root)
  return tree !== null && findDirNode(tree.tree, path) !== null
}

/** `path` is the vault `root` itself (YAZ-4921), a trailing slash on the root aside. */
export const isVaultRoot = (root: string, path: string): boolean => path === root.replace(/\/+$/, '')

/** `pageLabel` of a path the Files tree says the kind of (`isFolderPath`). */
export const pageName = (root: string | null, path: string, titles: PathTitles): string => pageLabel(path, isFolderPath(root, path), titles)

/** The source's `PathTitles`, live. */
export const usePathTitles = (source: WikilinkResolveSource): PathTitles => useSyncExternalStore(source.subscribe, () => pathTitles(source.records, source.folders))

/**
 * One `PathTitles` over the index of every vault of the window (YAZ-2602 D1), live: the strip, the
 * right panel and the sheets name a page of any vault. The paths of two vaults never meet, so the
 * maps add up. One vault → that vault's own Map, as `usePathTitles`; more → a Map that is kept
 * while no title changed, whichever vault's snapshot landed.
 */
export function useAllPathTitles(sources: readonly WikilinkResolveSource[]): PathTitles {
  const subscribe = useCallback(
    (poke: () => void) => {
      const offs = sources.map((source) => source.subscribe(poke))
      return () => offs.forEach((off) => off())
    },
    [sources],
  )
  const held = useRef<{ parts: readonly PathTitles[]; all: PathTitles }>({ parts: [], all: NO_TITLES })
  return useSyncExternalStore(subscribe, () => {
    const parts = sources.map((source) => pathTitles(source.records, source.folders))
    if (parts.length === 1) return parts[0]
    const last = held.current
    if (parts.length === last.parts.length && parts.every((part, i) => part === last.parts[i])) return last.all
    const built = new Map(parts.flatMap((part) => [...part]))
    const same = built.size === last.all.size && [...built].every(([path, title]) => last.all.get(path) === title)
    held.current = { parts, all: same ? last.all : built }
    return held.current.all
  })
}

/** The subscribe half of `useTreeKind`: a tree for `root` landed. */
const useTreeLanded = (root: string) => useCallback((poke: () => void) => onTree(root, poke), [root])

/**
 * The newest Files tree of each of `roots`, off the window's one feed; null until a vault's first
 * tree answers. Live: the component re-renders when a tree for any of `roots` lands, and the list is
 * the same one until then.
 */
export function useLatestTrees(roots: readonly string[]): readonly (TreeResponse | null)[] {
  const subscribe = useCallback(
    (poke: () => void) => {
      const offs = roots.map((root) => onTree(root, poke))
      return () => offs.forEach((off) => off())
    },
    [roots],
  )
  const held = useRef<readonly (TreeResponse | null)[]>([])
  return useSyncExternalStore(subscribe, () => {
    const trees = roots.map(latestTree)
    if (trees.length !== held.current.length || trees.some((tree, i) => tree !== held.current[i])) held.current = trees
    return held.current
  })
}

/**
 * `isFolderPath` for a component that shows pages of every vault of the window (YAZ-2602 S31): each
 * path is asked of the tree of the vault that holds it, and one in no vault of the first. The
 * component re-renders when a tree for any of `roots` lands, so its labels follow the trees.
 */
export function useFolderPaths(roots: readonly string[]): (path: string) => boolean {
  useLatestTrees(roots)
  return (path) => isFolderPath(rootOfPath(roots, path) ?? roots[0] ?? null, path)
}

/**
 * What `path` is by the window's newest Files tree, off its one feed (YAZ-2191): a folder, a file,
 * or neither; null until a tree can say. A tab opened later reads the tree the sidebar already
 * holds. A tree that holds the path as neither may only be BEHIND: an in-app folder rename retargets
 * the tab before the tree that shows the new name lands, and a folder may be named `Pages.md`. So
 * nothing is said until a tree asked for NOW answers — the stale-tab probe's rule (`useVaultTree.ts`).
 */
export function useTreeKind(root: string, path: string): 'dir' | 'file' | 'none' | null {
  // The vault root itself (YAZ-4921): a folder the tree never lists, so no tree is waited for.
  const isRoot = isVaultRoot(root, path)
  const held = useSyncExternalStore(useTreeLanded(root), () => {
    if (isRoot) return 'dir'
    const tree = latestTree(root)
    if (tree === null) return null
    return findDirNode(tree.tree, path) !== null ? 'dir' : treeHasFile(tree.tree, path) ? 'file' : 'none'
  })
  const listed = held === 'dir' || held === 'file'
  /** The path a tree has answered for: one it lists, or one asked about since it was opened. */
  const [answered, setAnswered] = useState<string | null>(null)
  useEffect(() => {
    if (listed) return setAnswered(path)
    let cancelled = false
    const done = (): void => {
      if (!cancelled) setAnswered(path)
    }
    fetchTree(root).then(done, done)
    return () => {
      cancelled = true
    }
  }, [root, path, listed])
  return listed || answered === path ? held : null
}
