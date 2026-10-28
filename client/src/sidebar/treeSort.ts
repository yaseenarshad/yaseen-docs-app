import type { SortBy, SortMenuTab, TabSort, TreeNode, TreeResponse } from '@shared/types'
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

/**
 * One level in the tab's order (D7): folders first, then files, each by the same rule. No sort, or Manual below the top rows: Name, A to Z.
 * Best match (YAZ-3511 D12) is the search's alone: `best` holds the score of each row, lower first, then the newer row, then the name.
 * It puts no folder first, so the best match is on top.
 */
export function sortLevel(nodes: readonly TreeNode[], sort: TabSort | undefined, label: (node: TreeNode) => string, best?: ReadonlyMap<string, number>): TreeNode[] {
  const byName = (a: TreeNode, b: TreeNode): number => collator.compare(label(a), label(b))
  const byTime = (a: TreeNode, b: TreeNode): number => timeOf(b) - timeOf(a) || byName(a, b)
  if (sort?.by === 'best' && best !== undefined) {
    const score = (node: TreeNode): number => best.get(node.path) ?? NO_SCORE
    return [...nodes].sort((a, b) => score(a) - score(b) || byTime(a, b))
  }
  const base = sort?.by === 'updated' ? byTime : byName
  const order = sort?.reverse === true && sort.by !== 'manual' ? (a: TreeNode, b: TreeNode): number => base(b, a) : base
  return [...nodes.filter((n) => n.type === 'dir').sort(order), ...nodes.filter((n) => n.type === 'file').sort(order)]
}

/** The score of a row that is no match and holds none: after every match (a row a folder that shows all holds, YAZ-2662 D6). */
const NO_SCORE = 4

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
/** What each tab sorts by (D4): Files and Search have no drag order, so no Manual (YAZ-3511 D4); Best match is Search's (D12). */
const BYS: Record<SortMenuTab, readonly SortBy[]> = { files: ['name', 'updated'], focus: ['manual', 'name', 'updated'], favorites: ['manual', 'name', 'updated'], search: ['best', 'name', 'updated'] }

/**
 * The sort menu (D4): what to sort by, then, where the sort has two, which way. ✓ marks the current pick (Draw's YAZ-1835 D5).
 * A new sort starts its natural way; the current one keeps its way, and a pick that changes nothing writes nothing.
 * `dates` is the last row of each tab's menu (YAZ-3511 D7, D10): the date at the right end of each row, on or off. `filters`
 * are the Search menu's Type and Time rows (D13, D14), after it.
 */
export function sortSections(tab: SortMenuTab, sort: TabSort, set: (next: TabSort) => void, dates: { on: boolean; set: (on: boolean) => void }, filters?: MenuSection): MenuSection[] {
  const pick = (next: TabSort) => () => {
    if (next.by !== sort.by || next.reverse !== sort.reverse) set(next)
  }
  const by = BYS[tab].map((b) => ({ id: `sort-${b}`, label: BY_LABEL[b], hint: sort.by === b ? '✓' : undefined, onSelect: pick(sort.by === b ? sort : { by: b, reverse: false }) }))
  const ways = (WAYS[sort.by] ?? []).map((label, i) => ({ id: `sort-way-${i}`, label, hint: sort.reverse === (i === 1) ? '✓' : undefined, onSelect: pick({ ...sort, reverse: i === 1 }) }))
  const shown = [{ id: 'sort-dates', label: 'Show last updated', hint: dates.on ? '✓' : undefined, onSelect: () => dates.set(!dates.on) }]
  return [by, ...(ways.length > 0 ? [ways] : []), shown, ...(filters === undefined ? [] : [filters])]
}
