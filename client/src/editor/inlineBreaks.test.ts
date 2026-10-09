/**
 * Inline `<br>` ↔ hardbreak (YAZ-1452). Real `createCrepe()` round-trips, no mocks.
 *
 * Milkdown's `remarkPreserveEmptyLine` deleted every inline `<br>` on parse, so a `<br>` in a
 * table cell vanished on load and was gone from disk on the next autosave; and remark writes a
 * hardbreak inside a table cell as a space. Cases 1–5, 9 and 10 fail without `inlineBreaks`;
 * 6–8 guard the behaviours that must NOT change.
 */
import { describe, it, expect } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { Crepe } from '@milkdown/crepe'
import { createCrepe, getMarkdownForSave } from './createCrepe'

/** One row of yaseen-docs `fa72c8c:Thinking Clearly - Nick.md`, exactly as the agent wrote it. */
const AGENT_ROW =
  '| The collection of mental processes that lets a person notice information, hold it in mind, reason about it, and act is called {{cognition}}. | **Cognition** is {{the collection of processes involved in thinking and knowing}}. <br><br>The course organizes it into {{attention}}, {{working memory}}, and {{executive function}}. <br><br>**Used in a sentence:** After a sleepless night, Maya’s cognition {{slowed enough that planning and remembering instructions became difficult}}. |'
const AGENT_TABLE = `| Front | Back |\n| --- | --- |\n${AGENT_ROW}`

const table = (cell: string, header = 'h') => `| ${header} |\n| - |\n| ${cell} |`

async function open(markdown: string): Promise<{ crepe: Crepe; close: () => Promise<void> }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  return {
    crepe,
    close: async () => {
      await crepe.destroy()
      root.remove()
    },
  }
}

async function roundTrip(markdown: string): Promise<string> {
  const { crepe, close } = await open(markdown)
  const out = getMarkdownForSave(crepe)
  await close()
  return out
}

/** One open of `markdown`: the text a save writes, and the number of paragraphs on the page. */
async function openAndSave(markdown: string): Promise<{ text: string; paragraphs: number }> {
  const { crepe, close } = await open(markdown)
  let paragraphs = 0
  crepe.editor.ctx.get(editorViewCtx).state.doc.descendants((node) => {
    if (node.type.name === 'paragraph') paragraphs++
  })
  const text = getMarkdownForSave(crepe)
  await close()
  return { text, paragraphs }
}

/** Inline node type names of the first paragraph inside the first node of `type`. */
async function inlineTypes(markdown: string, type: string): Promise<string[]> {
  const { crepe, close } = await open(markdown)
  const doc = crepe.editor.ctx.get(editorViewCtx).state.doc
  let found: PMNode | null = null
  doc.descendants((node) => {
    if (found === null && node.type.name === type) found = node
    return found === null
  })
  const node = found as PMNode | null
  const paragraph = node?.type.name === 'paragraph' ? node : node?.firstChild
  const names: string[] = []
  paragraph?.forEach((child) => names.push(child.type.name))
  await close()
  return names
}

/** The saved markdown row for `cell`, whitespace-normalised (remark pads columns). */
const savedCell = (out: string): string => out.split('\n')[2].replace(/^\|\s*/, '').replace(/\s*\|$/, '')

/** Caret right after the text `text` (first match). */
function caretAfter(view: EditorView, text: string): void {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text === text) pos = p + text.length
    return pos === -1
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** A real Enter keydown through ProseMirror's keymap plugins (jsdom needs keyCode too). */
const pressEnter = (view: EditorView, mods: { shiftKey?: boolean; metaKey?: boolean } = {}): void => {
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, ...mods, bubbles: true, cancelable: true }))
}
const shiftEnter = (view: EditorView): void => pressEnter(view, { shiftKey: true })

describe('inline <br> inside table cells', () => {
  it('1. loads as a hardbreak and saves as <br>', async () => {
    expect(await inlineTypes(table('x<br>y'), 'table_cell')).toEqual(['text', 'hardbreak', 'text'])
    expect(savedCell(await roundTrip(table('x<br>y')))).toBe('x<br>y')
  })

  it("2. the agent's real row: <br><br> is two hardbreaks and the cell is byte-identical", async () => {
    const out = await roundTrip(AGENT_TABLE)
    const back = out.split('\n')[2].split(' | ')[1].replace(/\s*\|$/, '')
    expect(back).toBe(AGENT_ROW.split(' | ')[1].replace(/\s*\|$/, ''))
    expect(back.match(/<br>/g)).toHaveLength(4)
  })

  it('3. every spelling loads as a hardbreak and saves as <br>', async () => {
    for (const br of ['<br/>', '<br />', '<BR>', '<br  >']) {
      expect(await inlineTypes(table(`x${br}y`), 'table_cell'), br).toEqual(['text', 'hardbreak', 'text'])
      expect(savedCell(await roundTrip(table(`x${br}y`))), br).toBe('x<br>y')
    }
  })

  it('4. header cells behave the same', async () => {
    expect(await inlineTypes(table('x', 'a<br>b'), 'table_header')).toEqual(['text', 'hardbreak', 'text'])
    expect(await roundTrip(table('x', 'a<br>b'))).toMatch(/^\| a<br>b \|/)
  })

  it('9. Shift-Enter inside a cell saves as <br>, not a space', async () => {
    const { crepe, close } = await open(table('xy'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'xy')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    shiftEnter(view)
    expect(savedCell(getMarkdownForSave(crepe))).toBe('x<br>y')
    await close()
  })

  it('11. two Shift-Enters in a row stay in the cell (Milkdown would split the table)', async () => {
    const { crepe, close } = await open(table('x'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'x')
    shiftEnter(view)
    shiftEnter(view)
    const out = getMarkdownForSave(crepe)
    expect(savedCell(out)).toBe('x<br><br>')
    expect(out.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3)
    await close()
  })

  it('12. two Shift-Enters in an EMPTY cell stay in the cell', async () => {
    const { crepe, close } = await open(table(''))
    const view = crepe.editor.ctx.get(editorViewCtx)
    let cellPos = -1
    view.state.doc.descendants((node, p) => {
      if (cellPos === -1 && node.type.name === 'table_cell') cellPos = p + 2
      return cellPos === -1
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos)))
    shiftEnter(view)
    shiftEnter(view)
    const out = getMarkdownForSave(crepe)
    expect(savedCell(out)).toBe('<br><br>')
    expect(out.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3)
    await close()
  })

  it('14. leading and trailing breaks in a cell round-trip (no decay across saves)', async () => {
    for (const cell of ['x<br>', 'x<br><br>', '<br>x<br>', '<br>']) {
      expect(savedCell(await roundTrip(table(cell))), cell).toBe(cell)
    }
  })

  it('15. an empty cell saves empty (Milkdown wrote `<br />`); a lone `<br />` in a cell is one break', async () => {
    expect(savedCell(await roundTrip(table('')))).toBe('')
    expect(await inlineTypes(table('<br />'), 'table_cell')).toEqual(['hardbreak'])
    expect(savedCell(await roundTrip(table('<br />')))).toBe('<br>')
  })

  it('17. Enter inside a cell is a new line in the cell (🔒 YAZ-1462), saved as <br>', async () => {
    const { crepe, close } = await open(table('xy'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'xy')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    pressEnter(view)
    const out = getMarkdownForSave(crepe)
    expect(savedCell(out)).toBe('x<br>y')
    expect(out.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3)
    await close()
  })

  it('18. Mod-Enter inside a cell still exits the table', async () => {
    const { crepe, close } = await open(table('x'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'x')
    pressEnter(view, { metaKey: true })
    expect(view.state.selection.$from.node(1).type.name).toBe('paragraph')
    expect(savedCell(getMarkdownForSave(crepe))).toBe('x')
    await close()
  })

  it('19. Enter outside a table is untouched (splits the paragraph)', async () => {
    const { crepe, close } = await open('ab')
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'ab')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    pressEnter(view)
    expect(getMarkdownForSave(crepe)).toBe('a\n\nb\n')
    await close()
  })

  it('13. Shift-Enter outside a table is untouched (Milkdown hardbreak, backslash on save)', async () => {
    const { crepe, close } = await open('ab')
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'ab')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    shiftEnter(view)
    expect(getMarkdownForSave(crepe)).toBe('a\\\nb\n')
    await close()
  })

  it('10. renders a real <br> element inside the cell', async () => {
    const { crepe, close } = await open(table('x<br>y'))
    const cell = crepe.editor.ctx.get(editorViewCtx).dom.querySelector('td p')
    expect(cell?.innerHTML).toBe('x<br data-type="hardbreak" data-is-inline="false">y')
    await close()
  })
})

describe('inline <br> elsewhere', () => {
  it('5. in a paragraph: hardbreak, saved as backslash + newline', async () => {
    expect(await inlineTypes('a<br>b', 'paragraph')).toEqual(['text', 'hardbreak', 'text'])
    expect(await roundTrip('a<br>b')).toBe('a\\\nb\n')
  })

  it('16. trailing <br>s at the end of a prose paragraph are dropped (CommonMark has no trailing hard break)', async () => {
    expect(await inlineTypes('a<br><br>\n\nb', 'paragraph')).toEqual(['text'])
    expect(await roundTrip('a<br><br>\n\nb')).toBe('a\n\nb\n')
    expect(await roundTrip('a<br>')).toBe('a\n')
  })
})

/**
 * A `<br>` and the line ending beside it are ONE hard break. Each case is saved, the saved text
 * is opened again, and that is saved too: the paragraph must not split, and a second save must
 * not add a backslash.
 */
describe('a <br> beside a line ending is one line break (YAZ-2659)', () => {
  it.each([
    { id: 'B1', shape: '`<br>` at a line end', file: 'a<br>\nb', saved: 'a\\\nb\n', paragraphs: 1 },
    { id: 'B2', shape: '`<br />` at a line end', file: 'a<br />\nb', saved: 'a\\\nb\n', paragraphs: 1 },
    { id: 'B3', shape: '`<br>` on a line of its own', file: 'a\n<br>\nb', saved: 'a\\\nb\n', paragraphs: 1 },
    { id: 'B4', shape: 'a space before the `<br>`', file: 'x <br>\ny', saved: 'x \\\ny\n', paragraphs: 1 },
    { id: 'B5', shape: 'two `<br>` at a line end', file: 'a<br><br>\nb', saved: 'a\\\n\\\nb\n', paragraphs: 1 },
    { id: 'B6', shape: 'a bullet', file: '* a<br>\n  b\n* c', saved: '* a\\\n  b\n* c\n', paragraphs: 2 },
    { id: 'B7', shape: 'a quote', file: '> a<br>\n> b', saved: '> a\\\n> b\n', paragraphs: 1 },
    { id: 'B8', shape: '`a<br>b` on one line', file: 'a<br>b', saved: 'a\\\nb\n', paragraphs: 1 },
    { id: 'B9', shape: '`<br>` at the end of a paragraph', file: 'a<br>', saved: 'a\n', paragraphs: 1 },
    { id: 'B9', shape: '`<br>` at the end of a paragraph with a paragraph below', file: 'a<br>\n\nb', saved: 'a\n\nb\n', paragraphs: 2 },
    { id: 'B11', shape: 'a lone `<br />` paragraph', file: 'p1\n\n<br />\n\np2', saved: 'p1\n\n<br />\n\np2\n', paragraphs: 3 },
  ])('$id, $shape: the paragraphs stay after the next open, and the second save is the first save (B12)', async ({ file, saved, paragraphs }) => {
    const first = await openAndSave(file)
    expect(first).toEqual({ text: saved, paragraphs })
    expect(await openAndSave(first.text)).toEqual(first)
  })

  it('B10, a table cell: the cell keeps its `<br>`, and the second save is the first save (B12)', async () => {
    const first = await openAndSave(table('a<br>b'))
    expect(savedCell(first.text)).toBe('a<br>b')
    expect(await openAndSave(first.text)).toEqual(first)
  })
})

describe('unchanged behaviours', () => {
  it("6. a lone <br /> paragraph (Milkdown's blank-line marker) still round-trips", async () => {
    expect(await roundTrip('p1\n\n<br />\n\np2')).toBe('p1\n\n<br />\n\np2\n')
  })

  it('7. an empty bullet written as `* <br />` still saves as a bare marker', async () => {
    expect(await roundTrip('* item\n\n* <br />\n\n* next')).toBe('* item\n\n*\n\n* next\n')
  })

  it('8. underline still round-trips', async () => {
    expect(await roundTrip('a <u>u</u> b')).toBe('a <u>u</u> b\n')
  })
})
