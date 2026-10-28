/**
 * The TS worker's Outline (YAZ-3501): TypeScript's navigation tree of a real file, turned into the
 * Outline's tree by Monaco's own rules, then packed into one buffer and unpacked on the page side.
 * The tree must be the one the page built from Monaco's symbols before the move, so every Outline
 * rule (S1–S12) keeps working; and the packed tree must come back the same, at 5 MB too.
 */
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { outlineOfNavigation, symbolsOfNavigation, type NavigationItem, type PositionAt } from './navigationOutline'
import { buildTree, type CodeSymbol } from './outlineModel'
import { packTree, unpackTree } from './outlinePack'

/** TypeScript's navigation tree of `text`, as Monaco's TS worker asks for it. */
function navigationOf(text: string, fileName = 'file.ts'): NavigationItem {
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({}),
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => (name === fileName ? ts.ScriptSnapshot.fromString(text) : undefined),
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => 'lib.d.ts',
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? text : undefined),
  }
  return ts.createLanguageService(host).getNavigationTree(fileName)
}

/** Monaco's `positionAt`: 1-based line and column of an offset. */
function positionsOf(text: string): PositionAt {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { lineNumber: lo + 1, column: offset - starts[lo] + 1 }
  }
}

const SOURCE = [
  'export class Pipeline {', //          1
  '  step1() {', //                       2
  '    const value1 = 1', //              3
  '    return value1', //                 4
  '  }', //                               5
  '  get size() { return 1 }', //         6
  '}', //                                 7
  'export interface Shape { id: number }', // 8
  'export enum Color { Red }', //         9
  'export function make() { return 1 }', // 10
  'export const LIMIT = 40', //           11
  'let counter = 0', //                   12
  'namespace Space { export const x = 1 }', // 13
  '',
].join('\n')

const range = (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => ({ startLineNumber, startColumn, endLineNumber, endColumn })

describe('symbolsOfNavigation', () => {
  it('Monaco’s rules: no root item; the name; the kind from its table (else Variable); the first span as range and selection', () => {
    const symbols = symbolsOfNavigation(navigationOf(SOURCE), positionsOf(SOURCE))
    const brief = (list: readonly CodeSymbol[] | undefined): unknown => list?.map((s) => [s.name, s.kind, ...(s.children ? [brief(s.children)] : [])])
    expect(brief(symbols)).toEqual([
      ['Color', 9, [['Red', 12]]], // enum member: not in Monaco's table, so Variable
      ['counter', 12],
      ['LIMIT', 12], // const: Variable, as Monaco gives it
      ['make', 11],
      ['Pipeline', 4, [['size', 6], ['step1', 5, [['value1', 12]]]]],
      ['Shape', 10, [['id', 6]]],
      ['Space', 1, [['x', 12]]],
    ])
    const pipeline = symbols.find((s) => s.name === 'Pipeline')!
    expect(pipeline.range).toEqual(range(1, 1, 7, 2))
    expect(pipeline.selectionRange).toEqual(pipeline.range)
    expect(pipeline.children!.find((s) => s.name === 'step1')!.range).toEqual(range(2, 3, 5, 4))
  })

  it('no tree, or a tree with no children: no symbol', () => {
    expect(symbolsOfNavigation(undefined, positionsOf(''))).toEqual([])
    expect(symbolsOfNavigation({ text: '<global>', kind: 'script', spans: [{ start: 0, length: 0 }] }, positionsOf(''))).toEqual([])
  })

  it('the tree is buildTree of those symbols: the same rows, order, keys and ranges the page built before', () => {
    const at = positionsOf(SOURCE)
    expect(outlineOfNavigation(navigationOf(SOURCE), at)).toEqual(buildTree(symbolsOfNavigation(navigationOf(SOURCE), at)))
    expect(outlineOfNavigation(navigationOf(SOURCE), at).name.slice(0, 5)).toEqual(['Pipeline', 'step1', 'value1', 'size', 'Shape'])
  })
})

describe('packTree / unpackTree', () => {
  it('a tree comes back the same: every column, name, lower-case name, key, child list and root', () => {
    const tree = outlineOfNavigation(navigationOf(SOURCE), positionsOf(SOURCE))
    const back = unpackTree(packTree(tree))!
    expect(back).toEqual(tree)
    expect(back.children.map((c) => [...c])).toEqual(tree.children.map((c) => [...c]))
  })

  it('names with any character: astral, accents, an empty key, a NUL', () => {
    const tree = buildTree([
      { name: 'İstanbul 🎉', kind: 4, range: range(1, 1, 3, 1), selectionRange: range(1, 7, 1, 10), children: [{ name: 'a\u0000b', kind: 5, range: range(2, 1, 2, 9), selectionRange: range(2, 1, 2, 9) }] },
      { name: '', kind: 99, range: range(4, 1, 4, 2), selectionRange: range(4, 1, 4, 2) },
    ])
    expect(unpackTree(packTree(tree))).toEqual(tree)
  })

  it('an empty tree, and a buffer that is not a packed tree', () => {
    const empty = buildTree([])
    expect(unpackTree(packTree(empty))).toEqual(empty)
    expect(unpackTree(new ArrayBuffer(3))).toBeNull()
    expect(unpackTree(new Int32Array([7, 0, 0, 0, 0]).buffer)).toBeNull()
  })

  it('`big-5mb.ts` (52 000 lines, 260 000 symbols): the worker’s tree comes back the same', () => {
    const text = `// About 5 MB.\n${Array.from({ length: 52_000 }, (_, i) => `export const value${i} = { id: ${i}, name: 'row ${i}', tags: ['alpha', 'beta', 'gamma'], active: ${i % 2 === 0 ? 'false' : 'true'} }`).join('\n')}\n`
    const tree = outlineOfNavigation(navigationOf(text), positionsOf(text))
    expect(tree.size).toBe(260_000)
    const t0 = performance.now()
    const back = unpackTree(packTree(tree))!
    const ms = performance.now() - t0
    expect(back.size).toBe(260_000)
    expect(back.name[259_999]).toBe('active')
    expect(back.lower[5]).toBe('value1')
    expect(back.startLine[5]).toBe(3)
    expect(back.roots).toHaveLength(52_000)
    expect(back.children[0]).toEqual([1, 2, 3, 4])
    expect(back.key).toEqual(tree.key)
    console.log(`[YAZ-3501] pack + unpack of 260 000 symbols: ${ms.toFixed(0)} ms`)
  }, 60_000)
})
