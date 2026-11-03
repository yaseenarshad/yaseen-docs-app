import { afterEach, describe, expect, it, vi } from 'vitest'
import { inputRulesCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { docToBox } from './textBoxDoc'
import { helpers, mountBox, typeText, unmountAll } from './textBoxTestKit'

vi.mock('../editor/createCrepe', async (load) => {
  const real = await load<typeof import('../editor/createCrepe')>()
  const list = ((globalThis as { __textBoxCrepes?: unknown[] }).__textBoxCrepes ??= [])
  return {
    ...real,
    createCrepe: (...args: Parameters<typeof real.createCrepe>) => {
      const crepe = real.createCrepe(...args)
      list.push(crepe)
      return crepe
    },
  }
})

afterEach(unmountAll)

// jsdom has no ClipboardEvent; ProseMirror's `pasteHTML` / `pasteText` make one
;(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {
  clipboardData = null
}

/** The box text the editor holds now. */
const boxText = (view: Awaited<ReturnType<typeof mountBox>>['view']) => docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).text

describe('the block lock of a text box (YAZ-4277 1B, D4)', () => {
  /**
   * Every input rule a box editor runs, by its pattern. A new note rule fails here until it is put on a side: kept
   * (it makes a mark or a block a box draws) or removed in `lockToTextBox` (it would make one a box cannot hold).
   */
  it('runs only the input rules that make what a box draws', async () => {
    const { crepe } = await mountBox('')
    const rules = crepe.editor.ctx.get(inputRulesCtx).map((rule) => String((rule as unknown as { match: RegExp }).match))
    expect(rules).toEqual([
      String(/(?:^|[^*])\*([^*]+)\*$/), // *italic*
      String(/\b_(?![_\s])(.*?[^_\s])_$/), // _italic_
      String(/(?<![\w:/])(?:\*\*|__)([^*_]+?)(?:\*\*|__)(?![\w/])$/), // **bold**
      String(/(?<![\w:/])(~{1,2})(.+?)\1(?!\w|\/)$/), // ~~strike~~
      String(/(?<![\w=])==(\S(?:[^=]*\S)?)==$/), // ==highlight==
      String(/^\[(?<checked>\s|x)\]\s$/), // [ ] in a bullet (the note's rule)
      String(/^\[(?<checked>\s|x)\]\s$/), // [ ] on a plain line (the box's rule, 1C)
    ])
  })

  /** Plugins outside the input rules that also act on typed text; each one is checked by a test below or is inert. */
  it('has only the known handlers of typed text', async () => {
    const { view } = await mountBox('')
    const keys = view.state.plugins
      .filter((plugin) => plugin.props.handleTextInput)
      .map((plugin) => (plugin as unknown as { key: string }).key.replace(/\$\d*$/, ''))
    expect(keys).toEqual([
      'mdapp-cell-note-card', // only inside a cell note card: a box has none
      'YAZ_LIST_MARKER_TYPING', // `- ` / `* ` makes a bullet; `1. ` stays text (below)
      'mdapp-visible-type-over', // typing over a selection that spans folded lines
      'MILKDOWN_CUSTOM_INPUTRULES',
    ])
  })

  it.each([
    ['# heading', '# '],
    ['> quote', '> '],
    ['``` code', '```'],
    ['--- line', '---'],
    ['`inline code`', '`code`'],
    ['|2x2| table', '|2x2| '],
    ['![image](src)', '![alt](pic.png)'],
    ['1. numbered', '1. '],
  ])('keeps every letter of a typed %s', async (_name, typed) => {
    const { view } = await mountBox('')
    typeText(view, typed)
    expect(boxText(view)).toBe(typed)
    expect(view.state.doc.child(0).type.name).toBe('paragraph')
  })

  it('makes a bullet of a typed `- `, as in a note', async () => {
    const { view } = await mountBox('')
    typeText(view, '- a')
    expect(boxText(view)).toBe('• a')
  })

  it.each([
    ['[ ] on a plain line', '', '[ ] a', '☐ a'],
    ['[x] on a plain line', '', '[x] a', '☑ a'],
    ['[ ] in a bullet', '• ', '[ ] a', '☐ a'],
    ['[ ] under a checklist joins it', '☐ one\n', '[ ] two', '☐ one\n☐ two'],
    ['[ ] in the middle of a line stays letters', 'x', '[ ] a', 'x[ ] a'],
  ])('makes a checklist item of a typed %s (1C)', async (_name, start, typed, box) => {
    const { view } = await mountBox(start)
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    typeText(view, typed)
    expect(boxText(view)).toBe(box)
  })

  it('turns a heading made by a key back into a line with the same letters', async () => {
    const { view } = await mountBox('Title\nbody')
    const { state } = view
    view.dispatch(state.tr.setBlockType(1, 1, state.schema.nodes.heading, { level: 1 }))
    expect(view.state.doc.child(0).type.name).toBe('paragraph')
    expect(boxText(view)).toBe('Title\nbody')
  })

  it('takes inline code and links off and keeps their letters', async () => {
    const { view } = await mountBox('code link')
    const { state } = view
    view.dispatch(
      state.tr
        .addMark(1, 5, state.schema.marks.inlineCode.create())
        .addMark(6, 10, state.schema.marks.link.create({ href: 'https://x.test' })),
    )
    // a box run has no code or link style: the letters stay, the marks a box cannot draw do not reach the box
    expect(docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers)).toEqual({ text: 'code link', textRuns: undefined })
  })

  it('pastes every block a box cannot hold as lines and bullets, with all its letters', async () => {
    const { view } = await mountBox('')
    view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)))
    view.pasteHTML(
      [
        '<h1>Title</h1>',
        '<blockquote><p>quoted</p></blockquote>',
        '<pre><code>line a\nline b</code></pre>',
        '<ol><li><p>first</p></li><li><p>second</p><ol><li><p>inner</p></li></ol></li></ol>',
        '<table><tr><td>c1</td><td>c2</td></tr></table>',
        '<hr>',
        '<p><img src="pic.png" alt="pic"> <code>x</code> <a href="https://x.test">link</a> <strong>bold</strong></p>',
      ].join(''),
    )
    const text = boxText(view)
    for (const letters of ['Title', 'quoted', 'line a', 'line b', '1. first', '2. second', '1. inner', 'c1', 'c2', 'x link bold']) expect(text).toContain(letters)
    view.state.doc.forEach((node) => expect(['paragraph', 'bullet_list']).toContain(node.type.name))
    const back = docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers)
    expect(back.textRuns).toEqual([{ start: text.indexOf('bold'), end: text.indexOf('bold') + 4, bold: true }])
  })

  it('keeps a pasted run of plain text as typed letters', async () => {
    const { view } = await mountBox('ab')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    view.pasteText('XY')
    expect(boxText(view)).toBe('aXYb')
  })

  it('adds no empty line after a box that ends in a bullet', async () => {
    const { view } = await mountBox('• last')
    expect(view.state.doc.childCount).toBe(1)
    typeText(view, 'x')
    expect(boxText(view)).toBe('• xlast')
    expect(view.state.doc.lastChild?.type.name).toBe('bullet_list')
  })
})
