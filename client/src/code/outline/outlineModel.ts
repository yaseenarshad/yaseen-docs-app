/**
 * THE CODE OUTLINE'S RULES (YAZ-3486): the tree of a code file's symbols, and every question the
 * Outline asks of it — which rows show, in which order, which row is current, which rows carry an
 * error mark. Pure: no Monaco, no React, no DOM. `CodeOutline.tsx` draws what this decides.
 *
 * A SYMBOL is Monaco's `DocumentSymbol` shape (`CodeSymbol`): a name, a kind (Monaco's `SymbolKind`
 * number, 0-25), a range with 1-based lines and columns, the range of its name, and its children.
 * Monaco's providers give it as it is; the Python reader (`code/pythonSymbols.ts`) gives the same shape.
 *
 * ONE TREE, IN FLAT ARRAYS. A file of 5 MB has hundreds of thousands of symbols, so the tree is a
 * set of typed arrays, indexed by node, in document order (`buildTree`). Each question walks these
 * arrays once, and nothing here makes an object for each node after the build.
 *
 * Two orders:
 *  - The CANONICAL order is the document order. "Where is the cursor" and "where is this error"
 *    search it by position (`symbolAt`).
 *  - The DISPLAY order is the reader's sort ("…" › Sort by): Position, Name or Type (`displayOrder`).
 *    The rows (`visibleRows`) follow it.
 *
 * NO DEPTH CAP and NO ROW CAP: the note table of contents keeps 5 levels and 200 rows, the Outline
 * keeps every symbol. The list draws only the rows on screen (`CodeOutline.tsx`).
 */
import type { CodeOutlineSort } from '@shared/types'

/** A range of the text: 1-based lines and columns, Monaco's `IRange`. */
export interface SymbolRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** One symbol as a provider gives it: Monaco's `DocumentSymbol`, the fields the Outline reads. */
export interface CodeSymbol {
  name: string
  /** Monaco's `SymbolKind` (0 File … 25 TypeParameter). LSP's number is this one plus 1. */
  kind: number
  /** The whole symbol: from its first line to its last. */
  range: SymbolRange
  /** The name of the symbol: where a jump puts the cursor. */
  selectionRange: SymbolRange
  children?: readonly CodeSymbol[]
}

/** The marks of a row: none, a warning (yellow), an error (red). */
export const Mark = { None: 0, Warning: 1, Error: 2 } as const
export type Mark = (typeof Mark)[keyof typeof Mark]

/** Monaco's `MarkerSeverity` of a warning and of an error. Hints and infos make no mark. */
const SEVERITY_WARNING = 4
const SEVERITY_ERROR = 8

/** One of Monaco's markers on the model, the fields the marks read. */
export interface MarkerLike {
  severity: number
  startLineNumber: number
  startColumn: number
}

/**
 * The symbols as flat arrays, node `i` in document order (a parent before its children). `end[i]`
 * is one past the last node of `i`'s subtree, so `i + 1 … end[i] - 1` are its descendants.
 */
export interface OutlineTree {
  size: number
  name: readonly string[]
  /** `name` in lower case: the filter compares with it. */
  lower: readonly string[]
  kind: Uint8Array
  depth: Uint16Array
  /** −1 for a top-level symbol. */
  parent: Int32Array
  end: Int32Array
  startLine: Int32Array
  startColumn: Int32Array
  endLine: Int32Array
  endColumn: Int32Array
  /** Where a jump puts the cursor: the start of the symbol's name. */
  nameLine: Int32Array
  nameColumn: Int32Array
  /** Children in document order; `roots` are the top-level symbols. */
  children: readonly (readonly number[])[]
  roots: readonly number[]
  /**
   * A name for the row that stays the same when the file is read again (a fold stays folded):
   * the parent's key, the kind and the name, and `#n` for the nth sibling with both the same. Only a
   * symbol with children has one: only it can be collapsed. '' for the others.
   */
  key: readonly string[]
  /**
   * How many names inside functions the build left out (`isLocalName`; YAZ-3507), 0 when they show.
   * The "…" › Show menu offers "Variables inside functions" only when there are some.
   */
  localsLeftOut: number
}

/** The number of kinds: Monaco's `SymbolKind` runs from 0 to 25. Any other number reads as `Variable`. */
export const KIND_COUNT = 26
const VARIABLE = 12
const CONSTANT = 13

/**
 * The kinds a function body hides behind (YAZ-3507): a Method, Property, Field, Constructor, Function,
 * Variable or Constant. Monaco's TS rules give a constructor, a `let` and an unknown kind as Variable, a
 * getter or a setter as Property; a Variable or Property with a Variable child holds an arrow function
 * or a function expression (`const f = () => { let n }`). So a Variable under one of these is a name
 * inside a function. A Variable under the file, a Module, Namespace, Package, Class or Enum is kept.
 */
const FUNCTION_LIKE = new Set([5, 6, 7, 8, 11, VARIABLE, CONSTANT])

/**
 * A name declared inside a function, method or arrow function (YAZ-3507; YAZ-3439 "Decision — Demo round 2"):
 * a Variable or a Constant whose parent is `FUNCTION_LIKE`. The loop counter `n` in a method is one.
 * The Outline leaves them out unless "…" › Show › "Variables inside functions" is on.
 */
export function isLocalName(kind: number, parentKind: number | undefined): boolean {
  return (kind === VARIABLE || kind === CONSTANT) && parentKind !== undefined && FUNCTION_LIKE.has(parentKind)
}

const kindOf = (kind: number): number => (Number.isInteger(kind) && kind >= 0 && kind < KIND_COUNT ? kind : VARIABLE)

const before = (a: SymbolRange, b: SymbolRange): number => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn

const NO_CHILDREN: readonly number[] = []

/**
 * The tree of `symbols`, in document order: each list of siblings is sorted by where it starts.
 * Iterative, so a deep tree never runs out of stack. A name inside a function (`isLocalName`) and its
 * subtree are left out unless `showLocals`: the rule runs here, once per read, never per render (YAZ-3507).
 */
export function buildTree(symbols: readonly CodeSymbol[], showLocals = false): OutlineTree {
  // Pass 1: the nodes in document order, each with its parent.
  let localsLeftOut = 0
  const nodes: CodeSymbol[] = []
  const parents: number[] = []
  const depths: number[] = []
  const stack: { list: readonly CodeSymbol[]; at: number; parent: number; depth: number }[] = [{ list: [...symbols].sort((a, b) => before(a.range, b.range)), at: 0, parent: -1, depth: 0 }]
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.at >= top.list.length) {
      stack.pop()
      continue
    }
    const symbol = top.list[top.at++]
    if (!showLocals && top.parent !== -1 && isLocalName(kindOf(symbol.kind), kindOf(nodes[top.parent].kind))) {
      localsLeftOut++
      continue
    }
    const index = nodes.length
    nodes.push(symbol)
    parents.push(top.parent)
    depths.push(top.depth)
    const kids = symbol.children
    if (kids !== undefined && kids.length > 0) {
      // Most providers give children in order already: a sorted list is not copied.
      const sorted = kids.every((kid, i) => i === 0 || before(kids[i - 1].range, kid.range) <= 0) ? kids : [...kids].sort((a, b) => before(a.range, b.range))
      stack.push({ list: sorted, at: 0, parent: index, depth: top.depth + 1 })
    }
  }

  const size = nodes.length
  const tree = {
    size,
    name: new Array<string>(size),
    lower: new Array<string>(size),
    kind: new Uint8Array(size),
    depth: new Uint16Array(size),
    parent: new Int32Array(size),
    end: new Int32Array(size),
    startLine: new Int32Array(size),
    startColumn: new Int32Array(size),
    endLine: new Int32Array(size),
    endColumn: new Int32Array(size),
    nameLine: new Int32Array(size),
    nameColumn: new Int32Array(size),
    children: new Array<readonly number[]>(size),
    roots: [] as number[],
    key: new Array<string>(size),
    localsLeftOut,
  }
  const lists: number[][] = []
  for (let i = 0; i < size; i++) {
    const s = nodes[i]
    // A provider may give an empty name (an anonymous default export): the row still has a label.
    const name = typeof s.name === 'string' && s.name !== '' ? s.name : '(anonymous)'
    tree.name[i] = name
    tree.lower[i] = name.toLowerCase()
    tree.kind[i] = kindOf(s.kind)
    tree.depth[i] = Math.min(depths[i], 0xffff)
    tree.parent[i] = parents[i]
    tree.startLine[i] = s.range.startLineNumber
    tree.startColumn[i] = s.range.startColumn
    tree.endLine[i] = s.range.endLineNumber
    tree.endColumn[i] = s.range.endColumn
    const at = s.selectionRange ?? s.range
    tree.nameLine[i] = at.startLineNumber
    tree.nameColumn[i] = at.startColumn
    tree.children[i] = NO_CHILDREN
    tree.key[i] = ''
    const p = parents[i]
    if (p === -1) tree.roots.push(i)
    else (lists[p] ??= []).push(i)
  }
  for (let i = 0; i < size; i++) if (lists[i] !== undefined) tree.children[i] = lists[i]
  // `end`: from the last node up, each subtree ends where its last child's ends.
  for (let i = size - 1; i >= 0; i--) {
    const kids = tree.children[i]
    tree.end[i] = kids.length === 0 ? i + 1 : tree.end[kids[kids.length - 1]]
  }
  // Keys, parents first (document order), for the nodes that can collapse.
  const keyed = (siblings: readonly number[], parentKey: string): void => {
    let seen: Map<string, number> | null = null
    for (const i of siblings) {
      if (tree.children[i].length === 0) continue
      const own = `${parentKey}\u0001${tree.kind[i]}:${tree.name[i]}`
      seen ??= new Map()
      const n = (seen.get(own) ?? 0) + 1
      seen.set(own, n)
      tree.key[i] = n === 1 ? own : `${own}#${n}`
    }
  }
  keyed(tree.roots, '')
  for (let i = 0; i < size; i++) if (tree.children[i].length > 0) keyed(tree.children[i], tree.key[i])
  return tree
}

/** The children of each node and the top-level rows, in the reader's sort. */
export interface DisplayOrder {
  roots: readonly number[]
  children: readonly (readonly number[])[]
}

/** Names compare as people read them: case aside, and `step2` before `step10` (VS Code's Outline does the same). */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The rows' order (S4). `position` is the document order. `name` sorts each list of siblings by name,
 * then by position. `type` sorts by kind (Monaco's `SymbolKind` order, VS Code's "Category"), then by
 * name, then by position. Each list of siblings is sorted on its own: a method never leaves its class.
 */
export function displayOrder(tree: OutlineTree, sort: CodeOutlineSort): DisplayOrder {
  if (sort === 'position') return { roots: tree.roots, children: tree.children }
  const byName = (a: number, b: number): number => collator.compare(tree.name[a], tree.name[b]) || a - b
  const compare = sort === 'name' ? byName : (a: number, b: number): number => tree.kind[a] - tree.kind[b] || byName(a, b)
  const sortList = (list: readonly number[]): readonly number[] => (list.length < 2 ? list : [...list].sort(compare))
  const children = new Array<readonly number[]>(tree.size)
  for (let i = 0; i < tree.size; i++) children[i] = sortList(tree.children[i])
  return { roots: sortList(tree.roots), children }
}

export interface RowOptions {
  /** The keys of the collapsed rows (`OutlineTree.key`). */
  collapsed: ReadonlySet<string>
  /** Per kind (`SymbolKind` number), true when "…" › Show has it off. A hidden symbol hides with its subtree. */
  hidden: readonly boolean[]
  /** The filter box, as typed. Empty = no filter. */
  filter: string
}

/** What the list draws: the rows in order, and for each node where it is drawn. */
export interface OutlineRows {
  /** The node of each row, top to bottom. */
  rows: Int32Array
  /** The row of each node; −1 when it is not drawn (collapsed away, hidden, filtered out). */
  rowOf: Int32Array
  /** The number of children each node shows when it is open: 0 = no ⌄. */
  liveKids: Int32Array
  /** True for each node the filter matched by itself (not only as the parent of a match). */
  matched: Uint8Array | null
}

/**
 * The rows the list draws (S2, S3, S5).
 *  - A symbol of a hidden kind goes, and its subtree with it, as in VS Code.
 *  - The FILTER keeps each symbol whose name holds the typed text (case aside) and every parent of
 *    one, and opens the way to them: a collapsed row does not hide a match.
 *  - Else a collapsed row shows and its subtree does not.
 */
export function visibleRows(tree: OutlineTree, order: DisplayOrder, options: RowOptions): OutlineRows {
  const { size } = tree
  const needle = options.filter.trim().toLowerCase()
  // Dropped: of a hidden kind, or below one. Document order: a parent is decided before its children.
  const dropped = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    const p = tree.parent[i]
    dropped[i] = options.hidden[tree.kind[i]] === true || (p !== -1 && dropped[p] === 1) ? 1 : 0
  }
  // Kept by the filter: a match, or the parent of a kept node. Last node first, so children come before their parent.
  let kept: Uint8Array | null = null
  let matched: Uint8Array | null = null
  if (needle !== '') {
    kept = new Uint8Array(size)
    matched = new Uint8Array(size)
    for (let i = size - 1; i >= 0; i--) {
      if (dropped[i] === 1) continue
      if (tree.lower[i].includes(needle)) matched[i] = 1
      if (matched[i] === 1 || kept[i] === 1) {
        kept[i] = 1
        const p = tree.parent[i]
        if (p !== -1) kept[p] = 1
      }
    }
  }
  const shows = (i: number): boolean => dropped[i] === 0 && (kept === null || kept[i] === 1)
  const liveKids = new Int32Array(size)
  for (let i = 0; i < size; i++) {
    const p = tree.parent[i]
    if (p !== -1 && shows(i)) liveKids[p]++
  }

  const rowOf = new Int32Array(size).fill(-1)
  const out: number[] = []
  const stack: number[] = []
  for (let r = order.roots.length - 1; r >= 0; r--) stack.push(order.roots[r])
  while (stack.length > 0) {
    const i = stack.pop()!
    if (!shows(i)) continue
    rowOf[i] = out.length
    out.push(i)
    if (liveKids[i] === 0) continue
    if (kept === null && options.collapsed.has(tree.key[i])) continue
    const kids = order.children[i]
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k])
  }
  return { rows: Int32Array.from(out), rowOf, liveKids, matched }
}

/** True when the position (line, column) is inside node `i`'s range. */
const holds = (tree: OutlineTree, i: number, line: number, column: number): boolean =>
  (line > tree.startLine[i] || (line === tree.startLine[i] && column >= tree.startColumn[i])) && (line < tree.endLine[i] || (line === tree.endLine[i] && column <= tree.endColumn[i]))

/** The last of `list` (document order) that starts at or before (line, column); −1 for none. */
function lastStartingBy(tree: OutlineTree, list: readonly number[], line: number, column: number): number {
  let lo = 0
  let hi = list.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const i = list[mid]
    if (tree.startLine[i] < line || (tree.startLine[i] === line && tree.startColumn[i] <= column)) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/**
 * The deepest symbol that holds the position: −1 when none does. Binary search through each level,
 * so it costs a few steps per level, whatever the size of the file. When the last sibling that starts
 * before the position ends before it, the one before it is tried too (two symbols can overlap: an
 * object literal's members, a decorator).
 */
export function symbolAt(tree: OutlineTree, line: number, column: number): number {
  let list = tree.roots
  let found = -1
  for (;;) {
    const at = lastStartingBy(tree, list, line, column)
    let inside = -1
    for (let k = at; k >= 0 && k >= at - 1; k--) {
      if (holds(tree, list[k], line, column)) {
        inside = list[k]
        break
      }
    }
    if (inside === -1) return found
    found = inside
    list = tree.children[inside]
  }
}

/**
 * The current row (S7): the row of the deepest symbol that holds (line, column). When that symbol
 * is not drawn — inside a collapsed row, of a hidden kind, filtered out — its nearest drawn parent.
 * −1 when nothing holds the position: the cursor is between symbols.
 */
export function currentRow(tree: OutlineTree, rows: OutlineRows, line: number, column: number): number {
  for (let i = symbolAt(tree, line, column); i !== -1; i = tree.parent[i]) if (rows.rowOf[i] !== -1) return rows.rowOf[i]
  return -1
}

/** The marks (S6): each node's own (what lies in it outside its children) and its subtree's worst. */
export interface OutlineMarks {
  own: Uint8Array
  deep: Uint8Array
}

/** A marker's mark: an error, a warning, or none (a hint, an info). */
const markOf = (severity: number): Mark => (severity >= SEVERITY_ERROR ? Mark.Error : severity >= SEVERITY_WARNING ? Mark.Warning : Mark.None)

/**
 * Where each error and warning is: on the deepest symbol that holds its start. A marker outside every
 * symbol marks no row. `deep` carries each mark up to every parent, for a collapsed row (S6: "and its
 * collapsed parents show it too").
 */
export function markSymbols(tree: OutlineTree, markers: readonly MarkerLike[]): OutlineMarks {
  const own = new Uint8Array(tree.size)
  const deep = new Uint8Array(tree.size)
  for (const marker of markers) {
    const mark = markOf(marker.severity)
    if (mark === Mark.None) continue
    const i = symbolAt(tree, marker.startLineNumber, marker.startColumn)
    if (i !== -1 && own[i] < mark) own[i] = mark
  }
  for (let i = tree.size - 1; i >= 0; i--) {
    if (own[i] > deep[i]) deep[i] = own[i]
    const p = tree.parent[i]
    if (p !== -1 && deep[i] > deep[p]) deep[p] = deep[i]
  }
  return { own, deep }
}

/**
 * The mark a row shows: its own, and the worst of what it hides. An open row shows its children,
 * which carry their own marks; a collapsed one stands for all of them. A row whose children are
 * all hidden by kind shows its subtree's worst too: no child is there to carry it.
 */
export function rowMark(tree: OutlineTree, rows: OutlineRows, marks: OutlineMarks, i: number, open: boolean): Mark {
  return open && rows.liveKids[i] > 0 ? (marks.own[i] as Mark) : (marks.deep[i] as Mark)
}

/**
 * The level lines of the path (YAZ-2762's path, in a tree): for each row between the current row's
 * top parent and the current row, how many of the current row's parents have their line passing it.
 * 0 for every other row. `at` is the current row; the answer is a count, from the outer parent in.
 */
export function pathDepth(tree: OutlineTree, rows: OutlineRows, at: number, row: number): number {
  if (at < 0 || row > at || row <= 0) return 0
  let count = 0
  for (let p = tree.parent[rows.rows[at]]; p !== -1; p = tree.parent[p]) {
    const r = rows.rowOf[p]
    if (r !== -1 && r < row) count++
  }
  return count
}

/** The kinds this file has: the rows of "…" › Show (only the kinds the reader can see here). */
export function kindsIn(tree: OutlineTree): number[] {
  const seen = new Uint8Array(KIND_COUNT)
  for (let i = 0; i < tree.size; i++) seen[tree.kind[i]] = 1
  const out: number[] = []
  for (let k = 0; k < KIND_COUNT; k++) if (seen[k] === 1) out.push(k)
  return out
}

/**
 * The keys of the rows that can collapse on screen while `hidden` kinds are off: a shown row with a shown child, so
 * it has a chevron (the fold-all button's "Nothing to fold" and "Expand all", YAZ-3938 D6; YAZ-4010). Document
 * order, as `visibleRows`: a parent is decided before its children.
 */
export function foldableKeys(tree: OutlineTree, hidden: RowOptions['hidden']): Set<string> {
  const dropped = new Uint8Array(tree.size)
  const keys = new Set<string>()
  for (let i = 0; i < tree.size; i++) {
    const p = tree.parent[i]
    dropped[i] = hidden[tree.kind[i]] === true || (p !== -1 && dropped[p] === 1) ? 1 : 0
    if (dropped[i] === 0 && p !== -1) keys.add(tree.key[p])
  }
  return keys
}

/** Every key of a row that can collapse: "Collapse all" (S2). */
export function allKeys(tree: OutlineTree): Set<string> {
  const keys = new Set<string>()
  for (let i = 0; i < tree.size; i++) if (tree.key[i] !== '') keys.add(tree.key[i])
  return keys
}
