import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_WINDOW_ROOTS, rootOfPath, type IndexRecord, type TreeResponse } from '@shared/types'
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
const NO_TITLES: PathTitles = new Map()
/**
 * The Map last built for each vault of the window (YAZ-2602 D1), newest first. A snapshot does not
 * say whose it is, and need not: the paths of two vaults never meet, so the Map that holds a
 * snapshot's first path is its own vault's.
 */
const latest: PathTitles[] = []

/**
 * The index snapshot as `PathTitles`: a folder's record is its `.folder.md`, so its directory is the
 * key. Built once per snapshot — keyed by the identity of its two arrays, as `rowsByFolder` is —
 * because every rendered id link, each label holder and each notice asks. A snapshot that changed
 * no title keeps the Map its vault's last one had, so a save elsewhere in the vault — or in another
 * vault of the window — re-renders nothing that shows a name (YAZ-2194).
 */
export function pathTitles(records: readonly IndexRecord[], folders: readonly IndexRecord[]): PathTitles {
  let byFolders = titlesCache.get(records)
  if (byFolders === undefined) titlesCache.set(records, (byFolders = new WeakMap()))
  let titles = byFolders.get(folders)
  if (titles === undefined) {
    const built = new Map<string, string>()
    for (const record of records) built.set(record.path, record.title)
    for (const folder of folders) built.set(dirname(folder.path), folder.title)
    const [path] = built.keys()
    const at = path === undefined ? -1 : latest.findIndex((held) => held.has(path))
    const last = path === undefined ? NO_TITLES : latest[at]
    if (last !== undefined && built.size === last.size && [...built].every(([key, title]) => last.get(key) === title)) titles = last
    else {
      // Its vault's newer Map takes the older one's place; a vault not seen before joins the list.
      if (at !== -1) latest.splice(at, 1)
      latest.unshift((titles = built))
      latest.length = Math.min(latest.length, MAX_WINDOW_ROOTS)
    }
    byFolders.set(folders, titles)
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
 * `isFolderPath` for a component that shows pages of every vault of the window (YAZ-2602 S31): each
 * path is asked of the tree of the vault that holds it, and one in no vault of the first. The
 * component re-renders when a tree for any of `roots` lands, so its labels follow the trees.
 */
export function useFolderPaths(roots: readonly string[]): (path: string) => boolean {
  const key = roots.join('\n')
  // Keyed by the vaults themselves: a caller may hand a new array of the same roots on each render.
  const subscribe = useCallback(
    (poke: () => void) => {
      const offs = (key === '' ? [] : key.split('\n')).map((root) => onTree(root, poke))
      return () => offs.forEach((off) => off())
    },
    [key],
  )
  const held = useRef<readonly (TreeResponse | null)[]>([])
  useSyncExternalStore(subscribe, () => {
    const trees = roots.map(latestTree)
    if (trees.length !== held.current.length || trees.some((tree, i) => tree !== held.current[i])) held.current = trees
    return held.current
  })
  return (path) => isFolderPath(rootOfPath(roots, path) ?? roots[0] ?? null, path)
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
