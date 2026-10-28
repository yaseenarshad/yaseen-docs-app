/**
 * The code Outline's rules (YAZ-3486), pure: the tree build, the sort (S4), the filter (S3), Show /
 * Hide by kind (S5), collapse (S2), the error marks (S6), the current row (S7), the path of the level
 * lines, and the time each takes on a 5 MB file's symbols (S12).
 */
import { describe, expect, it } from 'vitest'
import { allKeys, buildTree, currentRow, displayOrder, isLocalName, kindsIn, Mark, markSymbols, pathDepth, rowMark, symbolAt, visibleRows, KIND_COUNT, type CodeSymbol, type OutlineTree } from './outlineModel'

// Monaco's SymbolKind numbers the tests use.
const CLASS = 4
const METHOD = 5
const PROPERTY = 6
const FUNCTION = 11
const VARIABLE = 12
const CONSTANT = 13

/** A symbol on lines `from`–`to`; its name starts at `column` of `from`. */
const sym = (name: string, kind: number, from: number, to: number, children?: CodeSymbol[], column = 1): CodeSymbol => ({
  name,
  kind,
  range: { startLineNumber: from, startColumn: 1, endLineNumber: to, endColumn: 200 },
  selectionRange: { startLineNumber: from, startColumn: column, endLineNumber: from, endColumn: column + name.length },
  children,
})

/** `long-class-for-folding.ts` (S1): `Pipeline` with 40 methods of 10 lines, then a constant. */
const pipeline = (): CodeSymbol[] => [
  sym(
    'Pipeline',
    CLASS,
    1,
    402,
    Array.from({ length: 40 }, (_, i) => sym(`step${i + 1}`, METHOD, 2 + i * 10, 10 + i * 10, [sym(`value${i + 1}`, VARIABLE, 3 + i * 10, 3 + i * 10)], 3)),
    14,
  ),
  sym('LIMIT', CONSTANT, 404, 404),
]

/** The tree with every symbol a row: the YAZ-3486 rules below are pinned with the names inside functions shown (YAZ-3507). */
const build = (symbols: readonly CodeSymbol[]): OutlineTree => buildTree(symbols, true)

const NONE_HIDDEN: boolean[] = new Array(KIND_COUNT).fill(false)
const hide = (...kinds: number[]): boolean[] => NONE_HIDDEN.map((_, k) => kinds.includes(k))
const names = (tree: OutlineTree, rows: { rows: Int32Array }): string[] => [...rows.rows].map((i) => tree.name[i])
const view = (tree: OutlineTree, opts: { sort?: 'position' | 'name' | 'type'; collapsed?: Set<string>; hidden?: boolean[]; filter?: string } = {}) =>
  visibleRows(tree, displayOrder(tree, opts.sort ?? 'position'), { collapsed: opts.collapsed ?? new Set(), hidden: opts.hidden ?? NONE_HIDDEN, filter: opts.filter ?? '' })

describe('buildTree', () => {
  it('S1: Pipeline and its 40 methods, nested, in document order, with no depth cap', () => {
    const tree = build(pipeline())
    expect(tree.size).toBe(1 + 40 * 2 + 1)
    expect(tree.roots.map((i) => tree.name[i])).toEqual(['Pipeline', 'LIMIT'])
    const pipe = tree.roots[0]
    expect(tree.children[pipe].map((i) => tree.name[i])).toEqual(Array.from({ length: 40 }, (_, i) => `step${i + 1}`))
    expect(tree.end[pipe]).toBe(81)
    const step3 = tree.children[pipe][2]
    expect([tree.depth[step3], tree.parent[step3], tree.kind[step3], tree.nameLine[step3], tree.nameColumn[step3]]).toEqual([1, pipe, METHOD, 22, 3])

    // A chain 300 deep: every level is a row (the note TOC stops at 5).
    let deep: CodeSymbol = sym('leaf', VARIABLE, 300, 300)
    for (let d = 299; d >= 1; d--) deep = sym(`n${d}`, FUNCTION, d, 600 - d, [deep])
    const chain = build([deep])
    expect(chain.size).toBe(300)
    expect(Math.max(...chain.depth)).toBe(299)
    expect(view(chain).rows.length).toBe(300)
  })

  it('sorts unsorted siblings by position, names an empty name, and keeps an unknown kind as a variable', () => {
    const tree = build([sym('b', FUNCTION, 10, 12), sym('', 99, 1, 3, [sym('y', VARIABLE, 3, 3), sym('x', VARIABLE, 2, 2)])])
    expect(tree.name).toEqual(['(anonymous)', 'x', 'y', 'b'])
    expect(tree.kind[0]).toBe(VARIABLE)
  })

  it('keys: stable for rows with children, the nth twin numbered, empty for leaves', () => {
    const tree = build([sym('A', CLASS, 1, 5, [sym('m', METHOD, 2, 2)]), sym('A', CLASS, 6, 9, [sym('m', METHOD, 7, 7)])])
    expect(tree.key[0]).not.toBe('')
    expect(tree.key[2]).toBe(`${tree.key[0]}#2`)
    expect(tree.key[1]).toBe('')
    // The same file read again gives the same keys: a collapse survives a new read.
    expect(build([sym('A', CLASS, 1, 5, [sym('m', METHOD, 2, 2)]), sym('A', CLASS, 6, 9, [sym('m', METHOD, 7, 7)])]).key).toEqual(tree.key)
  })
})

describe('YAZ-3507: names inside functions', () => {
  it('a Variable or Constant under a function, method, constructor, property or variable is one; under the file, a namespace or a class it is not', () => {
    for (const parent of [METHOD, PROPERTY, 7, 8, FUNCTION, VARIABLE, CONSTANT]) {
      expect(isLocalName(VARIABLE, parent)).toBe(true)
      expect(isLocalName(CONSTANT, parent)).toBe(true)
    }
    for (const parent of [undefined, 0, 1, 2, 3, CLASS, 9, 10]) expect(isLocalName(VARIABLE, parent)).toBe(false)
    // Only variables and constants: a function, a class, a property inside a function stay.
    for (const kind of [CLASS, METHOD, PROPERTY, FUNCTION]) expect(isLocalName(kind, FUNCTION)).toBe(false)
  })

  it('`long-class-for-folding.ts`: no `value` rows by default, counted as left out; on, they come back', () => {
    const off = buildTree(pipeline())
    expect(off.name.some((n) => n.startsWith('value'))).toBe(false)
    expect(off.size).toBe(42) // Pipeline, 40 methods, LIMIT
    expect(off.localsLeftOut).toBe(40)
    expect(kindsIn(off)).toEqual([CLASS, METHOD, CONSTANT])
    const on = buildTree(pipeline(), true)
    expect(on.size).toBe(82)
    expect(on.name[2]).toBe('value1')
    expect(on.localsLeftOut).toBe(0)
  })

  it('a name left out takes its subtree along; the parents, ends and keys of the rest are right', () => {
    const tree = buildTree([sym('outer', FUNCTION, 1, 20, [sym('helper', VARIABLE, 2, 6, [sym('h', VARIABLE, 3, 3)]), sym('Local', CLASS, 7, 12, [sym('field', PROPERTY, 8, 8), sym('m', METHOD, 9, 11, [sym('lm', VARIABLE, 10, 10)])])]), sym('TOP', CONSTANT, 21, 21)])
    expect(tree.name).toEqual(['outer', 'Local', 'field', 'm', 'TOP'])
    expect([...tree.parent]).toEqual([-1, 0, 1, 1, -1])
    expect([...tree.end]).toEqual([4, 4, 3, 4, 5])
    expect(tree.children[3]).toEqual([])
    expect(tree.key[3]).toBe('')
    expect(tree.localsLeftOut).toBe(2) // helper (with h) and lm
  })
})

describe('visibleRows: collapse (S2), filter (S3), Show / Hide (S5)', () => {
  it('S2: collapsing Pipeline hides its methods; Collapse all collapses every parent', () => {
    const tree = build(pipeline())
    const pipe = tree.roots[0]
    expect(view(tree).rows.length).toBe(82)
    const one = view(tree, { collapsed: new Set([tree.key[pipe]]) })
    expect(names(tree, one)).toEqual(['Pipeline', 'LIMIT'])
    expect(one.liveKids[pipe]).toBe(40)
    expect(one.rowOf[tree.children[pipe][0]]).toBe(-1)
    // Collapse all: every parent, the methods too.
    const keys = allKeys(tree)
    expect(keys.size).toBe(41)
    expect(names(tree, view(tree, { collapsed: keys }))).toEqual(['Pipeline', 'LIMIT'])
    // Pipeline opened again under Collapse all: its methods show, each one still collapsed.
    keys.delete(tree.key[pipe])
    expect(view(tree, { collapsed: keys }).rows.length).toBe(1 + 40 + 1)
  })

  it('S3: the filter keeps step3 and its parent Pipeline, opens collapsed rows, and ignores case', () => {
    const tree = build(pipeline())
    const rows = view(tree, { filter: 'Step3', collapsed: allKeys(tree) })
    // `step3` and `step30` … `step39` hold the text; their values do not.
    expect(names(tree, rows)).toEqual(['Pipeline', 'step3', ...Array.from({ length: 10 }, (_, i) => `step${30 + i}`)])
    expect(rows.matched![tree.roots[0]]).toBe(0)
    expect(rows.matched![rows.rows[1]]).toBe(1)
    // A child of a match that does not match itself is not kept.
    expect(names(tree, view(tree, { filter: 'value12' }))).toEqual(['Pipeline', 'step12', 'value12'])
    expect(view(tree, { filter: 'nothing like it' }).rows.length).toBe(0)
    expect(view(tree, { filter: '   ' }).rows.length).toBe(82)
  })

  it('S5: hiding Variables drops their rows; hiding a parent kind drops its subtree; a parent left with no child shows no ⌄', () => {
    const tree = build(pipeline())
    const noVars = view(tree, { hidden: hide(VARIABLE) })
    expect(noVars.rows.length).toBe(1 + 40 + 1)
    expect(names(tree, noVars).some((n) => n.startsWith('value'))).toBe(false)
    expect(noVars.liveKids[tree.children[tree.roots[0]][0]]).toBe(0)
    expect(names(tree, view(tree, { hidden: hide(CLASS) }))).toEqual(['LIMIT'])
    // The filter never shows a hidden kind.
    expect(names(tree, view(tree, { hidden: hide(VARIABLE), filter: 'value3' }))).toEqual([])
  })

  it('kindsIn lists the kinds of the file once each, in kind order', () => {
    expect(kindsIn(build(pipeline()))).toEqual([CLASS, METHOD, VARIABLE, CONSTANT])
  })
})

describe('displayOrder: Sort by (S4)', () => {
  const file = (): CodeSymbol[] => [sym('zeta', FUNCTION, 1, 2), sym('Alpha', CLASS, 3, 9, [sym('step10', METHOD, 4, 4), sym('step2', METHOD, 5, 5), sym('id', PROPERTY, 6, 6)]), sym('beta', VARIABLE, 10, 10), sym('Beta', FUNCTION, 11, 11)]

  it('Name sorts each level by name, case aside and numbers as numbers; Type sorts by kind, then name; Position puts it back', () => {
    const tree = build(file())
    expect(names(tree, view(tree, { sort: 'position' }))).toEqual(['zeta', 'Alpha', 'step10', 'step2', 'id', 'beta', 'Beta'])
    expect(names(tree, view(tree, { sort: 'name' }))).toEqual(['Alpha', 'id', 'step2', 'step10', 'beta', 'Beta', 'zeta'])
    expect(names(tree, view(tree, { sort: 'type' }))).toEqual(['Alpha', 'step2', 'step10', 'id', 'Beta', 'zeta', 'beta'])
    expect(names(tree, view(tree, { sort: 'position' }))).toEqual(['zeta', 'Alpha', 'step10', 'step2', 'id', 'beta', 'Beta'])
  })

  it('a sort never moves a method out of its class', () => {
    const tree = build(file())
    const rows = view(tree, { sort: 'name' })
    const alpha = tree.roots[1]
    for (const kid of tree.children[alpha]) expect(rows.rowOf[kid]).toBeGreaterThan(rows.rowOf[alpha])
  })
})

describe('the current row (S7) and the path of the level lines', () => {
  it('is the deepest symbol that holds the position, or its nearest drawn parent; −1 between symbols', () => {
    const tree = build(pipeline())
    const rows = view(tree)
    // Line 23 is inside step3 (lines 22–30), below its value3 (line 23).
    expect(tree.name[rows.rows[currentRow(tree, rows, 25, 5)]]).toBe('step3')
    expect(tree.name[rows.rows[currentRow(tree, rows, 23, 5)]]).toBe('value3')
    expect(tree.name[rows.rows[currentRow(tree, rows, 1, 1)]]).toBe('Pipeline')
    expect(currentRow(tree, rows, 403, 1)).toBe(-1)
    // step3 inside a collapsed Pipeline: the cursor's row is Pipeline.
    const closed = view(tree, { collapsed: new Set([tree.key[tree.roots[0]]]) })
    expect(tree.name[closed.rows[currentRow(tree, closed, 25, 5)]]).toBe('Pipeline')
    // value3 hidden by kind: step3.
    const noVars = view(tree, { hidden: hide(VARIABLE) })
    expect(tree.name[noVars.rows[currentRow(tree, noVars, 23, 5)]]).toBe('step3')
  })

  it('symbolAt finds a symbol between overlapping siblings, and a position on the first column of a range', () => {
    const tree = build([sym('outer', FUNCTION, 1, 20, [sym('a', VARIABLE, 2, 10), sym('b', VARIABLE, 3, 4)])])
    // Line 8: `b` (3–4) starts last but ended; `a` (2–10) holds it.
    expect(tree.name[symbolAt(tree, 8, 1)]).toBe('a')
    expect(tree.name[symbolAt(tree, 2, 1)]).toBe('a')
    expect(symbolAt(tree, 30, 1)).toBe(-1)
  })

  it('the path runs from the current row up to its parents, on the rows between them', () => {
    const tree = build([sym('A', CLASS, 1, 20, [sym('m1', METHOD, 2, 4), sym('m2', METHOD, 5, 12, [sym('x', VARIABLE, 6, 6), sym('y', VARIABLE, 7, 7)])])])
    const rows = view(tree)
    expect(names(tree, rows)).toEqual(['A', 'm1', 'm2', 'x', 'y'])
    const y = rows.rowOf[4]
    // Rows below A down to y carry A's line; rows below m2 down to y carry m2's line too.
    expect([0, 1, 2, 3, 4].map((r) => pathDepth(tree, rows, y, r))).toEqual([0, 1, 1, 2, 2])
    expect(pathDepth(tree, rows, -1, 2)).toBe(0)
  })
})

describe('error marks (S6)', () => {
  it('marks the deepest symbol that holds each error or warning; a collapsed parent shows the worst it hides', () => {
    const tree = build(pipeline())
    const marks = markSymbols(tree, [
      { severity: 8, startLineNumber: 25, startColumn: 5 }, // an error in step3
      { severity: 4, startLineNumber: 45, startColumn: 5 }, // a warning in step5
      { severity: 2, startLineNumber: 55, startColumn: 5 }, // an info: no mark
      { severity: 8, startLineNumber: 403, startColumn: 1 }, // outside every symbol: no row
    ])
    const pipe = tree.roots[0]
    const [step3, step5, step6] = [2, 4, 5].map((i) => tree.children[pipe][i])
    const open = view(tree)
    expect(rowMark(tree, open, marks, step3, true)).toBe(Mark.Error)
    expect(rowMark(tree, open, marks, step5, true)).toBe(Mark.Warning)
    expect(rowMark(tree, open, marks, step6, true)).toBe(Mark.None)
    // Pipeline open: its own code has no error, its methods carry theirs. Collapsed: the worst of them.
    expect(rowMark(tree, open, marks, pipe, true)).toBe(Mark.None)
    expect(rowMark(tree, open, marks, pipe, false)).toBe(Mark.Error)
    // A row whose children are all hidden carries what is below it.
    const noVars = view(tree, { hidden: hide(VARIABLE) })
    const marked = markSymbols(tree, [{ severity: 8, startLineNumber: 23, startColumn: 5 }])
    expect(rowMark(tree, noVars, marked, step3, true)).toBe(Mark.Error)
  })
})

/**
 * S12: the symbols of `speed/big-5mb.ts` — 52 000 exported constants, each an object literal of 4
 * properties: 260 000 symbols. Every step must stay far from a frame's budget per read, and no step
 * runs on a keystroke (the feed reads 300 ms after the last edit). The list draws ~60 rows of them.
 */
describe('S12: a 5 MB file', () => {
  /** One property of a line's object literal: `{ id: 0, name: 'row 0', … }`. */
  const prop = (name: string, line: number, from: number, to: number): CodeSymbol => ({ name, kind: PROPERTY, range: { startLineNumber: line, startColumn: from, endLineNumber: line, endColumn: to }, selectionRange: { startLineNumber: line, startColumn: from, endLineNumber: line, endColumn: from + name.length } })
  const big = (): CodeSymbol[] =>
    Array.from({ length: 52_000 }, (_, i) =>
      sym(`value${i}`, CONSTANT, i + 2, i + 2, [prop('id', i + 2, 24, 29), prop('name', i + 2, 31, 44), prop('tags', i + 2, 46, 75), prop('active', i + 2, 77, 89)], 14),
    )

  it('builds, sorts, filters, marks and finds the current row of 260 000 symbols in time', () => {
    const symbols = big()
    const time = (work: () => void): number => {
      const t0 = performance.now()
      work()
      return performance.now() - t0
    }
    let tree!: OutlineTree
    const buildMs = time(() => (tree = build(symbols)))
    expect(tree.size).toBe(260_000)
    let rows!: ReturnType<typeof view>
    const rowsMs = time(() => (rows = view(tree)))
    expect(rows.rows.length).toBe(260_000)
    const nameMs = time(() => view(tree, { sort: 'name' }))
    const filterMs = time(() => view(tree, { filter: 'value5123' }))
    const marksMs = time(() => markSymbols(tree, Array.from({ length: 500 }, (_, i) => ({ severity: 8, startLineNumber: i * 100 + 2, startColumn: 30 }))))
    let at = -1
    const currentMs = time(() => {
      for (let line = 2; line < 52_000; line += 13) at = currentRow(tree, rows, line, 35)
    })
    expect(tree.name[rows.rows[at]]).toBe('name')
    console.log(`[YAZ-3486 S12] 260k symbols: build ${buildMs.toFixed(0)} ms, rows ${rowsMs.toFixed(0)} ms, sort by name ${nameMs.toFixed(0)} ms, filter ${filterMs.toFixed(0)} ms, marks of 500 errors ${marksMs.toFixed(1)} ms, 4000 cursor lookups ${currentMs.toFixed(1)} ms`)
    // Generous ceilings for a slow CI machine; the numbers this Mac measures are in the log line above.
    expect(buildMs).toBeLessThan(1500)
    expect(rowsMs).toBeLessThan(500)
    expect(nameMs).toBeLessThan(2500)
    expect(filterMs).toBeLessThan(500)
    expect(marksMs).toBeLessThan(200)
    // One lookup is what a cursor move or a scroll frame costs.
    expect(currentMs / 4000).toBeLessThan(0.05)
  })
})
