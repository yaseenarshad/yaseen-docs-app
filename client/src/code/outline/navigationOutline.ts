/**
 * THE OUTLINE OF A TS OR JS FILE, MADE IN THE TS WORKER (YAZ-3501). Pure: no Monaco, no DOM, so the
 * worker (`code/tsWorker.ts`) and the tests import it alike.
 *
 * WHY IN THE WORKER. Monaco's own path (`_executeDocumentSymbolProvider`) copies TypeScript's whole
 * navigation tree from the worker to the page, turns each offset into a line and a column there, and
 * builds its `OutlineModel` there. For `big-5mb.ts` (260 000 symbols) that was about 1 s of the page's
 * one thread after each pause in the typing: the keys typed then waited. Here the worker does it all and
 * hands the page one packed buffer (`outlinePack.ts`).
 *
 * THE SAME SYMBOLS AS MONACO'S. The rules are Monaco's TypeScript `OutlineAdapter` (monaco-editor 0.57,
 * `languages/features/typescript/languageFeatures.js`): the root item (the script) is not a symbol;
 * each item's `text` is its name; its kind comes from `KIND_OF` (else Variable); its range AND its
 * selection range are its first span.
 */
import { buildTree, type CodeSymbol, type OutlineTree, type SymbolRange } from './outlineModel'

/** TypeScript's `NavigationTree`, the fields the Outline reads. */
export interface NavigationItem {
  text: string
  kind: string
  spans: readonly { start: number; length: number }[]
  childItems?: readonly NavigationItem[]
}

/** A 1-based line and column of a text offset, as Monaco's models give it. */
export type PositionAt = (offset: number) => { lineNumber: number; column: number }

/** Monaco's `SymbolKind` numbers the adapter uses. */
const MODULE = 1
const CLASS = 4
const METHOD = 5
const PROPERTY = 6
const ENUM = 9
const INTERFACE = 10
const FUNCTION = 11
const VARIABLE = 12

/** Monaco's `outlineTypeTable`: TypeScript's `ScriptElementKind` → Monaco's `SymbolKind`. */
const KIND_OF: Readonly<Record<string, number>> = {
  module: MODULE,
  class: CLASS,
  enum: ENUM,
  interface: INTERFACE,
  method: METHOD,
  property: PROPERTY,
  getter: PROPERTY,
  setter: PROPERTY,
  var: VARIABLE,
  const: VARIABLE,
  'local var': VARIABLE,
  function: FUNCTION,
  'local function': FUNCTION,
}

/** The symbols of `root`'s children, Monaco's shape. Iterative: a deep tree never runs out of stack. */
export function symbolsOfNavigation(root: NavigationItem | undefined, positionAt: PositionAt): CodeSymbol[] {
  const top: CodeSymbol[] = []
  if (root?.childItems === undefined) return top
  const stack: { items: readonly NavigationItem[]; into: CodeSymbol[] }[] = [{ items: root.childItems, into: top }]
  while (stack.length > 0) {
    const { items, into } = stack.pop()!
    for (const item of items) {
      const span = item.spans[0]
      if (span === undefined) continue
      const start = positionAt(span.start)
      const end = positionAt(span.start + span.length)
      const range: SymbolRange = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }
      const symbol: CodeSymbol & { children?: CodeSymbol[] } = { name: item.text, kind: KIND_OF[item.kind] ?? VARIABLE, range, selectionRange: range }
      if (item.childItems !== undefined) {
        symbol.children = []
        stack.push({ items: item.childItems, into: symbol.children })
      }
      into.push(symbol)
    }
  }
  return top
}

/**
 * The Outline's tree of a navigation tree: what the page's feed would have built from Monaco's symbols.
 * Names inside functions are left out unless `showLocals` (YAZ-3507, `buildTree`).
 */
export function outlineOfNavigation(root: NavigationItem | undefined, positionAt: PositionAt, showLocals = false): OutlineTree {
  return buildTree(symbolsOfNavigation(root, positionAt), showLocals)
}
