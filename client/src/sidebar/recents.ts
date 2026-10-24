import type { TreeNode, TreeResponse } from '@shared/types'

/** The Recents tab shows this many files at most (YAZ-3235 D3): a fixed draw cost at any vault size. */
export const MAX_RECENTS = 200

/** One row of the Recents tab: a file, and when the app last saved it (ms). */
export interface RecentFile {
  path: string
  edited: number
}

/** One day of the Recents tab (YAZ-3235 D5): its key (`toDateString`), its heading, and its files, newest first. */
export interface RecentDay {
  key: string
  label: string
  files: RecentFile[]
}

// The files of each tree that the app opens (`kind !== null`), read once per tree: a new tree is a new object.
const fileSets = new WeakMap<TreeResponse, ReadonlySet<string>>()
function filesOf(landed: TreeResponse): ReadonlySet<string> {
  let files = fileSets.get(landed)
  if (files === undefined) {
    const found = new Set<string>()
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'dir') walk(node.children)
        else if (node.kind !== null) found.add(node.path)
      }
    }
    walk(landed.tree)
    fileSets.set(landed, (files = found))
  }
  return files
}

/**
 * Pure (YAZ-3235 D3, S14, S22): the logged files that the tree of their vault still has as a file the
 * app opens. `edits[i]` is the save log of `roots[i]`; a vault with no tree yet adds nothing. A file
 * that two nested vaults logged is one row, at its newest save. Newest save first, then by path; 200 at most.
 */
export function recentFiles(trees: ReadonlyMap<string, TreeResponse>, roots: readonly string[], edits: readonly Readonly<Record<string, number>>[]): RecentFile[] {
  const newest = new Map<string, number>()
  roots.forEach((root, i) => {
    const landed = trees.get(root)
    const log = edits[i]
    if (landed === undefined || log === undefined) return
    const files = filesOf(landed)
    for (const [path, edited] of Object.entries(log)) {
      if (!files.has(path)) continue
      const held = newest.get(path)
      if (held === undefined || edited > held) newest.set(path, edited)
    }
  })
  return [...newest]
    .map(([path, edited]) => ({ path, edited }))
    .sort((a, b) => b.edited - a.edited || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, MAX_RECENTS)
}

/** Midnight at the start of the day before `now`'s, local time. */
const dayBefore = (now: Date): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)

/**
 * Pure (YAZ-3235 D5, S15): `files` (newest first) cut into local days. The headings are "Today",
 * "Yesterday", then the date ("Mon, Oct 20"), with the year only when it is not the year of `now`.
 */
export function recentDays(files: readonly RecentFile[], now: Date): RecentDay[] {
  const today = now.toDateString()
  const yesterday = dayBefore(now).toDateString()
  const days: RecentDay[] = []
  for (const file of files) {
    const date = new Date(file.edited)
    const key = date.toDateString()
    const last = days[days.length - 1]
    if (last !== undefined && last.key === key) {
      last.files.push(file)
      continue
    }
    const label =
      key === today
        ? 'Today'
        : key === yesterday
          ? 'Yesterday'
          : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
    days.push({ key, label, files: [file] })
  }
  return days
}

/** The time of a save, as a row shows it on the right (YAZ-3235 D6): "3:42 PM". */
export const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
