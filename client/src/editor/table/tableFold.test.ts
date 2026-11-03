/**
 * Fold rows (YAZ-4165, YAZ-4159 D3): the `fold` part, the fold mark on the rows' cells, the bar and the hidden rows,
 * "Fold N rows" and a click on the bar, the calendar marker on a bar, and a fold through a sort, an insert, a delete,
 * a freeze, a fill down and a paste — on real editors (`createCrepe`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { DOMParser, DOMSerializer, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuItem } from '../../sidebar/menuSections'
import { getMarkdownForSave } from '../createCrepe'
import { noteMenuSections } from '../noteMenu'
import { calendarTick, goToNow } from './tableCalendar'
import { formatTableComment, parseTableComment, plainTable, type TableStyle } from './tableComment'
import { fillCells } from './tableFill'
import { cellPos, mountNote, unmountAll } from './tableTestKit'
import { pressKey } from '../marks/markTestKit'
import tableCss from './table.css?inline'

afterEach(async () => {
  await unmountAll()
  vi.useRealTimers()
})

const style = (parts: Partial<TableStyle>): TableStyle => ({ ...plainTable(), ...parts })

/** A table of `n` body rows `r1`…`rn` (row 2 of the file is `r1`), then `comment` when given. */
const rows = (n: number, comment?: string): string =>
  ['| Name | Note |', '| ---- | ---- |', ...Array.from({ length: n }, (_, i) => `| ${`r${i + 1}`.padEnd(4)} | ${`n${i + 1}`.padEnd(4)} |`)].join('\n') + '\n' + (comment === undefined ? '' : `\n<!-- table: ${comment} -->\n`)

const firstTable = (view: EditorView): { node: ProseNode; pos: number } => {
  let out: { node: ProseNode; pos: number } | null = null
  view.state.doc.descendants((node, pos) => {
    if (out === null && node.type.name === 'table') out = { node, pos }
    return out === null
  })
  return out!
}
const names = (view: EditorView): string[] => {
  const out: string[] = []
  firstTable(view).node.forEach((row) => out.push(row.firstChild!.textContent))
  return out
}
/** The names of the folded rows. */
const folded = (view: EditorView): string[] => {
  const out: string[] = []
  firstTable(view).node.forEach((row) => {
    let fold = false
    row.forEach((cell) => { fold ||= cell.attrs.fold === true })
    if (fold) out.push(row.firstChild!.textContent)
  })
  return out
}
const trs = (view: EditorView) => [...view.dom.querySelectorAll<HTMLTableRowElement>('tbody[data-content-dom] > tr')]
/** Each row's look: `bar <label>`, `hidden`, or `-`. */
const looks = (view: EditorView): string[] =>
  trs(view).map((tr) =>
    tr.classList.contains('table-fold-bar') ? `bar ${tr.firstElementChild!.getAttribute('data-table-fold-label')}` : tr.classList.contains('table-fold-hidden') ? 'hidden' : '-',
  )
const menuItem = (view: EditorView, row: number, col: number, id: string): MenuAction | undefined =>
  noteMenuSections(view, null, vi.fn(), cellPos(view, row, col) + 2)
    .flat()
    .flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
    .find((item) => item.id === id)
const selectCells = (view: EditorView, from: [number, number], to: [number, number]) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
const clickBar = (view: EditorView, row: number) => {
  const cell = trs(view)[row]!.firstElementChild!
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
}

describe('the `fold` part', () => {
  it('`fold 20-29 31-33` round-trips: 1-based rows, row 1 the header', () => {
    const fold = [...Array.from({ length: 10 }, (_, i) => 19 + i), 30, 31, 32]
    expect(parseTableComment('<!-- table: fold 20-29 31-33 -->')).toEqual(style({ fold }))
    expect(formatTableComment(style({ fold }))).toBe('<!-- table: fold 20-29 31-33 -->')
  })

  it('a run of one row is one number; the part goes after `valign`', () => {
    expect(formatTableComment(parseTableComment('<!-- table: stripes, fold 4, valign middle, align A2 center -->')!)).toBe('<!-- table: align A2 center, valign middle, fold 4, stripes -->')
  })

  it.each(['fold 1-3', 'fold 5-3', 'fold 0', 'fold a', 'fold 3-', 'fold'])('%s is a value it does not know: the part is kept as its text (YAZ-4176)', (part) => {
    expect(parseTableComment(`<!-- table: ${part}, stripes -->`)).toEqual(style({ stripes: true, unknown: [{ after: null, text: part }] }))
  })
})

describe('the bar and the hidden rows', () => {
  it('load onto the rows, show the bar on the first row of each run, and save byte for byte', async () => {
    const markdown = rows(8, 'fold 3-5 7-8')
    const { crepe, view } = await mountNote(markdown)
    expect(getMarkdownForSave(crepe)).toBe(markdown)
    expect(folded(view)).toEqual(['r2', 'r3', 'r4', 'r6', 'r7'])
    expect(looks(view)).toEqual(['-', '-', 'bar 3 rows', 'hidden', 'hidden', '-', 'bar 2 rows', 'hidden', '-'])
  })

  it('a copy inside the app keeps the fold (`data-fold` on the cells)', async () => {
    const { view } = await mountNote(rows(4, 'fold 3-4'))
    const { schema } = view.state
    const holder = document.createElement('div')
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeNode(firstTable(view).node))
    const copy = DOMParser.fromSchema(schema).parse(holder).firstChild!
    const out: boolean[] = []
    copy.forEach((row) => out.push(row.firstChild!.attrs.fold as boolean))
    expect(out).toEqual([false, false, true, true, false])
  })

  it('table.css hides the run\'s other rows and draws the label from the data attribute', () => {
    const css = tableCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.table-fold-hidden \{\s*display: none;\s*\}/)
    expect(css).toMatch(/\[data-table-fold-label\]::before \{[^}]*content: attr\(data-table-fold-label\)/)
  })

  it('a calendar table\'s bar reads the times of its first and last rows, in the table\'s own format', async () => {
    const times = ['5:00 pm', '5:30 pm', '6:00 pm', '6:30 pm', '7:00 pm', '7:30 pm', '8:00 pm', '8:30 pm', '9:00 pm', '9:30 pm', '10:00 pm']
    const markdown = ['| Time | Plan |', '| --- | --- |', ...times.map((t) => `| ${t} | |`)].join('\n') + '\n\n<!-- table: fold 3-12, calendar 30m -->\n'
    const { view } = await mountNote(markdown)
    expect(looks(view)[2]).toBe('bar 5:30 pm – 10:00 pm · 10 rows')
  })
})

describe('"Fold N rows" and a click on the bar, one undo step each', () => {
  it('shows on two or more body rows only; the header row never folds', async () => {
    const { crepe, view } = await mountNote(rows(4))
    const before = getMarkdownForSave(crepe)
    expect(menuItem(view, 1, 0, 'table-fold')).toBeUndefined()
    selectCells(view, [0, 0], [2, 1])
    expect(menuItem(view, 0, 0, 'table-fold')?.label).toBe('Fold 2 rows')
    menuItem(view, 0, 0, 'table-fold')!.onSelect()
    expect(folded(view)).toEqual(['r1', 'r2'])
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fold 2-3 -->\n`)
    expect(looks(view)).toEqual(['-', 'bar 2 rows', 'hidden', '-', '-'])
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('after a fold the caret is in the first row below it, not in the hidden rows, and the note keeps its scroll (the YAZ-4163 demo)', async () => {
    const { view } = await mountNote(rows(4))
    const scroller = document.documentElement
    scroller.scrollTop = 120
    selectCells(view, [1, 0], [2, 1])
    menuItem(view, 1, 0, 'table-fold')!.onSelect()
    const { selection } = view.state
    expect(selection).toBeInstanceOf(TextSelection)
    expect(selection.from > cellPos(view, 3, 0) && selection.from < cellPos(view, 3, 1)).toBe(true)
    expect(scroller.scrollTop).toBe(120)
  })

  it('a click on the bar opens the run, and one undo folds it again', async () => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-5'))
    const before = getMarkdownForSave(crepe)
    clickBar(view, 2)
    expect(folded(view)).toEqual([])
    expect(looks(view)).toEqual(['-', '-', '-', '-', '-', '-'])
    expect(getMarkdownForSave(crepe)).not.toContain('<!--')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('a read-only note keeps the run folded on a click', async () => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-5'))
    crepe.setReadonly(true)
    clickBar(view, 2)
    expect(folded(view)).toEqual(['r2', 'r3', 'r4'])
  })
})

describe('the calendar marker on a folded run', () => {
  it('the bar gets the now row and is not past; the rows before it are past', async () => {
    const times = ['5:00 pm', '5:30 pm', '6:00 pm', '6:30 pm', '7:00 pm']
    const markdown = ['| Time | Plan |', '| --- | --- |', ...times.map((t) => `| ${t} | |`)].join('\n') + '\n\n<!-- table: fold 3-5, calendar 30m -->\n'
    const { view } = await mountNote(markdown)
    calendarTick(view, 18 * 60 + 15)
    const row = trs(view)
    expect(row.map((tr) => tr.classList.contains('table-now-row'))).toEqual([false, false, true, false, false, false])
    expect(row.map((tr) => tr.classList.contains('table-past-row'))).toEqual([false, true, false, false, false, false])
    // 6:15 pm is the middle of the second of the run's three slots.
    expect(row[2]!.style.getPropertyValue('--table-now')).toBe('0.5')
  })
})

describe('"Go to now" on a folded now row', () => {
  it('opens the run in the same step and puts the caret in the now row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 18, 15, 0))
    const times = ['5:00 pm', '5:30 pm', '6:00 pm', '6:30 pm', '7:00 pm']
    const { view } = await mountNote(['| Time | Plan |', '| --- | --- |', ...times.map((t) => `| ${t} | |`)].join('\n') + '\n\n<!-- table: fold 3-5, calendar 30m -->\n')
    expect(goToNow(view)).toBe(true)
    expect(folded(view)).toEqual([])
    const $caret = view.state.selection.$from
    expect($caret.node($caret.depth - 2).firstChild!.textContent).toBe('6:00 pm')
    undo(view.state, view.dispatch)
    expect(folded(view)).toEqual(['5:30 pm', '6:00 pm', '6:30 pm'])
  })
})

describe('the fold stays on its rows', () => {
  it('Sort A to Z moves the folded rows with their mark', async () => {
    const { view } = await mountNote('| Name |\n| --- |\n| d |\n| b |\n| c |\n| a |\n\n<!-- table: fold 3-4 -->\n')
    menuItem(view, 1, 0, 'table-sort-asc')!.onSelect()
    expect(names(view)).toEqual(['Name', 'a', 'b', 'c', 'd'])
    expect(folded(view)).toEqual(['b', 'c'])
  })

  it('a row inserted inside a run is not folded, and the run splits in two runs, each with its bar', async () => {
    const { crepe, view } = await mountNote(rows(6, 'fold 3-6'))
    menuItem(view, 2, 0, 'table-insert-row-below')!.onSelect()
    expect(looks(view)).toEqual(['-', '-', 'bar 1 row', '-', 'bar 3 rows', 'hidden', 'hidden', '-'])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: fold 3 5-7 -->')
  })

  it('a row inserted above a run is not folded; the run stays', async () => {
    const { crepe, view } = await mountNote(rows(6, 'fold 3-6'))
    menuItem(view, 2, 0, 'table-insert-row-above')!.onSelect()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: fold 4-7 -->')
  })

  it('a deleted bar row: the next row of the run is the bar', async () => {
    const { crepe, view } = await mountNote(rows(6, 'fold 3-6'))
    menuItem(view, 2, 0, 'table-delete-row')!.onSelect()
    expect(looks(view)).toEqual(['-', '-', 'bar 3 rows', 'hidden', 'hidden', '-'])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: fold 3-5 -->')
  })

  it('a run that holds a frozen row, and a run under a frozen header: both draw; the freeze clamp still works', async () => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-5, freeze 4 rows'))
    const frozen = () => trs(view).map((tr) => tr.classList.contains('table-frozen-row'))
    expect(looks(view)).toEqual(['-', '-', 'bar 3 rows', 'hidden', 'hidden', '-'])
    expect(frozen()).toEqual([true, true, true, true, false, false])
    const under = await mountNote(rows(5, 'fold 2-4, freeze 1 row'))
    expect(looks(under.view)).toEqual(['-', 'bar 3 rows', 'hidden', 'hidden', '-', '-'])
    // Three deletes of the row at row 2 leave r4 (folded) and r5: the count is clamped, the fold stays on r4.
    for (let i = 0; i < 3; i++) menuItem(view, 1, 0, 'table-delete-row')!.onSelect()
    expect(firstTable(view).node.attrs.freezeRows).toBe(3)
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: fold 2, freeze 3 rows -->')
  })
})

describe('the caret steps over a folded run', () => {
  it('↓ from the row above a run goes to the row below it, ↑ comes back; ↓ above a run at the table end leaves the table', async () => {
    const { crepe, view } = await mountNote(`${rows(5, 'fold 3-4')}\nafter\n`)
    const cellText = () => view.state.selection.$from.parent.textContent
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
    expect(pressKey(crepe, 'ArrowDown')).toBe(true)
    expect(cellText()).toBe('r4')
    expect(pressKey(crepe, 'ArrowUp')).toBe(true)
    expect(cellText()).toBe('r1')
    const end = await mountNote(`${rows(3, 'fold 3-4')}\nafter\n`)
    end.view.dispatch(end.view.state.tr.setSelection(TextSelection.create(end.view.state.doc, cellPos(end.view, 1, 0) + 2)))
    expect(pressKey(end.crepe, 'ArrowDown')).toBe(true)
    expect(end.view.state.selection.$from.parent.textContent).toBe('after')
  })
})

describe('Tab, Shift+Tab and ← / → never put the caret in a folded row (YAZ-4173 12A)', () => {
  /** The column A text of the caret's row, and whether that row is folded. */
  const caretRow = (view: EditorView): [string, boolean] => {
    const { $head } = view.state.selection
    for (let d = $head.depth; d > 0; d--) {
      const node = $head.node(d)
      if (node.type.spec.tableRole !== 'row') continue
      let fold = false
      node.forEach((cell) => {
        fold ||= cell.attrs.fold === true
      })
      return [node.firstChild!.textContent, fold]
    }
    return ['', false]
  }

  it.each<[string, string, number, number, number, boolean, string]>([
    ['Tab', 'Tab', 1, 1, 2, false, 'r4'],
    ['Shift+Tab', 'Tab', 4, 0, 0, true, 'r1'],
    ['→ at the end of a cell', 'ArrowRight', 1, 1, 2, false, 'r4'],
    ['← at the start of a cell', 'ArrowLeft', 4, 0, 0, false, 'r1'],
  ])('%s next to a run steps over it', async (_, key, row, col, offset, shift, want) => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-4'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, row, col) + 2 + offset)))
    pressKey(crepe, key, { shift })
    expect(caretRow(view)).toEqual([want, false])
  })

  it('a Tab and typed text never change a folded row', async () => {
    const markdown = rows(5, 'fold 3-4')
    const { crepe, view } = await mountNote(markdown)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 1) + 4)))
    pressKey(crepe, 'Tab')
    view.dispatch(view.state.tr.insertText('typed'))
    // The folded rows keep their text: r2 | n2 and r3 | n3.
    expect(getMarkdownForSave(crepe)).toMatch(/\| r2 +\| n2 +\|\n\| r3 +\| n3 +\|/)
  })
})

describe('a clear never empties a folded row (YAZ-4173 12D)', () => {
  it.each(['Backspace', 'Delete', 'table-clear'])('%s on a CellSelection across a run keeps the folded rows\' text', async (how) => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-4'))
    selectCells(view, [1, 0], [4, 1])
    if (how.startsWith('table-')) menuItem(view, 1, 0, how)!.onSelect()
    else pressKey(crepe, how)
    // The rows that show, r1 and r4, are empty; the folded rows r2 and r3 keep their text.
    expect(getMarkdownForSave(crepe)).toMatch(/\| +\| +\|\n\| r2 +\| n2 +\|\n\| r3 +\| n3 +\|\n\| +\| +\|/)
  })

  it('Shift+↓ twice from the row above a run, then Backspace: the folded row keeps its text', async () => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-4'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
    pressKey(crepe, 'ArrowDown', { shift: true })
    pressKey(crepe, 'ArrowDown', { shift: true })
    pressKey(crepe, 'Backspace')
    expect(getMarkdownForSave(crepe)).toMatch(/\| r2 +\| n2 +\|\n\| r3 +\| n3 +\|/)
  })

  it('typed text over a CellSelection across a run keeps the folded rows\' text, and one undo gives all back', async () => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-4'))
    const before = getMarkdownForSave(crepe)
    selectCells(view, [1, 0], [4, 1])
    view.dispatch(view.state.tr.insertText('x'))
    expect(getMarkdownForSave(crepe)).toMatch(/\| r2 +\| n2 +\|\n\| r3 +\| n3 +\|/)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })
})

describe('Shift+↑ / Shift+↓ step over a folded run, as ↑ / ↓ do (YAZ-4173 12E)', () => {
  /** The column A text of the CellSelection's head row, and whether that row is folded. */
  const headRow = (view: EditorView): [string, boolean] => {
    const row = (view.state.selection as CellSelection).$headCell.parent
    let fold = false
    row.forEach((cell) => {
      fold ||= cell.attrs.fold === true
    })
    return [row.firstChild!.textContent, fold]
  }

  it.each<[string, number, string]>([
    ['ArrowDown', 1, 'r4'],
    ['ArrowUp', 4, 'r1'],
  ])('Shift+%s from row %i: the selection goes past the run', async (key, row, want) => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-4'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, row, 0) + 2)))
    pressKey(crepe, key, { shift: true }) // the first Shift+arrow selects the cell (B3)
    pressKey(crepe, key, { shift: true })
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    expect(headRow(view)).toEqual([want, false])
  })
})

describe('→ above a run at the table end leaves the table, as ↓ does (YAZ-4173 12F)', () => {
  it('→ at the end of the last cell that shows goes to the paragraph below the table', async () => {
    const { crepe, view } = await mountNote(`${rows(4, 'fold 4-5')}\nafter\n`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 2, 1) + 4)))
    pressKey(crepe, 'ArrowRight')
    expect(view.state.selection.$from.parent.textContent).toBe('after')
  })

  it('Tab over a run selects the text of the cell it goes to, as Tab does elsewhere', async () => {
    const { crepe, view } = await mountNote(rows(5, 'fold 3-4'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 1) + 4)))
    pressKey(crepe, 'Tab')
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('r4')
  })
})

describe('↑ / ↓ with no folded row next to the caret\'s row', () => {
  it('ask the fold for no layout: it checks the rows in the document first (YAZ-4176)', async () => {
    const counts: number[] = []
    for (const fold of [false, true]) {
      const { crepe, view } = await mountNote(rows(6, 'fold 5-6'))
      // The baseline: the same note with no fold plugin (`tableEditing` and the keymaps read on their own).
      if (!fold) view.updateState(view.state.reconfigure({ plugins: view.state.plugins.filter((p) => (p as unknown as { key: string }).key !== 'mdapp-table-fold$') }))
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
      const real = view.endOfTextblock.bind(view)
      let reads = 0
      view.endOfTextblock = (dir, state) => {
        reads++
        return real(dir, state)
      }
      pressKey(crepe, 'ArrowDown')
      counts.push(reads)
    }
    // With a run far from the caret, the fold plugin adds no read.
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts[1]).toBe(counts[0])
  })
})

describe('fill down and paste skip folded rows (the rule: a folded row is never written)', () => {
  const FILL = '| A |\n| --- |\n| 1 |\n| 2 |\n| x |\n| y |\n| z |\n|  |\n|  |\n\n<!-- table: fold 4-6 -->\n'

  it('fill down across a run: the series goes on in the visible rows, the folded rows keep their text', async () => {
    const { view } = await mountNote(FILL)
    selectCells(view, [1, 0], [2, 0])
    const { pos } = firstTable(view)
    const tr = fillCells(view.state, { tableStart: pos + 1, top: 1, left: 0, bottom: 3, right: 1 }, 'down', 5)!
    view.dispatch(tr)
    expect(names(view)).toEqual(['A', '1', '2', 'x', 'y', 'z', '3', '4'])
    expect(folded(view)).toEqual(['x', 'y', 'z'])
  })

  it('a paste across a run: the rows go to the visible rows, the folded rows keep their text', async () => {
    const { view } = await mountNote(FILL)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 2, 0) + 2)))
    const text = 'p\tq\nr\ts\nt\tu\n'
    view.pasteText(text, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : '') }, preventDefault() {} } as unknown as ClipboardEvent)
    expect(names(view)).toEqual(['A', '1', 'p', 'x', 'y', 'z', 'r', 't'])
    expect(folded(view)).toEqual(['x', 'y', 'z'])
  })
})
