/**
 * Lists in a table cell (YAZ-3818 D1, D2, D7; `cellLists.ts`): real editors (`createCrepe`) load a
 * note, save it, and load the save again. Pinned here: each D2 form keeps its bytes over two saves
 * and loads as real list nodes; HTML that is not the exact form stays as typed; a header cell stays
 * one line; typing `- `, `1. ` and `[ ] ` in a body cell makes a list; a new cell is one empty line.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { addRowAfter } from '@milkdown/kit/prose/tables'
import { getMarkdownForSave } from '../createCrepe'
import { CELL_CONTENT } from '../inlineBreaks'
import { mount, unmountAll } from '../marks/markTestKit'
import { cellPos } from './tableTestKit'

afterEach(unmountAll)

/** A table whose one body cell is `cell` (and whose header cell is `header`), padded as the writer pads it. */
function table(cell: string, header = 'h'): string {
  const width = Math.max(cell.length, header.length, 3)
  return `| ${header.padEnd(width)} |\n| ${'-'.repeat(width)} |\n| ${cell.padEnd(width)} |\n`
}

/**
 * The first body cell of the first table in `markdown`, without the padding the table writer adds
 * (a `[[link]]` pads 2 more: the writer measures it as `\\[\\[link]]`).
 */
const bodyCell = (markdown: string): string => markdown.split('\n').filter((line) => line.trimStart().startsWith('|'))[2].trim().slice(1, -1).split(' |')[0].trim()

/** Load, save; then load the save and save again — the second save must give the same bytes. */
async function save(markdown: string): Promise<string> {
  const { crepe } = await mount(markdown)
  const out = getMarkdownForSave(crepe)
  const again = await mount(out)
  expect(getMarkdownForSave(again.crepe)).toBe(out)
  return out
}

/** The cell at (row, col) of the first table. */
const cellAt = (view: EditorView, row: number, col: number): ProseNode => view.state.doc.nodeAt(cellPos(view, row, col))!

/** The cell as a tree of type names; an item shows its `checked`, a line its text. */
function shape(node: ProseNode): unknown {
  if (node.type.name === 'paragraph') return node.textContent
  const children: unknown[] = []
  node.forEach((child) => children.push(shape(child)))
  if (node.type.name === 'list_item' && node.attrs.checked !== null) return { checked: node.attrs.checked, children }
  return { [node.type.name]: children }
}

/** Types at the caret the way the browser does: one `handleTextInput` per character, else plain insertion. */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

/** The caret in the first line of the cell at (row, col). */
function caretInCell(view: EditorView, row: number, col: number) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, row, col) + 2)))
}

describe('the D2 form keeps its bytes over two saves', () => {
  it.each([
    ['nested bullets and a link', '<ul><li>Flights [[Paris]]</li><li>Hotel<ul><li>Room 204</li></ul></li></ul>'],
    ['a numbered list with a start', '<ol start="3"><li>One</li><li>Two</li></ol>'],
    ['a numbered list from 1', '<ol><li>One</li><li>Two<ol><li>Two A</li></ol></li></ol>'],
    ['to-dos', '<ul><li>[ ] Book taxi</li><li>[x] Pack</li></ul>'],
    ['a to-do with bold and a link first', 'Notes<ul><li>[ ] **Book** [[Paris]]</li><li>Hotel<ul><li>Room 204</li></ul></li></ul>After'],
    ['text before and after a list', 'Notes first<ul><li>A</li></ul>After'],
    ['bold, a link and code in items', '<ul><li>**bold** and a [link](x.md)</li><li>`code` *it*</li></ul>'],
    ['a line break in an item', '<ul><li>One<br>two</li><li>Three</li></ul>'],
    ['an item that starts with its child list', '<ul><li><ul><li>Child</li></ul></li></ul>'],
    ['an empty to-do and an empty item', '<ul><li>[ ] </li><li></li></ul>'],
  ])('%s', async (_, cell) => {
    expect(bodyCell(await save(table(cell)))).toBe(cell)
  })

  it('a list in a table in a bullet', async () => {
    const note = '* item\n  | h                   |\n  | ------------------- |\n  | <ul><li>A</li></ul> |\n* next\n'
    expect(await save(note)).toBe(note)
  })

  it('a plain table and a table with <br> keep their bytes', async () => {
    const plain = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n'
    expect(await save(plain)).toBe(plain)
    expect(await save(table('one<br>two'))).toBe(table('one<br>two'))
  })
})

describe('the D2 form loads as list nodes', () => {
  it('nested bullets', async () => {
    const { view } = await mount(table('<ul><li>Flights</li><li>Hotel<ul><li>Room 204</li></ul></li></ul>'))
    expect(shape(cellAt(view, 1, 0))).toEqual({
      table_cell: [{ bullet_list: [{ list_item: ['Flights'] }, { list_item: ['Hotel', { bullet_list: [{ list_item: ['Room 204'] }] }] }] }],
    })
  })

  it('a numbered list keeps its start and its numbers', async () => {
    const { view } = await mount(table('<ol start="3"><li>One</li><li>Two</li></ol>'))
    const list = cellAt(view, 1, 0).firstChild!
    expect(list.type.name).toBe('ordered_list')
    expect(list.attrs.order).toBe(3)
    expect([list.child(0).attrs.label, list.child(1).attrs.label]).toEqual(['3.', '4.'])
  })

  it('to-dos set checked and lose their marker from the text', async () => {
    const { view } = await mount(table('<ul><li>[ ] Book taxi</li><li>[x] Pack</li><li>Plain</li></ul>'))
    expect(shape(cellAt(view, 1, 0))).toEqual({
      table_cell: [{ bullet_list: [{ checked: false, children: ['Book taxi'] }, { checked: true, children: ['Pack'] }, { list_item: ['Plain'] }] }],
    })
  })

  it('text before and after a list are lines of the cell', async () => {
    const { view } = await mount(table('Notes first<ul><li>A</li></ul>After'))
    expect(shape(cellAt(view, 1, 0))).toEqual({ table_cell: ['Notes first', { bullet_list: [{ list_item: ['A'] }] }, 'After'] })
  })

  it('a line break in an item stays in one line', async () => {
    const { view } = await mount(table('<ul><li>One<br>two</li></ul>'))
    const line = cellAt(view, 1, 0).firstChild!.firstChild!.firstChild!
    expect(line.type.name).toBe('paragraph')
    expect(line.childCount).toBe(3)
    expect(line.child(1).type.name).toBe('hardbreak')
  })
})

describe('HTML that is not the exact form stays as typed', () => {
  it.each([
    ['unbalanced', '<ul><li>A</ul>'],
    ['upper case', '<UL><LI>A</LI></UL>'],
    ['an attribute', '<ul class="x"><li>A</li></ul>'],
    ['other HTML', '<span>x</span>'],
    ['other HTML in an item', '<ul><li><span>x</span></li></ul>'],
    ['text between items', '<ul><li>A</li> <li>B</li></ul>'],
    ['an empty list', '<ul></ul>'],
  ])('%s', async (_, cell) => {
    const { view } = await mount(table(cell))
    const lists: string[] = []
    cellAt(view, 1, 0).descendants((node) => {
      if (node.type.name.endsWith('_list')) lists.push(node.type.name)
    })
    expect(lists).toEqual([])
    expect(await save(table(cell))).toBe(table(cell))
  })

  it('an unbalanced list after a to-do keeps the to-do text (a `[` in a cell\'s text saves as `\\[`, as on f1da9aaf7)', async () => {
    const cell = '<ul><li>[ ] A</li><li>B</ul>'
    const { view } = await mount(table(cell))
    expect(cellAt(view, 1, 0).textContent).toBe('[ ] AB')
    expect(await save(table(cell))).toBe(table('<ul><li>\\[ ] A</li><li>B</ul>'))
  })

  it('a plain cell bullet whose words start with `[ ] ` stays a plain bullet over two saves (5A-12)', async () => {
    const { crepe, view } = await mount(table('<ul><li>x</li></ul>'))
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === 'x') at = pos
      return at < 0
    })
    view.dispatch(view.state.tr.insertText('[ ] foo', at, at + 1))
    const out = getMarkdownForSave(crepe)
    expect(out).toBe(table('<ul><li>\\[ ] foo</li></ul>'))
    const again = await mount(out)
    expect(shape(cellAt(again.view, 1, 0))).toEqual({ table_cell: [{ bullet_list: [{ list_item: ['[ ] foo'] }] }] })
    expect(getMarkdownForSave(again.crepe)).toBe(out)
  })

  it('`[X] ` is a done to-do, written back `[x] `', async () => {
    const { view } = await mount(table('<ul><li>[X] A</li></ul>'))
    expect(shape(cellAt(view, 1, 0))).toEqual({ table_cell: [{ bullet_list: [{ checked: true, children: ['A'] }] }] })
    expect(await save(table('<ul><li>[X] A</li></ul>'))).toBe(table('<ul><li>[x] A</li></ul>'))
  })
})

describe('a header cell stays one line (D7)', () => {
  it('a list in a header cell is text and keeps its bytes', async () => {
    const note = table('b', '<ul><li>A</li></ul>')
    const { view } = await mount(note)
    expect(shape(cellAt(view, 0, 0))).toEqual({ table_header: ['A'] })
    expect(await save(note)).toBe(note)
  })
})

describe('typing in a cell', () => {
  it('`- ` makes a bullet list, then `[ ] ` makes a to-do', async () => {
    const { crepe, view } = await mount(table(''))
    caretInCell(view, 1, 0)
    type(view, '- ')
    expect(shape(cellAt(view, 1, 0))).toEqual({ table_cell: [{ bullet_list: [{ list_item: [''] }] }] })
    type(view, '[ ] ')
    type(view, 'Book')
    expect(shape(cellAt(view, 1, 0))).toEqual({ table_cell: [{ bullet_list: [{ checked: false, children: ['Book'] }] }] })
    expect(getMarkdownForSave(crepe)).toBe(table('<ul><li>[ ] Book</li></ul>'))
  })

  it('`1. ` makes a numbered list', async () => {
    const { crepe, view } = await mount(table(''))
    caretInCell(view, 1, 0)
    type(view, '1. One')
    expect(shape(cellAt(view, 1, 0))).toEqual({ table_cell: [{ ordered_list: [{ list_item: ['One'] }] }] })
    expect(getMarkdownForSave(crepe)).toBe(table('<ol><li>One</li></ol>'))
  })

  it('`- ` in a header cell stays text', async () => {
    const { view } = await mount(table('b', ''))
    caretInCell(view, 0, 0)
    type(view, '- A')
    expect(shape(cellAt(view, 0, 0))).toEqual({ table_header: ['- A'] })
  })
})

describe('a new cell', () => {
  it('a body cell holds lines and lists; a new row has one empty line in each cell', async () => {
    const { view } = await mount('| a | b |\n| - | - |\n| 1 | 2 |\n')
    expect(view.state.schema.nodes.table_cell.spec.content).toBe(CELL_CONTENT)
    expect(view.state.schema.nodes.table_cell.createAndFill()!.toJSON()).toEqual({ type: 'table_cell', attrs: expect.any(Object), content: [{ type: 'paragraph' }] })
    caretInCell(view, 1, 0)
    addRowAfter(view.state, view.dispatch)
    expect([shape(cellAt(view, 2, 0)), shape(cellAt(view, 2, 1))]).toEqual([{ table_cell: [''] }, { table_cell: [''] }])
  })
})
