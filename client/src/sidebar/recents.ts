import { rootOfPath, type TreeNode, type TreeResponse } from '@shared/types'
import type { IdsInFiles } from '@shared/showIds'
import type { MenuSection } from './menuSections'

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

/** One vault's files inside one day of the Recents tab (YAZ-4450 D7). */
export interface RecentGroup {
  root: string
  files: RecentFile[]
}

/**
 * Pure (YAZ-4450 D7, D8): a day's files (newest first) cut by the vault that holds each — the most specific one, as
 * everywhere — in the window's vault order; each group stays newest first, and a vault with no file that day has none.
 */
export function byVault(files: readonly RecentFile[], roots: readonly string[]): RecentGroup[] {
  const groups = roots.map((root) => ({ root, files: [] as RecentFile[] }))
  for (const file of files) groups[roots.indexOf(rootOfPath(roots, file.path) ?? roots[0])].files.push(file)
  return groups.filter((group) => group.files.length > 0)
}

const RECENTS_ID_CHOICES: readonly [IdsInFiles, string][] = [
  ['off', 'Off'],
  ['number', 'Number (#12)'],
  ['full', 'Full ID'],
]

/** Builds the Recents menu's "Show IDs" option when at least one non-app vault in the window has IDs enabled (YAZ-6537). */
export function recentsIdsOption(
  vaults: readonly { app?: boolean; index: { ids: boolean }; idsInRecents?: IdsInFiles; setIdsInRecents?: (next: IdsInFiles) => void }[],
): { value: IdsInFiles; set: (next: IdsInFiles) => void } | undefined {
  const idVaults = vaults.filter((v) => v.app !== true && v.index.ids)
  if (idVaults.length === 0) return undefined
  return {
    value: idVaults[0].idsInRecents ?? 'off',
    set: (next: IdsInFiles) => {
      for (const vault of idVaults) vault.setIdsInRecents?.(next)
    },
  }
}

/**
 * The Recents menu (YAZ-4450 D5, D7; YAZ-6537): "All vaults" apart, then each vault of the window by its name, ✓ on the pick;
 * display switches ("Show last updated", "Show IDs"), the Type flyout, then "Group by vault" while all vaults show.
 */
export function recentSections(
  vaults: readonly { root: string; name: string }[],
  pick: string | null,
  onPick: (root: string | null) => void,
  grouped: { on: boolean; set: (on: boolean) => void },
  type?: MenuSection[number],
  options?: { dates?: { on: boolean; set: (on: boolean) => void }; ids?: { value: IdsInFiles; set: (next: IdsInFiles) => void } },
): MenuSection[] {
  // The vault rows and the grouping are a workspace's (two or more vaults); display toggles and Type are every window's.
  const workspace = vaults.length > 1
  const row = (root: string | null, label: string) => ({ id: `recents-vault-${root ?? 'all'}`, label, hint: pick === root ? '✓' : undefined, onSelect: () => onPick(root) })
  const dates = options?.dates
  const ids = options?.ids
  const shown: MenuSection = [
    ...(dates === undefined ? [] : [{ id: 'recents-dates', label: 'Show last updated', hint: dates.on ? '✓' : undefined, onSelect: () => dates.set(!dates.on) }]),
    ...(ids === undefined
      ? []
      : [
          {
            id: 'recents-ids',
            label: 'Show IDs',
            hint: RECENTS_ID_CHOICES.find(([value]) => value === ids.value)?.[1],
            children: [
              RECENTS_ID_CHOICES.map(([value, label]) => ({
                id: `recents-ids-${value}`,
                label,
                hint: ids.value === value ? '✓' : undefined,
                onSelect: () => {
                  if (ids.value !== value) ids.set(value)
                },
              })),
            ],
          },
        ]),
  ]
  const group = workspace && pick === null ? [[{ id: 'recents-group', label: 'Group by vault', hint: grouped.on ? '✓' : undefined, onSelect: () => grouped.set(!grouped.on) }]] : []
  return [
    ...(workspace ? [[row(null, 'All vaults')], vaults.map((vault) => row(vault.root, vault.name))] : []),
    ...(shown.length > 0 ? [shown] : []),
    ...(type === undefined ? [] : [[type]]),
    ...group,
  ]
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
 * `only` (YAZ-4450 D5) keeps the files that vault holds, the most specific one — the rule of its Recents group (D7) —
 * before the cut, so a picked vault shows its own 200. `accept` (the Type filter, YAZ-4450 demo) runs before the cut too.
 */
export function recentFiles(trees: ReadonlyMap<string, TreeResponse>, roots: readonly string[], edits: readonly Readonly<Record<string, number>>[], only: string | null = null, accept?: (path: string) => boolean): RecentFile[] {
  const newest = new Map<string, number>()
  roots.forEach((root, i) => {
    const landed = trees.get(root)
    const log = edits[i]
    if (landed === undefined || log === undefined) return
    const files = filesOf(landed)
    for (const [path, edited] of Object.entries(log)) {
      if (!files.has(path) || (only !== null && rootOfPath(roots, path) !== only) || (accept !== undefined && !accept(path))) continue
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
