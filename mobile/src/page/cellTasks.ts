import type { Token, Tokens } from 'marked'
import type { PageTask } from './pageMarked'

/**
 * YAZ-5618: TASKS IN A TABLE CELL, as the Mac reads them. A table row is one line of the file, so a body cell's list is
 * HTML (`client/src/editor/table/cellLists.ts`, YAZ-3818 D2): `<ul>` / `<ol>` / `<ol start="N">`, `<li>…</li>`, and a
 * task is an item whose text starts with `[ ] ` or `[x] ` (`[X] ` too) right after its `<li>`. The Mac reads the cell as
 * lists only in that exact form: tags that balance, no text between a list's tags and its items, no other HTML in a
 * list (a `<br>` is a line break, not HTML); else the cell is its text, and the brackets show as typed. A header cell is
 * never read as a list (D7). An escaped `\[ ] ` is a plain bullet (5A-12): the source tells them apart.
 *
 * The Mac writes a tick back as `[x] ` (`writeCellList`: `[X] ` is written `[x] ` too) and an untick as `[ ] `. So a
 * tick from the phone changes ONE byte, the one between the brackets (`comments/taskWrite.ts`), as for a task of the
 * page: every other byte of the row stays.
 *
 * Read from `marked`'s cell tokens (the reader's parse: a tag in a code span is no tag), with each token's place in the
 * row's own line, so the box a person taps is the byte a tick writes. A cell task's `core` names the cell and the item:
 * `|<column>|<item path>|[ ] <its first line>` (the path: the item's place at each level, from the cell down, as
 * `0.2.1`; the items of two lists side by side are counted on); its line is the row's. Twins (the same column, path and words in other rows) are told apart
 * by their place and the rows around them, as twin tasks of a page are (YAZ-5570, `taskFor`).
 */

const OPEN_LIST = /^<(ul|ol)(?: start="(\d+)")?>$/
const BR = /^<br\s*\/?>$/i
const BOX = /^\[( |x|X)\] /

/** A cell's `<li>` tag that opens a task: the box goes there (`pageRender.ts`). */
export type CellTaskTag = Tokens.HTML & { cellTask?: PageTask }

/** The core of a cell task (`|col|path|[ ] words`). */
export const cellTaskCore = (col: number, path: readonly number[], words: string): string => `|${col}|${path.join('.')}|[ ] ${words}`

/**
 * The cells of a table row's source (`row`, its own text, no line end), as GFM splits them: at each pipe not escaped
 * by a backslash; a blank first and last part (the outer pipes) go, as in `marked`. Each as its trimmed range in `row`.
 */
export function cellRanges(row: string): Array<{ from: number; to: number }> {
  const cuts = [-1]
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\') i++
    else if (row[i] === '|') cuts.push(i)
  }
  cuts.push(row.length)
  const parts: Array<{ from: number; to: number }> = []
  for (let k = 0; k + 1 < cuts.length; k++) {
    let from = cuts[k]! + 1
    let to = cuts[k + 1]!
    while (from < to && /\s/.test(row[from]!)) from++
    while (to > from && /\s/.test(row[to - 1]!)) to--
    parts.push({ from, to })
  }
  if (parts.length > 0 && parts[0]!.from === parts[0]!.to) parts.shift()
  if (parts.length > 0 && parts.at(-1)!.from === parts.at(-1)!.to) parts.pop()
  return parts
}

/** Where each character of a cell's text (`marked`'s: `\|` read as `|`) is in its source `src`; null when they differ. */
function placesOf(src: string, text: string): number[] | null {
  const at: number[] = []
  let read = ''
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\' && src[i + 1] === '|') i++
    at.push(i)
    read += src[i]
  }
  return read === text ? at : null
}

/** Counts the items of the lists in a cell, or in an item: the next item's place. */
interface Owner {
  kids: number
}
interface ListFrame {
  kind: 'list'
  ordered: boolean
  items: number
  path: number[]
  owner: Owner
}
interface ItemFrame extends Owner {
  kind: 'item'
  path: number[]
  /** Where its words start in the cell's text (after its box, if any), and where its first line ends. */
  from: number
  to: number | null
  box: { at: number; checked: boolean; tag: CellTaskTag; text: Tokens.Text } | null
}

/**
 * The tasks of one body cell (`cell`, column `col`), as the Mac reads them: none unless the cell is lists in the exact
 * form. `place(i)`: where character `i` of the cell's text is in the row's line.
 */
function cellTasks(cell: Tokens.TableCell, col: number, place: (i: number) => number, line: number): Array<{ task: PageTask; tag: CellTaskTag; text: Tokens.Text }> {
  const tokens = cell.tokens
  if (!tokens.some((t) => t.type === 'html' && OPEN_LIST.test(t.raw))) return []
  const out: Array<{ task: PageTask; tag: CellTaskTag; text: Tokens.Text }> = []
  const stack: Array<ListFrame | ItemFrame> = []
  const root: Owner = { kids: 0 }
  let at = 0
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]!
    const top = stack.at(-1)
    const tag = token.type === 'html' && !BR.test(token.raw) ? token.raw : null
    const open = tag === null ? null : OPEN_LIST.exec(tag)
    const here = at
    at += token.raw.length
    if (open !== null || tag === '</li>') if (top?.kind === 'item' && top.to === null) top.to = here
    if (open !== null) {
      if (top?.kind === 'list') return []
      stack.push({ kind: 'list', ordered: open[1] === 'ol', items: 0, path: top?.kind === 'item' ? top.path : [], owner: top ?? root })
    } else if (tag === '<li>') {
      if (top?.kind !== 'list') return []
      top.items++
      const item: ItemFrame = { kind: 'item', path: [...top.path, top.owner.kids++], kids: 0, from: at, to: null, box: null }
      const next = tokens[k + 1]
      const m = next?.type === 'text' ? BOX.exec(next.raw) : null
      if (m !== null) {
        item.box = { at: at + 1, checked: m[1] !== ' ', tag: token as CellTaskTag, text: next as Tokens.Text }
        item.from = at + m[0].length
      }
      stack.push(item)
    } else if (tag === '</li>') {
      if (top?.kind !== 'item') return []
      stack.pop()
      if (top.box !== null) {
        const words = cell.text.slice(top.from, top.to ?? here)
        out.push({ task: { line, box: place(top.box.at), checked: top.box.checked, core: cellTaskCore(col, top.path, words) }, tag: top.box.tag, text: top.box.text })
      }
    } else if (tag === '</ul>' || tag === '</ol>') {
      if (top?.kind !== 'list' || top.ordered !== (tag === '</ol>') || top.items === 0) return []
      stack.pop()
    } else if (top !== undefined && (top.kind === 'list' || tag !== null)) {
      return []
    }
  }
  // In document order: a parent task before the tasks under it.
  return stack.length === 0 ? out.sort((x, y) => x.task.box - y.task.box) : []
}

/**
 * The tasks in the body cells of `table` (its first line `line` of `lines`, the text's own; `firstLine`: that text's
 * first line in the page), in document order. Each task's `<li>` tag gets its task (`cellTask`) and its text loses the
 * box (`[ ] `), so the reader draws the box in its place, as for a task of the page. A row whose line does not end with
 * the row as the parse read it (it is not the table's own line) has no task: never a guess at another line.
 */
export function tableTasks(table: Tokens.Table, lines: readonly string[], line: number, firstLine: number): PageTask[] {
  const raw = table.raw.split('\n')
  const out: PageTask[] = []
  table.rows.forEach((cells, r) => {
    const rowRaw = raw[2 + r]
    const own = lines[line + 2 + r]
    if (rowRaw === undefined || own === undefined || !own.endsWith(rowRaw)) return
    const shift = own.length - rowRaw.length
    const ranges = cellRanges(rowRaw)
    cells.forEach((cell, c) => {
      const range = ranges[c]
      if (range === undefined || cell.tokens.map((t: Token) => t.raw).join('') !== cell.text) return
      const at = placesOf(rowRaw.slice(range.from, range.to), cell.text)
      if (at === null) return
      for (const { task, tag, text } of cellTasks(cell, c, (i) => shift + range.from + at[i]!, line + 2 + r + firstLine)) {
        out.push(task)
        tag.cellTask = task
        // The box is drawn for it: its brackets are no text.
        text.raw = text.raw.slice(4)
        text.text = text.text.slice(4)
      }
    })
  })
  return out
}
