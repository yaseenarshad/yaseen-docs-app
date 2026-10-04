import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { basename, stripExt } from './paths'
import { fetchTree, latestTree, onTree } from './treeFeed'
import { findDirNode, treeHasFile } from './treeState'

/**
 * Whether `path` is a FOLDER, by the window's newest Files tree (YAZ-2290 D3). Only the tree can
 * say: a folder may be named `Notes.md`. False until the first tree answers.
 */
export function isFolderPath(root: string | null, path: string): boolean {
  const tree = root === null ? null : latestTree(root)
  return tree !== null && findDirNode(tree.tree, path) !== null
}

/**
 * A tab path as a NAME, wherever one is shown: the tab strip, the right panel, the window title.
 * A file hides Markdown's extension; a folder's label is its whole name (YAZ-2290).
 */
export const pageLabel = (path: string, folder: boolean): string => (folder ? basename(path) : stripExt(basename(path)))

/** The subscribe half of both hooks below: a tree for `root` landed. */
const useTreeLanded = (root: string) => useCallback((poke: () => void) => onTree(root, poke), [root])

/** `isFolderPath` for a component: it re-renders when a tree for `root` lands, so its labels follow the tree. */
export function useFolderPaths(root: string): (path: string) => boolean {
  useSyncExternalStore(useTreeLanded(root), () => latestTree(root))
  return (path) => isFolderPath(root, path)
}

/**
 * What `path` is by the window's newest Files tree, off its one feed (YAZ-2191): a folder, a file,
 * or neither; null until a tree can say. A tab opened later reads the tree the sidebar already
 * holds. A tree that holds the path as neither may only be BEHIND: an in-app folder rename retargets
 * the tab before the tree that shows the new name lands, and a folder may be named `Notes.md`. So
 * nothing is said until a tree asked for NOW answers — the stale-tab probe's rule (`useVaultTree.ts`).
 */
export function useTreeKind(root: string, path: string | null): 'dir' | 'file' | 'none' | null {
  const held = useSyncExternalStore(useTreeLanded(root), () => {
    const tree = latestTree(root)
    if (tree === null || path === null) return null
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
