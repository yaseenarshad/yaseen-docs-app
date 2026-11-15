import { bestScores } from '@client/search/bestMatch'
import { searchRows, type SearchCandidate } from '@client/search/searchCandidates'
import { searchTree } from '@client/search/searchTree'
import type { IndexRecord, TreeNode } from '@shared/types'
import { typeTest, type PhoneType } from './searchRun'
import type { VaultData } from './vaultData'
import { buildTree, fileKind, levelOf, type TreeFolder, type TreeKind } from './vaultTree'
import { boardKindOf, recordsWithBoards } from '../drawing/boardFiles'

/**
 * THE RESULTS AS A TREE (YAZ-5447): the Mac's Search tab (`client/src/sidebar/hooks/useSidebarSearch.ts`, YAZ-2620) on
 * the phone. With text in the box the Mac draws the Files tree CUT to the matches and the folders that lead to them
 * (`searchTree`, the Mac's own, reused here): each such folder open, at its depth; every other row hidden. A folder that
 * matched and holds no match keeps all it holds, closed (one tap looks inside). A card in a page stands right under its
 * page (YAZ-5037), which stays as a parent. The Mac's default Search sort, Best match (`bestScores`, the Mac's own; the
 * order of `treeSort.ts` `sortLevel`, copied, as that module pulls the desktop's tree feed): each level by its score,
 * then the newer row, then the name, no folder first. A fold tapped during a search is the search's alone and lasts as
 * long as its text (`useSidebarSearch`'s `flipped`): the tree of the empty box keeps its own folds.
 *
 * The matches are the phone's search as it was (`findRows`: titles, aliases, file names, IDs, cards), with the Mac's
 * folder rows (`folderCandidates`, by the folder's title or ID) ranked on their own beside them, so no match of the
 * pages and cards leaves for a folder.
 */

/** The phone's tree as the Mac's tree nodes (a file's `name` is the name its row shows), its folders, its records. */
export interface VaultNodes {
  nodes: TreeNode[]
  /** Each folder, by path: the name its row shows. */
  dirs: Map<string, string>
  records: Map<string, IndexRecord>
}

const held = new WeakMap<VaultData, VaultNodes>()

/** The nodes of `data`, built once for each version of the vault's data. */
export function vaultNodes(data: VaultData): VaultNodes {
  let out = held.get(data)
  if (out !== undefined) return out
  const dirs = new Map<string, string>()
  const records = new Map<string, IndexRecord>()
  const walk = (folder: TreeFolder): TreeNode[] => {
    const level = levelOf(folder)
    const nodes: TreeNode[] = []
    for (const sub of level.folders) {
      dirs.set(sub.path, sub.name)
      nodes.push({ type: 'dir', name: sub.name, path: sub.path, children: walk(sub) })
    }
    for (const { record, label } of level.files) {
      records.set(record.path, record)
      nodes.push({ type: 'file', name: label, path: record.path, size: 0, mtime: record.mtime, kind: boardKindOf(record.path) ?? 'markdown' })
    }
    return nodes
  }
  out = { nodes: walk(buildTree(recordsWithBoards(data), data.folders)), dirs, records }
  held.set(data, out)
  return out
}

/**
 * Every folder as the Mac's search row (`folderCandidates`, YAZ-1491): its title (its `.folder.md`), else its name, as
 * its tree row shows it; its ID; the vault's earlier ID letters. Built here from the tree, not by `folderCandidates`:
 * its module is in the phone's first load, where each new line counts (YAZ-5377), and this chunk is not.
 */
export function folderRowsOf(data: VaultData): SearchCandidate[] {
  const ids = new Map<string, string>()
  for (const f of data.folders) if (f.id !== undefined) ids.set(f.path.slice(0, Math.max(0, f.path.lastIndexOf('/'))), f.id)
  const was = data.letters.length > 1 ? { was: data.letters.slice(1) } : {}
  return [...vaultNodes(data).dirs].map(([path, name]) => {
    const id = ids.get(path)
    return { kind: 'dir', name, lower: name.toLowerCase(), label: name, path, folder: path.slice(0, Math.max(0, path.lastIndexOf('/'))), ...(id !== undefined && { id }), ...was }
  })
}

const NO_FOLDERS: SearchCandidate[] = []

/** The folders that match `query` (the Mac's ranking), the ones `type` keeps: a type on keeps none, as on the Mac. No text: none. */
export function folderHits(rows: readonly SearchCandidate[], query: string, type: PhoneType): SearchCandidate[] {
  const keep = typeTest(type)
  if (query.trim() === '') return NO_FOLDERS
  return searchRows(keep === undefined ? rows : rows.filter(keep), query)
}

export interface Found {
  /** The cut tree (`searchTree`). */
  nodes: TreeNode[]
  /** The folders that lead to a match: drawn open. */
  open: ReadonlySet<string>
  /** Each matched row's path, and the row the search gave first for it (an ID match before its title's). */
  hits: ReadonlyMap<string, SearchCandidate>
  /** The cards in a page that matched, by their page. */
  cards: ReadonlyMap<string, readonly SearchCandidate[]>
  /** Best match's score of each row of the cut. */
  scores: ReadonlyMap<string, number>
  /** YAZ-5534: no text (a Type alone): the tree's own order (Name A to Z, folders first), as the empty box's tree. */
  treeOrder?: true
}

const NO_FULL: ReadonlySet<string> = new Set()

/** The cut of the vault's tree for `results` (pages and cards) and `folders` (the matched folders) of `query`. */
export function foundTree(vault: VaultNodes, results: readonly SearchCandidate[], folders: readonly SearchCandidate[], query: string): Found {
  const hits = new Map<string, SearchCandidate>()
  const cards = new Map<string, SearchCandidate[]>()
  for (const r of [...folders, ...results]) {
    if (r.page === undefined) {
      if (!hits.has(r.path)) hits.set(r.path, r)
      continue
    }
    const held = cards.get(r.page)
    if (held === undefined) cards.set(r.page, [r])
    else held.push(r)
  }
  const cut = new Set([...hits.keys(), ...cards.keys()])
  if (cut.size === 0) return { nodes: [], open: new Set(), hits, cards, scores: new Map() }
  const { nodes, open } = searchTree(vault.nodes, cut, NO_FULL)
  if (query.trim() === '') return { nodes, open, hits, cards, scores: new Map(), treeOrder: true }
  return { nodes, open, hits, cards, scores: bestScores([...folders, ...results], query, nodes, open) }
}

/**
 * The cut of one search, kept for its last inputs: the result tree and the box's Collapse all read the same cut
 * (YAZ-5534), built once. `rows` and `folders` are the same arrays while nothing changed.
 */
let last: { vault: VaultNodes; results: readonly SearchCandidate[]; folders: readonly SearchCandidate[]; query: string; found: Found } | null = null
export function foundTreeOf(vault: VaultNodes, results: readonly SearchCandidate[], folders: readonly SearchCandidate[], query: string): Found {
  if (last !== null && last.vault === vault && last.results === results && last.folders === folders && last.query === query) return last.found
  const found = foundTree(vault, results, folders, query)
  last = { vault, results, folders, query, found }
  return found
}

/** Every folder of a cut (YAZ-5534: what Collapse all and Expand all act on). */
export function cutFolders(nodes: readonly TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list)
      if (node.type === 'dir') {
        out.push(node.path)
        walk(node.children)
      }
  }
  walk(nodes)
  return out
}

/** One drawn row of the result tree. */
export interface FoundRow {
  kind: TreeKind
  path: string
  /** The name the row shows (a page's or a folder's title; a card's). */
  label: string
  depth: number
  /** A folder row: it is open. */
  open?: boolean
  /** The row matched: the search's row for it. A row that is no match is a parent of one, or inside a matched folder (drawn dim). */
  hit?: SearchCandidate
  /** A card in a page (under its page). */
  inPage?: true
  /** A card file's card ID, for a row that is no match (where it opens). */
  id?: string
}

/** No score: after every match (`treeSort.ts`). */
const NO_SCORE = 4
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const newest = new WeakMap<TreeNode, number>()
/** A row's time (`treeSort.ts` `timeOf`): a file's; a folder's newest file inside. */
function timeOf(node: TreeNode): number {
  if (node.type === 'file') return node.mtime
  let time = newest.get(node)
  if (time === undefined) newest.set(node, (time = node.children.reduce((max, child) => Math.max(max, timeOf(child)), 0)))
  return time
}

/** One level in Best match's order (`treeSort.ts` `sortLevel`): the score, then the newer row, then the name. */
export function bestLevel(nodes: readonly TreeNode[], scores: ReadonlyMap<string, number>): TreeNode[] {
  const score = (node: TreeNode) => scores.get(node.path) ?? NO_SCORE
  return [...nodes].sort((a, b) => score(a) - score(b) || timeOf(b) - timeOf(a) || collator.compare(a.name, b.name))
}

/**
 * The rows on show: each level of the cut in Best match's order, inside each open folder its rows, a page's matched
 * cards right under it. `flipped`: the folders tapped during this search (open XOR flipped is open). `cardFiles`: card
 * files that are no match show (Review on), as the empty box's tree shows them.
 */
export function foundRows(vault: VaultNodes, found: Found, flipped: ReadonlySet<string>, cardFiles: boolean): FoundRow[] {
  const rows: FoundRow[] = []
  const walk = (nodes: readonly TreeNode[], depth: number) => {
    for (const node of found.treeOrder === true ? nodes : bestLevel(nodes, found.scores)) {
      const hit = found.hits.get(node.path)
      if (node.type === 'dir') {
        const open = found.open.has(node.path) !== flipped.has(node.path)
        rows.push({ kind: 'folder', path: node.path, label: node.name, depth, open, ...(hit !== undefined && { hit }) })
        if (open) walk(node.children, depth + 1)
        continue
      }
      const record = vault.records.get(node.path)
      if (record === undefined) continue
      // A match is drawn as the search found it (a card file is a page with Review off); a row that is no match by its record.
      const kind: TreeKind = hit !== undefined ? (hit.card === true ? 'card' : (boardKindOf(record.path) ?? 'page')) : fileKind(record)
      if (hit === undefined && kind === 'card' && !cardFiles) continue
      const id = kind === 'card' && hit === undefined ? (record.cards?.find((c) => c.id !== null)?.id ?? undefined) : undefined
      rows.push({ kind, path: node.path, label: node.name, depth, ...(hit !== undefined && { hit }), ...(id != null && { id }) })
      for (const card of found.cards.get(node.path) ?? []) rows.push({ kind: 'card', path: card.path, label: card.name, depth: depth + 1, hit: card, inPage: true })
    }
  }
  walk(found.nodes, 0)
  return rows
}
