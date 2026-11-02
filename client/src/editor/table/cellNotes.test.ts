/**
 * Cell notes (YAZ-3818 D4, D12; `cellNotes.ts`): real editors (`createCrepe`) load a note, change it and save it.
 * Pinned here: a file with cell notes keeps its bytes over two saves, and other footnotes stay Milkdown's; adding and
 * removing a cell note; the notes go back under their table after a drag and a cut and paste; a cell note with no mark
 * shows; typing never runs the placement; the note is hidden by its class.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import tableCss from './table.css?inline'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { addCellNote, CELL_NOTE_CELL_CLASS, cellNoteCrumbParts, cellNoteLabelsIn, cellNoteOf, cellNotePlacements, isCellNoteHidden, nextCellNoteLabel, notePosOf, removeCellNote } from './cellNotes'
import { cellPos } from './tableTestKit'

afterEach(unmountAll)

/** A table with a mark after text and one inside a cell's HTML list, its two notes with bullets, and a hand-written footnote. */
const NOTES = [
  '* note bullet',
  '',
  '| Day     | Plan                              |',
  '| ------- | --------------------------------- |',
  '| Monday  | Flights[^cell-1]                  |',
  '| Tuesday | <ul><li>Museum[^cell-2]</li></ul> |',
  '',
  '[^cell-1]: First line.',
  '',
  '    * bullet a',
  '      * child b',
  '',
  '[^cell-2]: Second.',
  '',
  'Text with a ref[^1].',
  '',
  '[^1]: A hand note.',
  '',
].join('\n')

/**
 * The top-level blocks: a cell note as `note:<label>`, a footnote as `footnote:<label>`, a table as `table`, a line as
 * its text. Not the empty line Crepe keeps at the end after a change.
 */
const blocks = (view: EditorView): string[] => {
  const out: string[] = []
  view.state.doc.forEach((node) => {
    const name = node.type.name
    out.push(name === 'cell_note' ? `note:${node.attrs.label}` : name === 'footnote_definition' ? `footnote:${node.attrs.label}` : name === 'table' ? 'table' : node.textContent)
  })
  if (out.at(-1) === '') out.pop()
  return out
}

const tableOf = (view: EditorView): { pos: number; node: ProseNode } => {
  let found: { pos: number; node: ProseNode } | null = null
  view.state.doc.forEach((node, pos) => {
    if (found === null && node.type.name === 'table') found = { pos, node }
  })
  return found!
}

/** The position before the top-level block whose text is `text`. */
const blockPos = (view: EditorView, text: string): number => {
  let found = -1
  view.state.doc.forEach((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === text) found = pos
  })
  return found
}

const orphanLabels = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('.cell-note.cell-note--orphan')].map((el) => el.dataset.label!)

describe('the file form (D4)', () => {
  it('a file with cell notes saves the same bytes over two saves; `[^1]` stays a footnote; bullets save as the note saves them', async () => {
    const { crepe, view } = await mount(NOTES)
    expect(blocks(view)).toEqual(['note bullet', 'table', 'note:cell-1', 'note:cell-2', 'Text with a ref.', 'footnote:1'])
    expect(view.state.doc.child(2).toString()).toBe('cell_note(paragraph("First line."), bullet_list(list_item(paragraph("bullet a"), bullet_list(list_item(paragraph("child b"))))))')
    const out = getMarkdownForSave(crepe)
    expect(out).toBe(NOTES)
    const again = await mount(out)
    expect(getMarkdownForSave(again.crepe)).toBe(out)
  })

  it('an empty line in a footnote or a cell note loads back as an empty line, so the note is kept', async () => {
    const md = '| a          |\n| ---------- |\n| b[^cell-1] |\n\n[^cell-1]: <br />\n\n    * bullet\n\nText[^1].\n\n[^1]: <br />\n'
    const { crepe, view } = await mount(md)
    expect(blocks(view)).toEqual(['table', 'note:cell-1', 'Text.', 'footnote:1'])
    expect(view.state.doc.child(1).toString()).toBe('cell_note(paragraph, bullet_list(list_item(paragraph("bullet"))))')
    expect(getMarkdownForSave(crepe)).toBe(md)
    // A hand-written `[^1]:` saves its empty line as `<br />`, and keeps its footnote on the next load.
    const empty = await mount('Text[^1].\n\n[^1]:\n')
    expect(getMarkdownForSave(empty.crepe)).toBe('Text[^1].\n\n[^1]: <br />\n')
  })

  it('a `cell-N` footnote that holds code is no cell note: it stays a footnote and shows', async () => {
    const md = 'A[^cell-1]\n\n[^cell-1]: x\n\n    ```\n    code\n    ```\n'
    const { crepe, view } = await mount(md)
    expect(blocks(view)).toEqual(['A', 'footnote:cell-1'])
    expect(getMarkdownForSave(crepe)).toBe(md)
  })

  it('the cell note has the class that hides it, and table.css hides that class; one with no mark shows', async () => {
    const { root } = await mount('| a |\n| --- |\n| b[^cell-1] |\n\n[^cell-1]: hidden\n\nText.\n\n[^cell-2]: shown\n')
    const notes = [...root.querySelectorAll<HTMLElement>('section.cell-note')]
    expect(notes.map((el) => el.dataset.label)).toEqual(['cell-1', 'cell-2'])
    expect(orphanLabels(root)).toEqual(['cell-2'])
    expect(tableCss).toMatch(/\.milkdown \.ProseMirror \.cell-note \{\s*display: none;/)
    expect(tableCss).toMatch(/\.milkdown \.ProseMirror \.cell-note\.cell-note--orphan \{\s*display: block;/)
  })
})

describe('the helpers', () => {
  it('cellNoteLabelsIn, cellNoteOf and cellNoteCrumbParts read the marks', async () => {
    const { view } = await mount(NOTES)
    const { doc } = view.state
    expect(cellNoteLabelsIn(tableOf(view).node)).toEqual(['cell-1', 'cell-2'])
    expect(cellNoteOf(doc, cellPos(view, 1, 1))).toBe('cell-1')
    expect(cellNoteOf(doc, cellPos(view, 2, 1))).toBe('cell-2')
    expect(cellNoteOf(doc, cellPos(view, 1, 0))).toBeNull()
    expect(cellNoteCrumbParts(doc, 'cell-2')).toEqual({ column: 'Plan', row: 'Tuesday' })
    expect(cellNoteCrumbParts(doc, 'cell-9')).toEqual({ column: '', row: '' })
  })

  it('cellNoteCrumbParts reads a cell\'s bullets with spaces, and gives no row for a header cell (5A-16)', async () => {
    const { view } = await mount('| Day | Plan[^cell-3] |\n| --- | --- |\n| <ul><li>Museum</li><li>Park</li></ul> | x[^cell-4] |\n\n[^cell-3]: a\n\n[^cell-4]: b\n')
    expect(cellNoteCrumbParts(view.state.doc, 'cell-4')).toEqual({ column: 'Plan', row: 'Museum Park' })
    expect(cellNoteCrumbParts(view.state.doc, 'cell-3')).toEqual({ column: 'Plan', row: '' })
  })

  it('nextCellNoteLabel is the smallest free `cell-N`', async () => {
    const { view } = await mount('| a |\n| --- |\n| b[^cell-1] |\n\n[^cell-1]: x\n\nY[^cell-3].\n')
    expect(nextCellNoteLabel(view.state.doc)).toBe('cell-2')
  })

  it('addCellNote on a plain cell and on a cell that starts with a list: the mark ends the first line, the notes follow the marks', async () => {
    const { crepe, view } = await mount('| Day | Plan |\n| --- | --- |\n| Monday | Flights |\n| Tuesday | <ul><li>Museum</li><li>Park</li></ul> |\n\nAfter.\n')
    expect(addCellNote(cellPos(view, 2, 1))(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.nodeAt(notePosOf(view.state.doc, 'cell-1')!)?.type.name).toBe('cell_note')
    expect(addCellNote(cellPos(view, 1, 1))(view.state, view.dispatch)).toBe(true)
    // A cell holds one cell note.
    expect(addCellNote(cellPos(view, 1, 1))(view.state, view.dispatch)).toBe(false)
    // Row 1's mark comes first, so its note (cell-2) goes first.
    expect(blocks(view)).toEqual(['table', 'note:cell-2', 'note:cell-1', 'After.'])
    // An empty note stays out of the file (D15): a word in each.
    for (const label of ['cell-1', 'cell-2']) view.dispatch(view.state.tr.insertText(label === 'cell-1' ? 'one' : 'two', notePosOf(view.state.doc, label)! + 2))
    const out = getMarkdownForSave(crepe)
    expect(out).toContain('| Monday  | Flights[^cell-2]')
    expect(out).toContain('| <ul><li>Museum[^cell-1]</li><li>Park</li></ul> |')
    expect(out).toContain('[^cell-2]: two\n\n[^cell-1]: one\n\nAfter.\n')
    const again = await mount(out)
    expect(blocks(again.view)).toEqual(['table', 'note:cell-2', 'note:cell-1', 'After.'])
  })

  it('removeCellNote deletes the mark and its note', async () => {
    const { crepe, view } = await mount(NOTES)
    view.dispatch(removeCellNote(view.state.tr, 'cell-1'))
    expect(blocks(view)).toEqual(['note bullet', 'table', 'note:cell-2', 'Text with a ref.', 'footnote:1'])
    expect(getMarkdownForSave(crepe)).not.toContain('cell-1')
  })
})

describe('a cell note is hidden only while a table cell holds its mark (5A-3)', () => {
  const hidden = (view: EditorView): boolean[] => {
    const out: boolean[] = []
    view.state.doc.forEach((node, pos) => {
      if (node.type.name === 'cell_note') out.push(isCellNoteHidden(view.state, pos))
    })
    return out
  }

  it('a mark in a plain line: its note shows', async () => {
    const { root, view } = await mount('| a |\n| --- |\n| b |\n\nY[^cell-1]\n\n[^cell-1]: secret\n')
    expect(orphanLabels(root)).toEqual(['cell-1'])
    expect(hidden(view)).toEqual([false])
  })

  it('a mark in a cell note: that note shows; the note whose mark is in a cell stays hidden', async () => {
    const { root, view } = await mount('| a |\n| --- |\n| b[^cell-1] |\n\n[^cell-1]: x[^cell-2]\n\n[^cell-2]: y\n')
    expect(orphanLabels(root)).toEqual(['cell-2'])
    expect(hidden(view)).toEqual([true, false])
  })

  it('a mark cut from a cell and pasted in a line: its note shows; back in a cell, it hides again', async () => {
    const { root, view } = await mount('| a |\n| --- |\n| b[^cell-1] |\n\n[^cell-1]: secret\n\nEnd\n')
    const mark = cellPos(view, 1, 0) + 3
    expect(view.state.doc.nodeAt(mark)?.type.name).toBe('footnote_reference')
    const end = blockPos(view, 'End') + 4
    const tr = view.state.tr.insert(end, view.state.doc.nodeAt(mark)!).delete(mark, mark + 1)
    view.dispatch(tr)
    expect(orphanLabels(root)).toEqual(['cell-1'])
    const moved = blockPos(view, 'End') + 4
    view.dispatch(view.state.tr.insert(cellPos(view, 1, 0) + 3, view.state.doc.nodeAt(moved)!).delete(moved + 1, moved + 2))
    expect(orphanLabels(root)).toEqual([])
  })
})

describe('the corner mark is drawn on the cell (5A-18)', () => {
  const marked = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>(`.${CELL_NOTE_CELL_CLASS}`)].map((cell) => cell.textContent!.replace(/cell-\d+/g, '').trim())

  it('a cell with a mark has the class, one that starts with a list too; it goes with the mark and comes with a new note', async () => {
    const { root, view } = await mount(NOTES)
    expect(marked(root)).toEqual(['Flights', 'Museum'])
    view.dispatch(removeCellNote(view.state.tr, 'cell-1'))
    expect(marked(root)).toEqual(['Museum'])
    addCellNote(cellPos(view, 1, 0))(view.state, view.dispatch)
    expect(marked(root)).toEqual(['Monday', 'Museum'])
  })

  it('table.css draws the triangle on the cell, with no offsets for a cell that starts with a list', () => {
    expect(tableCss).toMatch(new RegExp(`:is\\(th, td\\)\\.${CELL_NOTE_CELL_CLASS} \\{[^}]*background-image: linear-gradient`))
    expect(tableCss).not.toMatch(/li\.list-item sup\[data-type='footnote_reference'\]/)
    expect(tableCss).not.toMatch(/sup\[data-type='footnote_reference'\]\[data-label\^='cell-'\]::after/)
  })
})

describe('notes follow their table (D12)', () => {
  const MOVE = '| a |\n| --- |\n| b[^cell-1] |\n| c[^cell-2] |\n\n[^cell-1]: one\n\n[^cell-2]: two\n\nA\n\nB\n\nC\n'

  it('a drag (the table out and two blocks lower, in one transaction): the notes go under it, in mark order', async () => {
    const { view, root } = await mount(MOVE)
    const table = tableOf(view)
    const below = blockPos(view, 'B') + view.state.doc.nodeAt(blockPos(view, 'B'))!.nodeSize
    const tr = view.state.tr.delete(table.pos, table.pos + table.node.nodeSize)
    tr.insert(tr.mapping.map(below), table.node)
    const before = cellNotePlacements.runs
    view.dispatch(tr)
    expect(cellNotePlacements.runs).toBeGreaterThan(before)
    expect(blocks(view)).toEqual(['A', 'B', 'table', 'note:cell-1', 'note:cell-2', 'C'])
    expect(orphanLabels(root)).toEqual([])
  })

  it('a cut and a paste: the notes show while the table is away, then go under it', async () => {
    const { view, root } = await mount(MOVE)
    const table = tableOf(view)
    const { dom, text } = view.serializeForClipboard(view.state.doc.slice(table.pos, table.pos + table.node.nodeSize))
    view.dispatch(view.state.tr.delete(table.pos, table.pos + table.node.nodeSize))
    expect(blocks(view)).toEqual(['note:cell-1', 'note:cell-2', 'A', 'B', 'C'])
    expect(orphanLabels(root)).toEqual(['cell-1', 'cell-2'])
    // Paste at the end of B.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, blockPos(view, 'B') + 2)))
    const html = dom.innerHTML
    view.pasteHTML(html, { clipboardData: { getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : '') }, preventDefault() {} } as unknown as ClipboardEvent)
    expect(blocks(view)).toEqual(['A', 'B', 'table', 'note:cell-1', 'note:cell-2', 'C'])
    expect(orphanLabels(root)).toEqual([])
  })

  it('a deleted mark leaves its note in place, shown; nothing is deleted', async () => {
    const { view, root, crepe } = await mount(MOVE)
    let mark = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote_reference' && node.attrs.label === 'cell-2') mark = pos
      return mark < 0
    })
    view.dispatch(view.state.tr.delete(mark, mark + 1))
    expect(blocks(view)).toEqual(['table', 'note:cell-1', 'note:cell-2', 'A', 'B', 'C'])
    expect(orphanLabels(root)).toEqual(['cell-2'])
    expect(getMarkdownForSave(crepe)).toContain('[^cell-2]: two')
  })

  it('typing 50 characters in a cell with a mark never runs the placement', async () => {
    const { view } = await mount(MOVE)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
    const before = cellNotePlacements.runs
    for (const ch of 'x'.repeat(50)) view.dispatch(view.state.tr.insertText(ch))
    // A key that deletes a character, not the mark.
    view.dispatch(view.state.tr.delete(view.state.selection.from - 1, view.state.selection.from))
    expect(cellNotePlacements.runs).toBe(before)
    expect(view.state.doc.nodeAt(cellPos(view, 1, 0))!.textContent).toBe(`${'x'.repeat(49)}b`)
  })
})
