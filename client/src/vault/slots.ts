import { MAX_WINDOW_ROOTS } from '@shared/types'

/**
 * The slots of a window (YAZ-2602 D1). `App` holds one vault scope per slot, a fixed number of
 * hook calls on every render, and a slot holds one vault of the window or nothing. A vault KEEPS
 * its slot while it is in the window: its watcher, its index and its link sources are the slot's,
 * so a vault that moved to another slot would load again under every editor it has open.
 */
export type VaultSlots = readonly (string | null)[]

export const EMPTY_SLOTS: VaultSlots = Array.from({ length: MAX_WINDOW_ROOTS }, () => null)

/**
 * The slots for `roots`, given the slots before: a vault that stays keeps its slot, a vault that
 * left frees it, and a new vault takes the first free one. The same vaults give `prev` itself back.
 */
export function assignSlots(prev: VaultSlots, roots: readonly string[]): VaultSlots {
  const next = prev.map((root) => (root !== null && roots.includes(root) ? root : null))
  for (const root of roots) {
    if (next.includes(root)) continue
    const free = next.indexOf(null)
    if (free === -1) break // more vaults than slots: `normalizeRoots` cuts the list before it gets here
    next[free] = root
  }
  return next.every((root, i) => root === prev[i]) ? prev : next
}

/** `root` after the folder `oldDir` became `newDir`: the folder itself or a path under it follows, by segment. */
export const movedRoot = (root: string, oldDir: string, newDir: string): string =>
  root === oldDir || root.startsWith(`${oldDir}/`) ? newDir + root.slice(oldDir.length) : root

/** A folder was renamed (`file:renamed`): a vault that moved with it keeps its slot under its new path. */
export function renameSlots(prev: VaultSlots, oldDir: string, newDir: string): VaultSlots {
  const next = prev.map((root) => (root === null ? null : movedRoot(root, oldDir, newDir)))
  return next.every((root, i) => root === prev[i]) ? prev : next
}
