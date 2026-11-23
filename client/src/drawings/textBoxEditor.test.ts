import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@milkdown/kit/prose/state'
import { docToBox, offsetAt, posAt, type TextRuns } from './textBoxDoc'
import { createTextBoxEditor } from './textBoxEditor'
import { created, helpers, mountBox, typeText, unmountAll } from './textBoxTestKit'

vi.mock('../editor/createCrepe', async (load) => {
  const real = await load<typeof import('../editor/createCrepe')>()
  const list = ((globalThis as { __textBoxCrepes?: unknown[] }).__textBoxCrepes ??= [])
  return {
    ...real,
    createCrepe: (...args: Parameters<typeof real.createCrepe>) => {
      const crepe = real.createCrepe(...args)
      list.push(crepe)
      ;(globalThis as { __onTextBoxCrepe?: (crepe: unknown) => void }).__onTextBoxCrepe?.(crepe)
      return crepe
    },
  }
})

afterEach(unmountAll)

// The demo board's box (YAZ-4277): a bold underlined title whose run ends after its line break, bullets, an empty child.
const MOAT = 'Our main Moat:\n• 1) Automated Pipeline\n    ○ \n• 2) Editing (Power User)\n• 3) Schedule / Posting\n• 4) Server / Rendering Scaling'
const MOAT_RUNS: TextRuns = [{ start: 0, end: 15, bold: true, underline: true }]

/** What the editor gives back for the box it opened with, with nothing typed. */
async function roundTrip(text: string, textRuns: TextRuns) {
  const { view } = await mountBox(text, textRuns)
  return docToBox(view.state.doc, { text, textRuns }, helpers)
}

describe('textBoxEditor: box ↔ editor with no loss (YAZ-4277 1B)', () => {
  const fixtures: Array<[string, string, TextRuns]> = [
    ['plain', 'one line', undefined],
    ['the Moat box', MOAT, MOAT_RUNS],
    ['three levels', 'Levels:\n• one\n    ○ two\n        ▪ three\n        ▪ three b\n    ○ two b\n• one b', undefined],
    ['a checklist', 'To do:\n☐ open\n☑ done\n    ☐ child of done\n• bullet\n    ☑ ticked child', [{ start: 9, end: 13, bold: true }]],
    ['every mark', 'b i u s c h g x', [
      { start: 0, end: 1, bold: true },
      { start: 2, end: 3, italic: true },
      { start: 4, end: 5, underline: true },
      { start: 6, end: 7, strikethrough: true },
      { start: 8, end: 9, color: '#e03131' },
      { start: 10, end: 11, highlight: 'yellow' },
      { start: 12, end: 13, highlight: 'green' },
      { start: 14, end: 15, highlight: '#ffc9c9' },
    ]],
    ['mixed runs over lines and bullets', 'Title\n• first item here\n    ○ second', [
      { start: 0, end: 3, bold: true, italic: true },
      { start: 2, end: 12, color: '#1971c2' },
      { start: 6, end: 9, underline: true },
      { start: 26, end: 33, strikethrough: true, highlight: 'blue' },
    ]],
    ['links', 'see [[YAS-1]] and [[Growth plan|plan]]\n• [[YAZ-12]]', [{ start: 4, end: 13, bold: true }]],
    ['empty lines', '\n\na\n\n• b\n\n', undefined],
    ['trailing spaces', 'a   \n• b  \n    ○   ', undefined],
    ['right to left', 'שלום עולם\n• مرحبا بالعالم', [{ start: 0, end: 4, bold: true }]],
    ['emoji', '👋🏽 hi\n• 🎉 party 👨‍👩‍👧', [{ start: 0, end: 4, italic: true }, { start: 15, end: 19, color: '#2f9e44' }]],
    ['lines that are not box bullets', '○ wrong marker for level 0\n•  two spaces\n        ▪ level with no parent\n1. numbered\n- dash\n* star\n• ok\n            ▪ jump', undefined],
  ]

  it.each(fixtures)('gives back %s unchanged', async (_name, text, textRuns) => {
    const back = await roundTrip(text, textRuns)
    expect(back.text).toBe(text)
    expect(back.textRuns).toEqual(helpers.normalizeTextRuns(textRuns, text.length))
  })

  it('opens bullets as list items, checklist markers as ticks, and other lines as paragraphs', async () => {
    const { view } = await mountBox('Title\n• a\n    ○ b\n☑ c\n○ d')
    const doc = view.state.doc
    expect(doc.childCount).toBe(3)
    expect(doc.child(0).type.name).toBe('paragraph')
    const list = doc.child(1)
    expect(list.type.name).toBe('bullet_list')
    expect(list.childCount).toBe(2)
    expect(list.child(0).child(1).child(0).textContent).toBe('b')
    expect(list.child(1).attrs.checked).toBe(true)
    expect(doc.child(2).textContent).toBe('○ d')
  })

  it('opens the letter styles as marks', async () => {
    const { view } = await mountBox('bold red', [{ start: 0, end: 4, bold: true }, { start: 5, end: 8, color: '#e03131' }])
    const para = view.state.doc.child(0)
    expect(para.child(0).marks.map((m) => m.type.name)).toEqual(['strong'])
    expect(para.child(2).marks.map((m) => [m.type.name, m.attrs.color])).toEqual([['text_color', '#e03131']])
  })

  it('reports an edit in a bullet as box text, its runs moved with it', async () => {
    const { view, onChange } = await mountBox(MOAT, MOAT_RUNS)
    // the end of "1) Automated Pipeline"
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posAt(view.state.doc, 38, helpers))))
    typeText(view, '!')
    expect(onChange).toHaveBeenLastCalledWith(MOAT.replace('Pipeline', 'Pipeline!'), MOAT_RUNS, { anchor: 39, head: 39 })
  })

  it('writes a new sub-bullet with the marker of its level', async () => {
    const { view, onChange } = await mountBox('• a')
    const { sinkListItem, splitListItem } = await import('@milkdown/kit/prose/schema-list')
    const item = view.state.schema.nodes.list_item
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    splitListItem(item)(view.state, view.dispatch)
    sinkListItem(item)(view.state, view.dispatch)
    typeText(view, 'b')
    expect(onChange).toHaveBeenLastCalledWith('• a\n    ○ b', undefined, { anchor: 11, head: 11 })
  })

  it('reports a style change with the same letters', async () => {
    const { view, onChange } = await mountBox('make bold')
    const { state } = view
    view.dispatch(state.tr.addMark(posAt(state.doc, 5, helpers), posAt(state.doc, 9, helpers), state.schema.marks.strong.create()))
    expect(onChange).toHaveBeenLastCalledWith('make bold', [{ start: 5, end: 9, bold: true }], expect.anything())
  })

  it('reports an edit with its selection, as offsets in the box text; a caret move alone as a selection', async () => {
    const { view, onChange, onSelectionChange } = await mountBox('ab\n• cd', undefined, { anchor: 7, head: 7 })
    typeText(view, 'X')
    expect(onChange).toHaveBeenLastCalledWith('ab\n• cdX', undefined, { anchor: 8, head: 8 })
    expect(onSelectionChange).not.toHaveBeenCalled()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(onSelectionChange).toHaveBeenLastCalledWith({ anchor: 0, head: 0 })
  })

  it('puts a text in place of a range as one edit, the caret after it (a picked link)', async () => {
    const { view, session, onChange } = await mountBox('see [[Gro', undefined, { anchor: 9, head: 9 })
    session.replaceText(4, 9, '[[YAS-1]]')
    expect(onChange).toHaveBeenLastCalledWith('see [[YAS-1]]', undefined, { anchor: 13, head: 13 })
    const { undo } = await import('@milkdown/kit/prose/history')
    undo(view.state, view.dispatch)
    expect(onChange).toHaveBeenLastCalledWith('see [[Gro', undefined, expect.anything())
  })

  it('starts on the selection it is given, and takes a new one from a click', async () => {
    const { view, session } = await mountBox('hello\n• world', undefined, { anchor: 0, head: 13 })
    const doc = view.state.doc
    expect([offsetAt(doc, view.state.selection.anchor, helpers), offsetAt(doc, view.state.selection.head, helpers)]).toEqual([0, 13])
    session.setSelection({ anchor: 10, head: 2 })
    expect(view.state.selection.anchor).toBe(posAt(doc, 10, helpers))
    expect(view.state.selection.head).toBe(posAt(doc, 2, helpers))
  })

  it('YAZ-4902: a selection to the end of a coloured line is reported to its end', async () => {
    // the real shape: a 24-letter first line under one colour run, a longer second line
    const text = '(Harbor Lts Proj - #125)\n(Quiet Field Again - #131)'
    const runs: TextRuns = [{ start: 0, end: 24, color: '#1971c2' }]
    const { view, session, onSelectionChange } = await mountBox(text, runs, { anchor: 0, head: 0 })
    session.setSelection({ anchor: 0, head: 24 })
    expect(onSelectionChange).toHaveBeenLastCalledWith({ anchor: 0, head: 24 })
    const { doc } = view.state
    expect(doc.textBetween(posAt(doc, 0, helpers), posAt(doc, 24, helpers))).toBe('(Harbor Lts Proj - #125)')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, posAt(doc, 0, helpers), posAt(doc, 24, helpers))))
    expect(onSelectionChange).toHaveBeenLastCalledWith({ anchor: 0, head: 24 })
  })

  it('maps offsets and positions both ways; an offset in a bullet prefix goes to its letters', async () => {
    const { view } = await mountBox('ab\n\n• cd\n    ○ e')
    const { doc } = view.state
    for (const offset of [0, 1, 2, 3, 6, 7, 8, 15, 16]) expect(offsetAt(doc, posAt(doc, offset, helpers), helpers)).toBe(offset)
    // "• " is offsets 4 and 5: both land before "c"
    expect(offsetAt(doc, posAt(doc, 4, helpers), helpers)).toBe(6)
  })

  it('opens an empty box as one empty line', async () => {
    const { view } = await mountBox('')
    expect(view.state.doc.childCount).toBe(1)
    expect(docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers)).toEqual({ text: '', textRuns: undefined })
  })

  it('does not undo past the text the edit started with', async () => {
    const { view } = await mountBox('keep')
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    view.dispatch(view.state.tr.insertText('!'))
    const { undo } = await import('@milkdown/kit/prose/history')
    // ⌘Z takes back the typing, then has nothing more: the box text stays
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.textContent).toBe('keep')
    expect(undo(view.state, view.dispatch)).toBe(false)
    expect(view.state.doc.textContent).toBe('keep')
  })

  it('stops reporting once destroyed', async () => {
    const { view, session, onChange } = await mountBox('x')
    session.destroy()
    view.dispatch(view.state.tr.insertText('y', 1))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('makes one Crepe for each edit', async () => {
    const before = created.length
    await mountBox('a')
    expect(created.length).toBe(before + 1)
  })

  it('tears the editor down after a failed setup, and logs the failure (YAZ-4312 S12)', async () => {
    const failure = new Error('no editor')
    const destroy = vi.fn(async () => undefined)
    const hook = globalThis as { __onTextBoxCrepe?: (crepe: { create: () => Promise<unknown>; destroy: () => Promise<unknown> }) => void }
    // the next Crepe fails to create
    hook.__onTextBoxCrepe = (crepe) => {
      crepe.create = () => Promise.reject(failure)
      crepe.destroy = destroy
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const root = document.createElement('div')
      const session = createTextBoxEditor(helpers).mount({
        root, text: 'a', textRuns: undefined, foldedLines: [], selection: { anchor: 0, head: 0 },
        onChange: vi.fn(), onSelectionChange: vi.fn(), onFoldsChange: vi.fn(), clientRectAt: () => null,
      })
      // the session does nothing while the editor is not ready
      session.setSelection({ anchor: 1, head: 1 })
      session.destroy()
      await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1))
      expect(error).toHaveBeenCalledWith('[text-box-editor] create failed:', failure)
    } finally {
      hook.__onTextBoxCrepe = undefined
      error.mockRestore()
    }
  })
})
