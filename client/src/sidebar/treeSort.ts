import type { SortBy, SortedTab, TabSort, TreeNode, TreeResponse } from '@shared/types'
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

/** One level in the tab's order (D7): folders first, then files, each by the same rule. No sort, or Manual below the top rows: Name, A to Z. */
export function sortLevel(nodes: readonly TreeNode[], sort: TabSort | undefined, label: (node: TreeNode) => string): TreeNode[] {
  const byName = (a: TreeNode, b: TreeNode): number => collator.compare(label(a), label(b))
  const base = sort?.by === 'updated' ? (a: TreeNode, b: TreeNode): number => timeOf(b) - timeOf(a) || byName(a, b) : byName
  const order = sort?.reverse === true && sort.by !== 'manual' ? (a: TreeNode, b: TreeNode): number => base(b, a) : base
  return [...nodes.filter((n) => n.type === 'dir').sort(order), ...nodes.filter((n) => n.type === 'file').sort(order)]
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

const BY_LABEL: Record<SortBy, string> = { manual: 'Manual', name: 'Name', updated: 'Last updated' }
/** The two ways of each sort (D4): the natural way first. */
const WAYS: Record<Exclude<SortBy, 'manual'>, readonly [string, string]> = { name: ['A to Z', 'Z to A'], updated: ['Newest first', 'Oldest first'] }

/**
 * The sort menu (D4): what to sort by, then, unless Manual, which way. ✓ marks the current pick (Draw's YAZ-1835 D5).
 * A new sort starts its natural way; the current one keeps its way, and a pick that changes nothing writes nothing.
 * `dates` is the Search menu's last row (YAZ-3511 D7): the date at the right end of each row, on or off.
 */
export function sortSections(tab: SortedTab | 'search', sort: TabSort, set: (next: TabSort) => void, dates?: { on: boolean; set: (on: boolean) => void }): MenuSection[] {
  const pick = (next: TabSort) => () => {
    if (next.by !== sort.by || next.reverse !== sort.reverse) set(next)
  }
  // Files and Search have no drag order, so no Manual (YAZ-3511 D4).
  const bys: SortBy[] = tab === 'files' || tab === 'search' ? ['name', 'updated'] : ['manual', 'name', 'updated']
  const by = bys.map((b) => ({ id: `sort-${b}`, label: BY_LABEL[b], hint: sort.by === b ? '✓' : undefined, onSelect: pick(sort.by === b ? sort : { by: b, reverse: false }) }))
  if (sort.by === 'manual') return [by]
  const ways = WAYS[sort.by].map((label, i) => ({ id: `sort-way-${i}`, label, hint: sort.reverse === (i === 1) ? '✓' : undefined, onSelect: pick({ ...sort, reverse: i === 1 }) }))
  if (dates === undefined) return [by, ways]
  return [by, ways, [{ id: 'sort-dates', label: 'Show last updated', hint: dates.on ? '✓' : undefined, onSelect: () => dates.set(!dates.on) }]]
}
