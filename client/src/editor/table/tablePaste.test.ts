/**
 * Paste and copy like a spreadsheet (YAZ-3764, YAZ-3696 🔒 D4 / S1 / S2), on the real editor in jsdom.
 * Each paste goes through `EditorView.pasteHTML` / `pasteText`, so every `handlePaste` in the app runs.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cellPos, mountTable, unmountAll } from './tableTestKit'
import { pasteIntoCells } from './tablePaste'

afterEach(unmountAll)

const clipboard = (html: string, text: string) =>
  ({ clipboardData: { getData: (t: string) => (t === 'text/html' ? html : t === 'text/plain' ? text : '') }, preventDefault() {} }) as unknown as ClipboardEvent
const pasteHtml = (view: EditorView, html: string, text: string) => view.pasteHTML(html, clipboard(html, text))
const pasteText = (view: EditorView, text: string) => view.pasteText(text, clipboard('', text))

/** A Google Sheets copy: `text/html` with a `<table>` of `<td>` cells, `text/plain` TSV. */
const sheets = (rows: string[][]) => ({
  html: `<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" data-sheets-root="1"><colgroup><col width="100"/></colgroup><tbody>${rows.map((r) => `<tr style="height:21px;">${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></google-sheets-html-origin>`,
  text: rows.map((r) => r.join('\t')).join('\n'),
})

const tables = (view: EditorView) => {
  const out: ProseNode[] = []
  view.state.doc.descendants((node) => {
    if (node.type.name === 'table') out.push(node)
    return node.type.name !== 'table'
  })
  return out
}
/** The first table's text, row by row. */
const grid = (view: EditorView) => {
  const rows: string[][] = []
  tables(view)[0]!.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(cell.textContent))
    rows.push(cells)
  })
  return rows
}
const caretIn = (view: EditorView, row: number, col: number) =>
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, row, col) + 2)))
const selectCells = (view: EditorView, from: [number, number], to: [number, number]) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
const cellAt = (view: EditorView, row: number, col: number) => view.state.doc.nodeAt(cellPos(view, row, col))!
const setCell = (view: EditorView, row: number, col: number, attrs: Record<string, unknown>) =>
  view.dispatch(view.state.tr.setNodeMarkup(cellPos(view, row, col), null, { ...cellAt(view, row, col).attrs, ...attrs }))
/** What a copy of the current selection puts on the clipboard. */
const copy = (view: EditorView) => {
  const { dom, text } = view.serializeForClipboard(view.state.selection.content())
  return { html: dom.innerHTML, text }
}

describe('paste cells into a table (D4)', () => {
  it('cells copied in this app fill from the caret cell, right and down, and keep fill and colour', async () => {
    const view = await mountTable('| h1 | h2 | h3 |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |\n| g | h | i |\n')
    setCell(view, 1, 0, { fill: 'blue' })
    setCell(view, 1, 1, { color: 'red' })
    selectCells(view, [1, 0], [2, 1])
    const copied = copy(view)
    caretIn(view, 2, 1)
    pasteHtml(view, copied.html, copied.text)
    expect(tables(view)).toHaveLength(1)
    expect(grid(view)).toEqual([['h1', 'h2', 'h3'], ['a', 'b', 'c'], ['d', 'a', 'b'], ['g', 'd', 'e']])
    expect(cellAt(view, 2, 1).attrs.fill).toBe('blue')
    expect(cellAt(view, 2, 2).attrs.color).toBe('red')
    expect(view.state.selection).toBeInstanceOf(CellSelection)
  })

  it('a paste bigger than the table adds rows and columns', async () => {
    const view = await mountTable()
    const { html, text } = sheets([['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']])
    caretIn(view, 2, 1)
    pasteHtml(view, html, text)
    expect(grid(view)).toEqual([['h1', 'h2', '', ''], ['a', 'b', '', ''], ['c', '1', '2', '3'], ['', '4', '5', '6'], ['', '7', '8', '9']])
    const table = tables(view)[0]!
    expect(table.firstChild!.type.name).toBe('table_header_row')
    table.forEach((row, _, r) => { if (r > 0) expect(row.type.name).toBe('table_row') })
    expect(new Set(table.content.content.map((row) => row.childCount))).toEqual(new Set([4]))
  })

  it('Sheets cells pasted into the header row become header cells', async () => {
    const view = await mountTable()
    const { html, text } = sheets([['x', 'y'], ['z', 'w']])
    caretIn(view, 0, 0)
    pasteHtml(view, html, text)
    expect(grid(view)).toEqual([['x', 'y'], ['z', 'w'], ['c', 'd']])
    expect(cellAt(view, 0, 0).type.name).toBe('table_header')
    expect(cellAt(view, 1, 0).type.name).toBe('table_cell')
  })

  it('one Sheets row is the row itself, not an empty header plus the row', async () => {
    const view = await mountTable()
    const { html, text } = sheets([['x', 'y']])
    caretIn(view, 1, 0)
    pasteHtml(view, html, text)
    expect(grid(view)).toEqual([['h1', 'h2'], ['x', 'y'], ['c', 'd']])
  })

  it('tab-separated text with no HTML splits into cells; the cells keep their fill', async () => {
    const view = await mountTable()
    setCell(view, 1, 1, { fill: 'green' })
    caretIn(view, 1, 0)
    pasteText(view, 'x\ty\nz\tw\n')
    expect(grid(view)).toEqual([['h1', 'h2'], ['x', 'y'], ['z', 'w']])
    expect(cellAt(view, 1, 1).attrs.fill).toBe('green')
  })

  it('one value pasted into selected cells goes in each cell; fills stay', async () => {
    const view = await mountTable()
    setCell(view, 1, 0, { fill: 'pink' })
    selectCells(view, [1, 0], [2, 1])
    pasteText(view, 'v')
    expect(grid(view)).toEqual([['h1', 'h2'], ['v', 'v'], ['v', 'v']])
    expect(cellAt(view, 1, 0).attrs.fill).toBe('pink')
  })

  it('one copied cell pasted into selected cells goes in each cell', async () => {
    const view = await mountTable()
    selectCells(view, [1, 0], [1, 0])
    const copied = copy(view)
    selectCells(view, [1, 1], [2, 1])
    pasteHtml(view, copied.html, copied.text)
    expect(grid(view)).toEqual([['h1', 'h2'], ['a', 'a'], ['c', 'a']])
  })

  it('several lines without tabs in one cell keep the cell paste of today (YAZ-1452 / YAZ-1462)', async () => {
    const view = await mountTable()
    caretIn(view, 1, 0)
    pasteText(view, 'one\ntwo')
    expect(tables(view)).toHaveLength(1)
    expect(grid(view).map((r) => r.length)).toEqual([2, 2, 2])
    expect(cellAt(view, 1, 0).textContent).toBe('one\ntwoa')
    expect(cellAt(view, 1, 1).textContent).toBe('b')
  })

  it('text with a line that starts with a tab stays text in a cell, as outside a table (indented code)', async () => {
    const view = await mountTable()
    caretIn(view, 1, 0)
    pasteText(view, 'if (x) {\n\treturn 1\n}')
    expect(grid(view).map((r) => r.length)).toEqual([2, 2, 2])
    expect(cellAt(view, 1, 0).textContent).toContain('return 1')
    expect(cellAt(view, 1, 1).textContent).toBe('b')
  })

  it('HTML with no <table> is not cells, though ProseMirror gave each paragraph a cell', async () => {
    const view = await mountTable()
    caretIn(view, 1, 0)
    const { schema } = view.state
    const cell = (text: string) => schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text(text)))
    const slice = new Slice(Fragment.from([cell('one'), cell('two')]), 2, 2)
    expect(pasteIntoCells(view, clipboard('<p>one</p><p>two</p>', 'one\n\ntwo'), slice)).toBe(false)
  })

  it('one paste is one undo step', async () => {
    const view = await mountTable()
    caretIn(view, 2, 1)
    const before = view.state.doc
    pasteText(view, '1\t2\n3\t4')
    expect(grid(view)).toHaveLength(4)
    undo(view.state, view.dispatch)
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('a read-only note ignores the paste', async () => {
    const view = await mountTable()
    caretIn(view, 1, 0)
    const before = view.state.doc
    view.setProps({ editable: () => false })
    pasteText(view, 'x\ty\nz\tw')
    pasteHtml(view, sheets([['1']]).html, '1')
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('a 50 × 4 paste into a 500 × 10 table is one transaction with one step', async () => {
    const head = Array.from({ length: 10 }, (_, c) => `c${c}`)
    const body = Array.from({ length: 500 }, (_, r) => `| ${head.map((_, c) => `${r}-${c}`).join(' | ')} |`)
    const view = await mountTable(`| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${body.join('\n')}\n`)
    caretIn(view, 100, 3)
    const text = Array.from({ length: 50 }, (_, r) => ['a', 'b', 'c', 'd'].map((x) => `${x}${r}`).join('\t')).join('\n')
    const dispatch = view.dispatch
    const steps: number[] = []
    view.dispatch = (tr) => { if (tr.docChanged) steps.push(tr.steps.length); dispatch(tr) }
    const start = performance.now()
    pasteText(view, text)
    const ms = performance.now() - start
    console.log(`tablePaste: 50 × 4 into 500 × 10 in ${ms.toFixed(1)} ms (jsdom)`)
    expect(steps).toEqual([1])
    expect(cellAt(view, 100, 3).textContent).toBe('a0')
    expect(cellAt(view, 149, 6).textContent).toBe('d49')
    expect(cellAt(view, 150, 3).textContent).toBe('149-3')
  })
})

describe('copy cells (S1)', () => {
  it('a 2 × 2 copy is tab-separated text and an HTML table, so Sheets pastes cells', async () => {
    const view = await mountTable()
    selectCells(view, [1, 0], [2, 1])
    const { html, text } = copy(view)
    expect(text).toBe('a\tb\nc\td')
    expect(html).toMatch(/^<table[^>]*><tbody><tr[^>]*><td/)
    expect(html.match(/<td/g)).toHaveLength(4)
  })
})

describe('paste outside a table (S2)', () => {
  const outside = async () => {
    const view = await mountTable('para\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)))
    return view
  }

  it('Sheets HTML makes a new table; the first row is the header row (today, no fix)', async () => {
    const view = await outside()
    const { html, text } = sheets([['x', 'y'], ['z', 'w']])
    pasteHtml(view, html, text)
    expect(grid(view)).toEqual([['x', 'y'], ['z', 'w']])
    expect(tables(view)[0]!.firstChild!.type.name).toBe('table_header_row')
  })

  it('tab-separated text with no HTML makes a new table; the first row is the header row; one undo step', async () => {
    const view = await outside()
    const before = view.state.doc
    pasteText(view, 'x\ty\nz\tw\n')
    expect(view.state.doc.firstChild!.textContent).toBe('para')
    expect(grid(view)).toEqual([['x', 'y'], ['z', 'w']])
    expect(tables(view)[0]!.firstChild!.type.name).toBe('table_header_row')
    undo(view.state, view.dispatch)
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('text indented with tabs, or one line, stays text', async () => {
    const view = await outside()
    pasteText(view, 'if (x) {\n\treturn 1\n}')
    pasteText(view, 'a\tb')
    expect(tables(view)).toHaveLength(0)
  })
})
