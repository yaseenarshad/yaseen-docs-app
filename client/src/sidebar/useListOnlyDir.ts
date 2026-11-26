import { useEffect, useMemo, useRef, useState } from 'react'
import { rootOfPath, type FocusFolder, type SidebarTab, type TreeNode } from '@shared/types'
import { favoriteRoots, findDirNode } from '../lib/treeState'
import { resolveItem } from '../lists/focusFolders'
import { isDiskFolderPath } from './filesOnly'

/** Session-only `focusOnly` + `filesOnly` state for a window, clearing disk paths when their vault leaves (YAZ-5790, YAZ-6577). */
export function useOnlyFolderPair(roots: readonly string[]) {
  const [focusOnly, setFocusOnly] = useState<string | null>(null)
  const focusOnlyValid = focusOnly !== null && isDiskFolderPath(focusOnly) && rootOfPath(roots, focusOnly) === null ? null : focusOnly
  useEffect(() => {
    if (focusOnly !== null && focusOnlyValid === null) setFocusOnly(null)
  }, [focusOnly, focusOnlyValid])

  const [filesOnly, setFilesOnly] = useState<string | null>(null)
  const filesOnlyValid = filesOnly !== null && rootOfPath(roots, filesOnly) !== null ? filesOnly : null
  useEffect(() => {
    if (filesOnly !== null && filesOnlyValid === null) setFilesOnly(null)
  }, [filesOnly, filesOnlyValid])

  return { focusOnly, focusOnlyValid, setFocusOnly, filesOnly, filesOnlyValid, setFilesOnly }
}

interface UseListOnlyDirArgs {
  focusOnly: string | null
  onlyFolder: FocusFolder | undefined
  forest: readonly TreeNode[] | null
  lens: SidebarTab
  favoriteNodes: readonly TreeNode[]
  focusNodes: readonly TreeNode[]
  folders: readonly FocusFolder[]
  roots: readonly string[]
  loaded: boolean
  openTo: (path: string, top?: string) => void
  onFocusOnly?: (id: string | null) => void
}

/**
 * Resolves "Hide all others" on a disk folder in Favorites or Focus (YAZ-6574), auto-expands it once on entry,
 * and clears `focusOnly` if the isolated folder leaves the current list while staying on the same tab (YAZ-6577).
 */
export function useListOnlyDir({ focusOnly, onlyFolder, forest, lens, favoriteNodes, focusNodes, folders, roots, loaded, openTo, onFocusOnly }: UseListOnlyDirArgs): TreeNode | null {
  const onlyListDir = useMemo(() => {
    if (focusOnly === null || onlyFolder !== undefined || forest === null || (lens !== 'favorites' && lens !== 'focus')) return null
    const listNodes = lens === 'favorites' ? favoriteNodes : focusNodes
    const topHit = findDirNode(listNodes, focusOnly)
    if (topHit !== null) return topHit
    for (const folder of folders) {
      const paths = folder.items.map((item) => resolveItem(item, roots)).flatMap((r) => ('path' in r ? [r.path] : []))
      const subHit = findDirNode(favoriteRoots(forest, paths), focusOnly)
      if (subHit !== null) return subHit
    }
    return null
  }, [focusOnly, onlyFolder, forest, lens, favoriteNodes, focusNodes, folders, roots])

  const prevOnlyListDir = useRef<string | null>(null)
  const activeListDirRef = useRef<{ lens: 'favorites' | 'focus'; only: string } | null>(null)
  useEffect(() => {
    const dir = onlyListDir?.path ?? null
    if (dir !== null && prevOnlyListDir.current !== dir) openTo(`${dir}/x`, dir)
    prevOnlyListDir.current = dir
    if (dir !== null && focusOnly !== null && (lens === 'favorites' || lens === 'focus')) {
      activeListDirRef.current = { lens, only: focusOnly }
    } else if (loaded && forest !== null && focusOnly !== null && activeListDirRef.current !== null && activeListDirRef.current.lens === lens && activeListDirRef.current.only === focusOnly) {
      activeListDirRef.current = null
      onFocusOnly?.(null)
    } else if (focusOnly === null) {
      activeListDirRef.current = null
    }
  }, [onlyListDir, openTo, loaded, forest, focusOnly, lens, onFocusOnly])

  return onlyListDir
}
