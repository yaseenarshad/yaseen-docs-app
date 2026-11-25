import type { IdsInSearch } from '@shared/showIds'
import type { FileKind, SortBy, SortMenuTab, TabSort, TreeNode, TreeResponse } from '@shared/types'
import { inOrder } from '@shared/filesOrder'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import type { MenuSection } from './menuSections'

/** Names in reading order (YAZ-3227 D8): case-blind, and "Phase 2" before "Phase 10". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** A folder's time, once per node: a node never changes in place, so a new tree computes again. */
const newest = new WeakMap<TreeNode, number>()

/** A row's time for Last updated (D7): a file's mtime; a folder's newest file anywhere inside, 0 when empty. */
export function timeOf(node: TreeNode): number {
  if (node.type === 'file') return node.mtime
  let time = newest.get(node)
  if (time === undefined) {
    time = node.children.reduce((max, child) => Math.max(max, timeOf(child)), 0)
    newest.set(node, time)
  }
  return time
}

/** The score of a row that is no match and holds none: after every match (a row a folder that shows all holds, YAZ-2662 D6). */
const NO_SCORE = 4
const NO_BEST: ReadonlyMap<string, number> = new Map()

/** The groups of a level (D7): folders, then files. */
const typeRank = (node: TreeNode): number => (node.type === 'dir' ? 0 : 1)
/** The groups under Kind first (YAZ-4614 D66): folders, pages, drawings, diagrams, PDFs, images, text files, other files. */
const KIND_RANK: Record<FileKind, number> = { markdown: 1, drawing: 2, diagram: 3, pdf: 4, image: 5, text: 6 }
const OTHER_RANK = 7
const kindRank = (node: TreeNode): number => (node.type === 'dir' ? 0 : node.kind === null ? OTHER_RANK : KIND_RANK[node.kind])

/**
 * One level in the tab's order (D7): folders first, then files, each by the same rule. No sort, or Manual below the top rows: Name, A to Z.
 * Kind first (YAZ-4614 D66) splits the files by kind too; each group keeps the sort inside it, and a reverse flips the rows of a group, not the groups.
 * Best match (YAZ-3511 D12) is the search's alone: `best` holds the score of each row, lower first, then the newer row, then the name.
 * It puts no folder first, so the best match is on top.
 */
export function sortLevel(nodes: readonly TreeNode[], sort: TabSort | undefined, label: (node: TreeNode) => string, best: ReadonlyMap<string, number> = NO_BEST, listed?: readonly string[]): TreeNode[] {
  // Files under Manual (YAZ-5916 D1, D3): the folder's own order, by item name; an item it does not name goes last, in
  // the Name order (folders first, Kind first's groups when on). Folders and files mix as the person put them.
  if (sort?.by === 'manual' && listed !== undefined) {
    const named = sortLevel(nodes, { by: 'name', reverse: false, ...(sort.kinds === true ? { kinds: true } : {}) }, label)
    const rank = new Map(named.map((node, i) => [node, i]))
    return inOrder(nodes, (node) => node.name, listed, (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
  }
  const byName = (a: TreeNode, b: TreeNode): number => collator.compare(label(a), label(b))
  const byTime = (a: TreeNode, b: TreeNode): number => timeOf(b) - timeOf(a) || byName(a, b)
  if (sort?.by === 'best') {
    const score = (node: TreeNode): number => best.get(node.path) ?? NO_SCORE
    return [...nodes].sort((a, b) => score(a) - score(b) || byTime(a, b))
  }
  const base = sort?.by === 'updated' ? byTime : byName
  const order = sort?.reverse === true && sort.by !== 'manual' ? (a: TreeNode, b: TreeNode): number => base(b, a) : base
  // Each row's group once, never in the comparator (YAZ-4614): the groups sort one by one, so the order inside a group is the sort's alone.
  const rank = sort?.kinds === true ? kindRank : typeRank
  const groups: (TreeNode[] | undefined)[] = []
  for (const node of nodes) (groups[rank(node)] ??= []).push(node)
  return groups.flatMap((group) => group?.sort(order) ?? [])
}

/** The label a row shows (YAZ-2420 🔒 D15), which Name sorts by (D8). */
export const shownLabel = (titles: PathTitles) => (node: TreeNode): string => pageLabel(node.path, node.type === 'dir', titles)

/**
 * The levels that keep the order they came in, whatever the sort: the top rows of a Manual list (D6), the vault rows
 * (YAZ-2631 D3) and the search's pinned items, focus before favorites (YAZ-2662 D3). `Tree` draws by this rule, and the
 * search's ↑/↓ walk by it (YAZ-3511 D4), so the two never disagree.
 */
export function keepsOrder(depth: number, sort: TabSort, at: { keepTop?: boolean; copies?: boolean; vaults: boolean }): boolean {
  return depth === 0 && (at.keepTop === true || (at.copies === true ? sort.by === 'manual' : at.vaults))
}

/** No app vault rows: a Tree with none (every tab but the Files tree and its search). */
export const NO_APP_ROWS: ReadonlySet<string> = new Set()

/**
 * A level as it is drawn, with the app's own vault rows (the card skill, YAZ-5108) LAST at the top: they never sort
 * among the person's rows, and `order` (the tab's sort, or none) orders the others as it would without them.
 */
export function appRowsLast(nodes: readonly TreeNode[], depth: number, appRows: ReadonlySet<string>, order: (nodes: readonly TreeNode[]) => readonly TreeNode[]): readonly TreeNode[] {
  if (depth !== 0 || appRows.size === 0) return order(nodes)
  const own = nodes.filter((node) => !appRows.has(node.path))
  return own.length === nodes.length ? order(nodes) : [...order(own), ...nodes.filter((node) => appRows.has(node.path))]
}

const swap = (nodes: TreeNode[], at: number, node: TreeNode): TreeNode[] => nodes.map((n, i) => (i === at ? node : n))

/** `trees` with one file's mtime changed (D2). A node off the file's path keeps its identity, so only that path's levels draw again (YAZ-2194). */
export function withMtime(trees: ReadonlyMap<string, TreeResponse>, vault: string, file: string, mtime: number): ReadonlyMap<string, TreeResponse> {
  const held = trees.get(vault)
  if (held === undefined) return trees
  const patch = (nodes: TreeNode[]): TreeNode[] => {
    const at = nodes.findIndex((n) => n.path === file || file.startsWith(`${n.path}/`))
    if (at === -1) return nodes
    const node = nodes[at]
    if (node.type === 'file') return node.mtime === mtime ? nodes : swap(nodes, at, { ...node, mtime })
    const children = patch(node.children)
    return children === node.children ? nodes : swap(nodes, at, { ...node, children })
  }
  const tree = patch(held.tree)
  return tree === held.tree ? trees : new Map(trees).set(vault, { ...held, tree })
}

const BY_LABEL: Record<SortBy, string> = { manual: 'Manual', name: 'Name', updated: 'Last updated', best: 'Best match' }
/** The two ways of each sort (D4): the natural way first. Best match has one way: the best first (YAZ-3511 D12). */
const WAYS: Partial<Record<SortBy, readonly [string, string]>> = { name: ['A to Z', 'Z to A'], updated: ['Newest first', 'Oldest first'] }
/** What each tab sorts by (D4): Search has no drag order, so no Manual (YAZ-3511 D4); Best match is Search's (D12). Files has Manual since YAZ-5916, last: its old two keep their places. */
const BYS: Record<SortMenuTab, readonly SortBy[]> = { files: ['name', 'updated', 'manual'], focus: ['manual', 'name', 'updated'], favorites: ['manual', 'name', 'updated'], search: ['best', 'name', 'updated'] }

/** The Search menu's "Show IDs" flyout choices (YAZ-6502): synced with Settings › Links & IDs › Show IDs in search. */
const SEARCH_ID_CHOICES: ReadonlyArray<[IdsInSearch, string]> = [
  ['off', 'Off'],
  ['number', 'Number (#12)'],
  ['full', 'Full ID'],
  ['match', 'Only on ID match'],
]

/**
 * The sort menu (D4): what to sort by, then, where the sort has two, which way. ✓ marks the current pick (Draw's YAZ-1835 D5).
 * A new sort starts its natural way; the current one keeps its way, and a pick that changes nothing writes nothing.
 * `dates` is the last row of each tab's menu (YAZ-3511 D7, D10): the date at the right end of each row, on or off.
 * `searchIds` is the Search menu's independent "Show IDs" flyout (YAZ-6502), present only when at least one vault in the window has IDs enabled.
 * `filters` are the Search menu's Type and Time rows (D13, D14), after it. `workspace` is the Focus and Favorites menus' last row in a
 * window with two or more vaults (YAZ-4450 D4): "Separate list for workspaces", on or off.
 * "Kind first" (YAZ-4614 D66) follows "Show last updated" on the sorted tabs, not Search: a click flips the tab's `kinds` in one write.
 */
export function sortSections(
  tab: SortMenuTab,
  sort: TabSort,
  set: (next: TabSort) => void,
  dates: { on: boolean; set: (on: boolean) => void },
  filters?: MenuSection,
  workspace?: { on: boolean; set: (on: boolean) => void },
  searchIds?: { value: IdsInSearch; set: (next: IdsInSearch) => void },
): MenuSection[] {
  const pick = (next: TabSort) => () => {
    if (next.by !== sort.by || next.reverse !== sort.reverse) set(next)
  }
  // A new sort starts its natural way and keeps the tab's Kind first (YAZ-4614 D66: each tab's on/off is its own).
  const by = BYS[tab].map((b) => ({ id: `sort-${b}`, label: BY_LABEL[b], hint: sort.by === b ? '✓' : undefined, onSelect: pick(sort.by === b ? sort : { ...sort, by: b, reverse: false }) }))
  const ways = (WAYS[sort.by] ?? []).map((label, i) => ({ id: `sort-way-${i}`, label, hint: sort.reverse === (i === 1) ? '✓' : undefined, onSelect: pick({ ...sort, reverse: i === 1 }) }))
  const searchIdsRow: MenuSection =
    tab === 'search' && searchIds !== undefined
      ? [
          {
            id: 'sort-ids',
            label: 'Show IDs',
            hint: SEARCH_ID_CHOICES.find(([value]) => value === searchIds.value)?.[1],
            children: [
              SEARCH_ID_CHOICES.map(([value, label]) => ({
                id: `sort-ids-${value}`,
                label,
                hint: searchIds.value === value ? '✓' : undefined,
                onSelect: () => {
                  if (searchIds.value !== value) searchIds.set(value)
                },
              })),
            ],
          },
        ]
      : []
  const shown: MenuSection = [
    { id: 'sort-dates', label: 'Show last updated', hint: dates.on ? '✓' : undefined, onSelect: () => dates.set(!dates.on) },
    ...searchIdsRow,
    ...(tab === 'search' ? [] : [{ id: 'sort-kinds', label: 'Kind first', hint: sort.kinds === true ? '✓' : undefined, onSelect: () => set({ ...sort, kinds: sort.kinds !== true }) }]),
  ]
  const separate = workspace === undefined ? [] : [[{ id: 'sort-workspace', label: 'Separate list for workspaces', hint: workspace.on ? '✓' : undefined, onSelect: () => workspace.set(!workspace.on) }]]
  return [by, ...(ways.length > 0 ? [ways] : []), shown, ...(filters === undefined ? [] : [filters]), ...separate]
}

/** Builds the Search menu's "Show IDs" option when at least one non-app vault in the window has IDs enabled (YAZ-6502). */
export function searchIdsOption(
  vaults: readonly { app?: boolean; index: { ids: boolean }; idsInSearch?: () => IdsInSearch; setIdsInSearch?: (next: IdsInSearch) => void }[],
): { value: IdsInSearch; set: (next: IdsInSearch) => void } | undefined {
  const idVaults = vaults.filter((v) => v.app !== true && v.index.ids)
  if (idVaults.length === 0) return undefined
  return {
    value: idVaults[0].idsInSearch?.() ?? 'number',
    set: (next: IdsInSearch) => {
      for (const vault of idVaults) vault.setIdsInSearch?.(next)
    },
  }
}
