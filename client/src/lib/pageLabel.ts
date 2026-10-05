import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { IndexRecord } from '@shared/types'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { basename, dirname, stripExt } from './paths'
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

/** Every note's and folder's title by its absolute path, a folder's by its directory's (YAZ-2420 🔒 D14). */
export type PathTitles = ReadonlyMap<string, string>

const titlesCache = new WeakMap<readonly IndexRecord[], WeakMap<readonly IndexRecord[], PathTitles>>()
let latest: PathTitles = new Map()

/**
 * The index snapshot as `PathTitles`: a folder's record is its `.folder.md`, so its directory is the
 * key. Built once per snapshot — keyed by the identity of its two arrays, as `rowsByFolder` is —
 * because every rendered id link, each label holder and each notice asks. A snapshot that changed
 * no title keeps the Map the last one had, so a save elsewhere in the vault re-renders nothing
 * that shows a name (YAZ-2194).
 */
export function pathTitles(records: readonly IndexRecord[], folders: readonly IndexRecord[]): PathTitles {
  let byFolders = titlesCache.get(records)
  if (byFolders === undefined) titlesCache.set(records, (byFolders = new WeakMap()))
  let titles = byFolders.get(folders)
  if (titles === undefined) {
    const built = new Map<string, string>()
    for (const record of records) built.set(record.path, record.title)
    for (const folder of folders) built.set(dirname(folder.path), folder.title)
    if (built.size !== latest.size || [...built].some(([path, title]) => latest.get(path) !== title)) latest = built
    byFolders.set(folders, (titles = latest))
  }
  return titles
}

/**
 * A path as a NAME, wherever one is shown: its title (YAZ-2420 🔒 D14). A path the index does not
 * hold (not loaded yet, a PDF, an image, a folder with no settings file) shows its file name: a
 * file hides Markdown's extension; a folder's label is its whole name (YAZ-2290).
 */
export const pageLabel = (path: string, folder: boolean, titles: PathTitles): string => titles.get(path) ?? (folder ? basename(path) : stripExt(basename(path)))

/** `pageLabel` of a path the Files tree says the kind of (`isFolderPath`). */
export const pageName = (root: string | null, path: string, titles: PathTitles): string => pageLabel(path, isFolderPath(root, path), titles)

/** The source's `PathTitles`, live. */
export const usePathTitles = (source: WikilinkResolveSource): PathTitles => useSyncExternalStore(source.subscribe, () => pathTitles(source.records, source.folders))

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
