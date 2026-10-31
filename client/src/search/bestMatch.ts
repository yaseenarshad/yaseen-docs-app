/**
 * The Search tab's Best match sort (YAZ-3511 D12): a score for each row of the cut tree, lower first, from the matcher's
 * own tiers (`matchTier`): 0 an ID the text holds (YAZ-2677 D9), then the matcher's tier plus one: 1 the same name,
 * 2 a name that starts with the text, 3 a name that holds it, 4 a word match, 5 a joined match (YAZ-3748 D2).
 * `sortLevel` orders each level by it, then by the newer row, then by the name.
 */
import { holdsId } from '@shared/noteId'
import type { TreeNode } from '@shared/types'
import { matchTier, readNeedle, type Needle } from '../links/completion'
import type { SearchCandidate } from './searchCandidates'

/** No score map: the Search sort is not Best match. */
export const NO_SCORES: ReadonlyMap<string, number> = new Map()

/** A row's score for `needle` (`readNeedle` of the text); `holds` is `holdsId` of the text, read once. */
export function matchScore(row: Pick<SearchCandidate, 'name' | 'lower' | 'id' | 'was'>, needle: Needle, holds: ReturnType<typeof holdsId>): number {
  if (holds !== null && row.id !== undefined && holds(row.id, row.was)) return 0
  return matchTier(row, needle) + 1
}

/**
 * The score of each row of the cut (`trees`, its `open` folders): a note takes the best of its rows (its aliases), a
 * folder the best of itself and every match inside it. A folder the cut did not open holds no match, so the walk stops there.
 */
export function bestScores(results: readonly SearchCandidate[], query: string, trees: readonly TreeNode[], open: ReadonlySet<string>): ReadonlyMap<string, number> {
  const needle = readNeedle(query)
  const holds = holdsId(query)
  const own = new Map<string, number>()
  for (const r of results) own.set(r.path, Math.min(own.get(r.path) ?? Infinity, matchScore(r, needle, holds)))
  const out = new Map<string, number>()
  const score = (node: TreeNode): number => {
    let best = own.get(node.path) ?? Infinity
    if (node.type === 'dir' && open.has(node.path)) for (const child of node.children) best = Math.min(best, score(child))
    if (best !== Infinity) out.set(node.path, best)
    return best
  }
  trees.forEach(score)
  return out
}
