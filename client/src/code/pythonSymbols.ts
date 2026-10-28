/**
 * THE PYTHON OUTLINE, READ FROM THE TEXT (YAZ-3486; YAZ-3439 "Decision — The Python Outline is read
 * from the text, with no helper"). Monaco has no symbols for Python, and the Outline must not need a
 * language helper. So this small reader finds the rows in the text itself, in the renderer:
 *
 *  - A `class`, `def` or `async def` line starts a row: a class, a method (a `def` directly inside a
 *    class), or a function. Its indentation puts it in the tree: it ends at the last line of code
 *    before the next statement that is not indented more.
 *  - A decorator (`@…`) belongs to the next `class` or `def`: the row's range starts on it.
 *  - A top-level `UPPER_CASE = …` (or `UPPER_CASE: T = …`) is a constant.
 *  - Text inside strings — triple-quoted ones across lines too — and comments is never read as code: a
 *    docstring that says "def" is no row.
 *  - A statement continues on the next line inside open brackets (a long `def` signature) and after
 *    a `\` at the end of a line. Only the first line of a statement can start a row.
 *
 * It returns Monaco's `DocumentSymbol` shape (`CodeSymbol`), the shape the other languages' symbols
 * have, so the Outline does not know where its rows came from. One pass over the text, no regular
 * expression per character: a 5 000-line file takes about a millisecond.
 */
import type { CodeSymbol } from './outline/outlineModel'

/** Monaco's `SymbolKind` numbers of the rows this reader makes. */
const CLASS = 4
const METHOD = 5
const FUNCTION = 11
const CONSTANT = 13

const DEF = /^(?:async[ \t]+)?def[ \t]+([A-Za-z_][A-Za-z0-9_]*)/
const CLASS_LINE = /^class[ \t]+([A-Za-z_][A-Za-z0-9_]*)/
const CONSTANT_LINE = /^([A-Z_][A-Z0-9_]*)[ \t]*(?::[^=]*)?=(?!=)/

interface Open {
  symbol: CodeSymbol & { children: CodeSymbol[] }
  indent: number
  /** A constant has no body: the next statement closes it, at any indentation. */
  leaf: boolean
}

/** The width of a line's indentation: a tab goes to the next multiple of 8, as Python counts it. */
function indentOf(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width++
    else if (ch === '\t') width = width - (width % 8) + 8
    else if (ch === '\f') width = 0
    else break
  }
  return width
}

/** Where the scan of the text stands at the end of a line. */
interface ScanState {
  /** The open triple quote (`"""` or `'''`), or null. */
  triple: string | null
  /** Open brackets: a statement goes on. */
  depth: number
  /** The line ended with `\`: a statement goes on. */
  joined: boolean
  /** The line holds code: not blank, not only a comment, not only inside a string that was open at its start. */
  code: boolean
}

/** Reads one line from `state` on: strings, comments, brackets and the trailing `\`. */
function scanLine(line: string, state: ScanState): void {
  state.joined = false
  state.code = false
  let i = 0
  const n = line.length
  while (i < n) {
    if (state.triple !== null) {
      const end = line.indexOf(state.triple, i)
      // A string that started on an earlier line counts as code: the line is part of a statement.
      state.code = true
      if (end === -1) return
      // A triple quote closes only where it is not escaped.
      let backslashes = 0
      for (let b = end - 1; b >= 0 && line[b] === '\\'; b--) backslashes++
      i = end + 3
      if (backslashes % 2 === 0) state.triple = null
      continue
    }
    const ch = line[i]
    if (ch === '#') return
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\r') {
      i++
      continue
    }
    state.code = true
    if (ch === '"' || ch === "'") {
      if (line.startsWith(ch.repeat(3), i)) {
        state.triple = ch.repeat(3)
        i += 3
        continue
      }
      // A one-line string: to its closing quote, past escapes; an unclosed one ends with the line.
      i++
      while (i < n && line[i] !== ch) i += line[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') state.depth++
    else if (ch === ')' || ch === ']' || ch === '}') state.depth = Math.max(0, state.depth - 1)
    else if (ch === '\\' && i === n - 1) state.joined = true
    i++
  }
}

const position = (line: number, column: number) => ({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column })

/** The symbols of a Python file's text, as a tree. */
export function pythonSymbols(text: string): CodeSymbol[] {
  const lines = text.split(/\r\n|\r|\n/)
  const roots: CodeSymbol[] = []
  const open: Open[] = []
  const state: ScanState = { triple: null, depth: 0, joined: false, code: false }
  /** The last line (1-based) that held code, and its length: where a closing row ends. */
  let lastCode = 0
  let lastCodeLength = 0
  /** The first line of the decorators above the next `class` or `def`; 0 for none. */
  let decorated = 0

  const close = (to: Open): void => {
    to.symbol.range = { ...to.symbol.range, endLineNumber: Math.max(lastCode, to.symbol.range.startLineNumber), endColumn: lastCode >= to.symbol.range.startLineNumber ? lastCodeLength + 1 : to.symbol.range.endColumn }
    if (to.symbol.children.length === 0) delete (to.symbol as CodeSymbol).children
  }
  const add = (symbol: Open['symbol'], indent: number, leaf: boolean): void => {
    const parent = open[open.length - 1]
    if (parent === undefined) roots.push(symbol)
    else parent.symbol.children.push(symbol)
    open.push({ symbol, indent, leaf })
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const number = index + 1
    // A statement starts here only when nothing from the line above goes on.
    const starts = state.triple === null && state.depth === 0 && !state.joined
    scanLine(line, state)
    if (!state.code) continue
    if (starts) {
      const indent = indentOf(line)
      const body = line.slice(line.length - line.trimStart().length)
      // Every row this statement is not inside ends before it: a dedent, or a sibling.
      while (open.length > 0 && (open[open.length - 1].leaf || open[open.length - 1].indent >= indent)) close(open.pop()!)
      const column = line.length - body.length + 1
      const def = DEF.exec(body)
      const cls = def === null ? CLASS_LINE.exec(body) : null
      if (def !== null || cls !== null) {
        const name = (def ?? cls)![1]
        const nameColumn = column + (def ?? cls)![0].length - name.length
        const inClass = open.length > 0 && open[open.length - 1].symbol.kind === CLASS
        const start = decorated !== 0 ? decorated : number
        add(
          {
            name,
            kind: cls !== null ? CLASS : inClass ? METHOD : FUNCTION,
            range: { startLineNumber: start, startColumn: decorated !== 0 ? indentOf(lines[start - 1]) + 1 : column, endLineNumber: number, endColumn: line.length + 1 },
            selectionRange: { ...position(number, nameColumn), endColumn: nameColumn + name.length },
            children: [],
          },
          indent,
          false,
        )
        decorated = 0
      } else if (body.startsWith('@')) {
        if (decorated === 0) decorated = number
      } else {
        decorated = 0
        const constant = open.length === 0 ? CONSTANT_LINE.exec(body) : null
        if (constant !== null) {
          const name = constant[1]
          add({ name, kind: CONSTANT, range: { startLineNumber: number, startColumn: column, endLineNumber: number, endColumn: line.length + 1 }, selectionRange: { ...position(number, column), endColumn: column + name.length }, children: [] }, indent, true)
        }
      }
    }
    lastCode = number
    lastCodeLength = line.length
  }
  while (open.length > 0) close(open.pop()!)
  return roots
}
