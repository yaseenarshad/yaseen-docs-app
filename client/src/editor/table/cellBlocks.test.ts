/**
 * What a cell and a cell note hold (YAZ-3818 D1, 5A-1, 5A-2; `cellBlocks.ts`, `cellNotes.ts`): real editors
 * (`createCrepe`). Pinned here: a heading, a quote, code, a rule or a table that a key, a command or a paste puts in a
 * cell's bullet or a cell note's bullet becomes lines, and its words stay; typed Markdown (`# `, `> `, `---`) stays as
 * text; the outer table keeps its rows over a save and a reload; a block put on a cell note's line, Enter on its empty
 * line, Backspace at its start and a paste keep one note for one label.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { Slice, Fragment } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { mount, pressKey, unmountAll } from '../marks/markTestKit'
import { cellPos } from './tableTestKit'

afterEach(unmountAll)

const CELL = '| a   | b |\n| --- | - |\n| <ul><li>one</li></ul> | c |\n\nEnd\n'
const NOTE = '| a          |\n| ---------- |\n| b[^cell-1] |\n\n[^cell-1]: one two\n\n    * bullet\n\nEnd\n'

/** Types at the caret the way the browser does: one `handleTextInput` per character, else plain insertion. */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

/** The position of `text` in the doc, plus `offset`. */
function posOf(view: EditorView, text: string, offset = 0): number {
  let pos = -1
  view.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = at + node.text!.indexOf(text) + offset
    return pos < 0
  })
  return pos
}

const caretAt = (view: EditorView, text: string, offset = 0) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(view, text, offset))))

/** The type names of `node`'s descendants, without text. */
function blockNames(node: ProseNode): string[] {
  const names: string[] = []
  node.descendants((child) => {
    if (!child.isInline) names.push(child.type.name)
    return true
  })
  return names
}

/** The top-level blocks: a cell note as `note:<label>`, a table as `table`, a line as its text. */
const blocks = (view: EditorView): string[] => {
  const out: string[] = []
  view.state.doc.forEach((node) => out.push(node.type.name === 'cell_note' ? `note:${node.attrs.label}` : node.type.name === 'table' ? 'table' : node.textContent))
  if (out.at(-1) === '') out.pop()
  return out
}

/** Save, load the save, save again: the same bytes, and the table keeps its two rows and two columns. */
async function reloads(markdown: string): Promise<EditorView> {
  const { crepe, view } = await mount(markdown)
  expect(getMarkdownForSave(crepe)).toBe(markdown)
  return view
}

const firstCell = (view: EditorView): ProseNode => view.state.doc.nodeAt(cellPos(view, 1, 0))!

describe('a cell bullet holds lines and lists (5A-1)', () => {
  it.each([
    ['# ', 'heading'],
    ['> ', 'blockquote'],
    ['---', 'hr'],
    ['```js ', 'code_block'],
    ['|2x2| ', 'table'],
  ])('`%s` typed in a cell bullet stays text: no %s, and a save keeps the characters', async (typed, block) => {
    const { crepe, view } = await mount(CELL)
    caretAt(view, 'one')
    type(view, typed)
    expect(blockNames(firstCell(view))).not.toContain(block)
    expect(blockNames(firstCell(view))).toEqual(['bullet_list', 'list_item', 'paragraph'])
    expect(firstCell(view).textContent).toBe(`${typed}one`)
    const saved = getMarkdownForSave(crepe)
    const again = await reloads(saved)
    expect(firstCell(again).textContent).toBe(`${typed}one`)
  })

  it('a heading or a code block set on a cell bullet\'s line by a command becomes a line again; its words stay', async () => {
    const { crepe, view } = await mount(CELL)
    const at = posOf(view, 'one')
    view.dispatch(view.state.tr.setBlockType(at, at, view.state.schema.nodes.heading, { level: 2 }))
    expect(blockNames(firstCell(view))).toEqual(['bullet_list', 'list_item', 'paragraph'])
    view.dispatch(view.state.tr.setBlockType(at, at, view.state.schema.nodes.code_block, {}))
    expect(blockNames(firstCell(view))).toEqual(['bullet_list', 'list_item', 'paragraph'])
    expect(getMarkdownForSave(crepe)).toBe(CELL.replace('| a   | b |\n| --- | - |\n| <ul><li>one</li></ul> | c |', '| a                     | b |\n| --------------------- | - |\n| <ul><li>one</li></ul> | c |'))
  })

  it('a table put below a cell bullet\'s line (the slash row\'s place, a paste) becomes its text as lines; the outer table keeps its rows', async () => {
    const { crepe, view } = await mount(CELL)
    const src = await mount('| x | y |\n| - | - |\n| 1 | 2 |\n')
    const inner = view.state.schema.nodeFromJSON(src.view.state.doc.firstChild!.toJSON())
    const $line = view.state.doc.resolve(posOf(view, 'one'))
    view.dispatch(view.state.tr.insert($line.after(), inner))
    expect(blockNames(firstCell(view))).toEqual(['bullet_list', 'list_item', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph'])
    expect(firstCell(view).textContent).toBe('onexy12')
    const again = await reloads(getMarkdownForSave(crepe))
    const outer = again.state.doc.firstChild!
    expect([outer.type.name, outer.childCount, outer.firstChild!.childCount]).toEqual(['table', 2, 2])
    expect(again.state.doc.nodeAt(cellPos(again, 1, 1))!.textContent).toBe('c')
  })

  it('a quote and a rule pasted into a cell bullet become lines; the words stay', async () => {
    const { view } = await mount(CELL)
    const { schema } = view.state
    const quote = schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create(null, schema.text('quoted')), schema.nodes.paragraph.create(null, schema.text('more'))])
    const at = posOf(view, 'one', 3)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).replaceSelection(new Slice(Fragment.from([schema.nodes.paragraph.create(), quote, schema.nodes.horizontal_rule?.create() ?? schema.nodes.hr.create()]), 1, 0)))
    expect(blockNames(firstCell(view)).filter((name) => !['bullet_list', 'list_item', 'paragraph'].includes(name))).toEqual([])
    expect(firstCell(view).textContent).toBe('onequotedmore')
  })

  it('a heading in a cell note\'s bullet becomes a line again', async () => {
    const { view } = await mount(NOTE)
    const at = posOf(view, 'bullet')
    view.dispatch(view.state.tr.setBlockType(at, at, view.state.schema.nodes.heading, { level: 1 }))
    const note = view.state.doc.child(1)
    expect(note.type.name).toBe('cell_note')
    expect(blockNames(note)).toEqual(['paragraph', 'bullet_list', 'list_item', 'paragraph'])
    caretAt(view, 'bullet', 0)
    type(view, '# ')
    expect(blockNames(view.state.doc.child(1))).toEqual(['paragraph', 'bullet_list', 'list_item', 'paragraph'])
    expect(view.state.doc.child(1).textContent).toBe('one two# bullet')
  })

  it('a heading in a bullet outside tables is still a heading', async () => {
    const { view } = await mount('* one\n')
    caretAt(view, 'one')
    type(view, '# ')
    expect(blockNames(view.state.doc)).toContain('heading')
  })
})

describe('a cell note keeps one note for one label (5A-2)', () => {
  it('a table put on a cell note\'s line goes nowhere: one `cell-1` note, and the file has one', async () => {
    const { crepe, view } = await mount(NOTE)
    const table = view.state.schema.nodeFromJSON((await mount('| x |\n| - |\n| 1 |\n')).view.state.doc.firstChild!.toJSON())
    caretAt(view, 'one', 3)
    view.dispatch(view.state.tr.replaceSelectionWith(table))
    expect(blocks(view).filter((block) => block.startsWith('note:'))).toEqual(['note:cell-1'])
    expect(getMarkdownForSave(crepe).match(/\[\^cell-1\]:/g)).toHaveLength(1)
  })

  it('`---` and `# ` typed on a cell note\'s line stay text, in one note', async () => {
    const { crepe, view } = await mount(NOTE)
    caretAt(view, 'one', 0)
    type(view, '---')
    expect(blocks(view)).toEqual(['table', 'note:cell-1', 'End'])
    expect(view.state.doc.child(1).firstChild!.textContent).toBe('---one two')
    type(view, ' # ')
    expect(blocks(view)).toEqual(['table', 'note:cell-1', 'End'])
    expect(getMarkdownForSave(crepe).match(/\[\^cell-1\]:/g)).toHaveLength(1)
  })

  it('a table and its note pasted under a note with the same label stay as pasted: no split, no join', async () => {
    const { view } = await mount(NOTE)
    const src = await mount(NOTE)
    const pasted = view.state.schema.nodeFromJSON(src.view.state.doc.toJSON()).content.cut(0, src.view.state.doc.child(0).nodeSize + src.view.state.doc.child(1).nodeSize)
    view.dispatch(view.state.tr.insert(view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize, pasted))
    // Two tables and two notes (where D12 puts two notes with one label is YAZ-4206's): no words joined.
    expect(blocks(view).sort()).toEqual(['End', 'note:cell-1', 'note:cell-1', 'table', 'table'])
    expect(view.state.doc.nodeAt(cellPos(view, 0, 0))!.textContent).toBe('a')
  })

  it('Enter on an empty line in the middle of a cell note makes a line in the same note', async () => {
    const { crepe, view } = await mount('| a          |\n| ---------- |\n| b[^cell-1] |\n\n[^cell-1]: one\n\n    <br />\n\n    two\n\nEnd\n')
    const empty = view.state.doc.child(1).child(1)
    expect(empty.content.size).toBe(0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + 1 + view.state.doc.child(1).child(0).nodeSize + 1)))
    pressKey(crepe, 'Enter')
    expect(blocks(view).filter((block) => block.startsWith('note:'))).toEqual(['note:cell-1'])
    expect(view.state.doc.child(1).childCount).toBe(4)
  })

  it('Backspace at the start of a cell note joins nothing out of it', async () => {
    const { crepe, view } = await mount(NOTE)
    caretAt(view, 'one', 0)
    pressKey(crepe, 'Backspace')
    expect(blocks(view)).toEqual(['table', 'note:cell-1', 'End'])
    expect(view.state.doc.child(1).firstChild!.textContent).toBe('one two')
  })

  it('a paste of two lines in a cell note\'s line stays in the note', async () => {
    const { crepe, view } = await mount(NOTE)
    const { schema } = view.state
    caretAt(view, 'one', 3)
    const lines = Fragment.from([schema.nodes.paragraph.create(null, schema.text('A')), schema.nodes.paragraph.create(null, schema.text('B'))])
    view.dispatch(view.state.tr.replaceSelection(new Slice(lines, 1, 1)))
    expect(blocks(view)).toEqual(['table', 'note:cell-1', 'End'])
    expect(getMarkdownForSave(crepe)).toContain('[^cell-1]: oneA\n\n    B two\n')
  })
})
