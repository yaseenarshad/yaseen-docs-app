/**
 * Formatting inside a code block (YAZ-5794): the mark parts of the `<!-- code: … -->` comment (D1), the fit after an
 * outside edit (D2), real editors that load, save and load again, typing and undo, and the page toolbar in code (D3,
 * D4). CodeMirror does not start in jsdom (no IntersectionObserver), so a typed key is the page transaction Crepe makes
 * from it, and the drawing and the keys inside CodeMirror are checked in the app (the end-to-end check, YAZ-5829).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { closeHistory, redo, undo } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { AttrStep } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { setHighlightCommand } from '../marks/highlight'
import { commandsCtx } from '@milkdown/kit/core'
import { budgetMs } from '../../test-perf'
import { cleanSpans, fitMarks, formatCodeComment, formatMarkPart, marksFromSpans, parseCodeComment, parseMarkPart, spansFromMarks, type CodeMark } from './codeComment'
import { clearCodeMarks, codeMarkCommand, codeSelection } from './codeMarks'
import * as toolbar from '../toolbarTestKit'

afterEach(async () => {
  await unmountAll()
  await toolbar.unmountAll()
})

const CODE = 'async function load(id) {\n  const user = await fetchUser(id)\n  return user.name\n}'
const FENCE = `\`\`\`js\n${CODE}\n\`\`\`\n`

const block = (view: EditorView): { node: ProseNode; pos: number } => {
  let out: { node: ProseNode; pos: number } | null = null
  view.state.doc.descendants((node, pos) => {
    if (out === null && node.type.name === 'code_block') out = { node, pos }
    return out === null
  })
  return out!
}
const spansIn = (view: EditorView) => block(view).node.attrs.marks
/** Select `text` (its first copy) inside the code block, as Crepe copies CodeMirror's selection to the page. */
function selectCode(view: EditorView, text: string, nth = 0): void {
  const { node, pos } = block(view)
  let at = -1
  for (let i = 0; i <= nth; i++) at = node.textContent.indexOf(text, at + 1)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1 + at, pos + 1 + at + text.length)))
}
/** A key typed into the code: the page transaction Crepe's code block makes from CodeMirror's change. */
function typeInCode(view: EditorView, offset: number, text: string, deleteCount = 0): void {
  const start = block(view).pos + 1 + offset
  const tr = view.state.tr
  if (text === '') tr.delete(start, start + deleteCount)
  else tr.replaceWith(start, start + deleteCount, view.state.schema.text(text))
  view.dispatch(tr)
}
const run = (view: EditorView, command: ReturnType<typeof codeMarkCommand>) => command(view.state, view.dispatch)

describe('the mark parts of the code comment (D1)', () => {
  it('reads and writes each kind, a highlight with its colour', () => {
    const marks: CodeMark[] = [
      { kind: 'bold', color: null, line: 2, col: 22, text: 'fetchUser' },
      { kind: 'italic', color: null, line: 1, col: 1, text: 'async' },
      { kind: 'underline', color: null, line: 3, col: 10, text: 'user.name' },
      { kind: 'strike', color: null, line: 4, col: 1, text: '}' },
      { kind: 'highlight', color: null, line: 1, col: 7, text: 'function' },
      { kind: 'highlight', color: 'green', line: 3, col: 3, text: 'return' },
      { kind: 'highlight', color: '#a1b2c3', line: 2, col: 9, text: 'user' },
    ]
    expect(marks.map(formatMarkPart)).toEqual([
      'bold 2:22 "fetchUser"',
      'italic 1:1 "async"',
      'underline 3:10 "user.name"',
      'strike 4:1 "}"',
      'highlight 1:7 "function"',
      'highlight-green 3:3 "return"',
      'highlight-#a1b2c3 2:9 "user"',
    ])
    const comment = formatCodeComment({ width: null, marks, unknownParts: [] })!
    expect(parseCodeComment(comment)).toEqual({ width: null, marks, unknownParts: [] })
  })

  it('a text with a comma, a quote, a `>` and a backslash stays one part and never ends the comment', () => {
    const mark: CodeMark = { kind: 'bold', color: null, line: 1, col: 1, text: 'a, "b" --> c\\d' }
    const comment = formatCodeComment({ width: 900, marks: [mark], unknownParts: [] })!
    expect(comment).toBe('<!-- code: width 900, bold 1:1 "a\\u002c \\"b\\" --\\u003e c\\\\d" -->')
    expect(parseCodeComment(comment)).toEqual({ width: 900, marks: [mark], unknownParts: [] })
  })

  it('keeps the width, the marks and the unknown parts, each in its place; an older build keeps a mark as text', () => {
    const comment = '<!-- code: wrap, width 900, bold 1:1 "x", theme dark -->'
    const look = parseCodeComment(comment)!
    expect(look.marks).toEqual([{ kind: 'bold', color: null, line: 1, col: 1, text: 'x' }])
    expect(formatCodeComment(look)).toBe(comment)
    // A part this build cannot read (a newer kind, a broken text) stays text, with its bytes.
    for (const part of ['blink 1:1 "x"', 'bold 0:1 "x"', 'bold 1:1 ""', 'bold 1:1 "a\\nb"', 'bold 1:1 x', 'highlight-Green 1:1 "x"'])
      expect(parseMarkPart(part)).toBeNull()
  })
})

describe('the fit after an outside edit (D2)', () => {
  const mark = (line: number, col: number, text: string): CodeMark => ({ kind: 'bold', color: null, line, col, text })
  it('stays on its text; follows it on the line to the nearest copy; goes when the text or the line is gone', () => {
    const code = 'a fetchUser b fetchUser\nsecond line'
    expect(fitMarks(code, [mark(1, 3, 'fetchUser')])).toEqual([mark(1, 3, 'fetchUser')])
    expect(fitMarks(code, [mark(1, 5, 'fetchUser')])).toEqual([mark(1, 3, 'fetchUser')])
    expect(fitMarks(code, [mark(1, 13, 'fetchUser')])).toEqual([mark(1, 15, 'fetchUser')])
    expect(fitMarks(code, [mark(2, 1, 'fetchUser')])).toEqual([])
    expect(fitMarks(code, [mark(3, 1, 'x')])).toEqual([])
  })

  it('spans and marks convert both ways; a span over a line break splits at it', () => {
    const spans = cleanSpans(CODE, [{ from: 0, to: 40, kind: 'bold', color: null }])
    expect(spans.map((s) => CODE.slice(s.from, s.to))).toEqual(['async function load(id) {', '  const user ='])
    expect(spansFromMarks(CODE, marksFromSpans(CODE, spans))).toEqual(spans)
  })
})

describe('code marks in a real editor', () => {
  it('a page with marks loads them on the block, saves the same bytes, and the code lines stay plain', async () => {
    const page = `${FENCE}<!-- code: width 900, bold 2:22 "fetchUser", highlight-green 3:10 "user.name" -->\n\nAfter\n`
    const { crepe, view } = await mount(page)
    expect(spansIn(view)).toEqual([
      { from: 47, to: 56, kind: 'bold', color: null },
      { from: 70, to: 79, kind: 'highlight', color: 'green' },
    ])
    expect(getMarkdownForSave(crepe)).toBe(page)
    const again = await mount(getMarkdownForSave(crepe))
    expect(getMarkdownForSave(again.crepe)).toBe(page)
  })

  it('a code block with no marks keeps the bytes of before', async () => {
    const { crepe, view } = await mount(FENCE)
    expect(spansIn(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(FENCE)
  })

  it('an outside edit that moved the text: the mark follows it; a mark whose text is gone drops on the next save', async () => {
    const page = `\`\`\`js\nconst fetchUser = 1\n\`\`\`\n<!-- code: bold 1:1 "fetchUser", underline 1:1 "gone" -->\n`
    const { crepe } = await mount(page)
    expect(getMarkdownForSave(crepe)).toBe('```js\nconst fetchUser = 1\n```\n<!-- code: bold 1:7 "fetchUser" -->\n')
  })

  it('a card (the `card` language) writes no marks', async () => {
    const { crepe } = await mount('```card\nfront\n```\n<!-- code: bold 1:1 "front" -->\n')
    expect(getMarkdownForSave(crepe)).not.toContain('bold')
  })

  it('the toggle: on, then off; a highlight colour replaces another; ⌘\\ clears; outside code it declines', async () => {
    const { crepe, view } = await mount(`${FENCE}\nplain text\n`)
    selectCode(view, 'fetchUser')
    expect(run(view, codeMarkCommand('bold'))).toBe(true)
    expect(getMarkdownForSave(crepe)).toContain('<!-- code: bold 2:22 "fetchUser" -->')
    expect(run(view, codeMarkCommand('bold'))).toBe(true)
    expect(spansIn(view)).toBeNull()
    crepe.editor.action((ctx) => ctx.get(commandsCtx).call(setHighlightCommand.key, 'green'))
    crepe.editor.action((ctx) => ctx.get(commandsCtx).call(setHighlightCommand.key, 'blue'))
    expect(spansIn(view)).toEqual([{ from: 47, to: 56, kind: 'highlight', color: 'blue' }])
    run(view, codeMarkCommand('underline'))
    expect(clearCodeMarks(view.state, view.dispatch)).toBe(true)
    expect(spansIn(view)).toBeNull()
    // Part of a mark off: the two ends stay.
    selectCode(view, 'const user = await fetchUser(id)')
    run(view, codeMarkCommand('italic'))
    selectCode(view, 'await')
    run(view, codeMarkCommand('italic'))
    expect(marksFromSpans(block(view).node.textContent, spansIn(view)).map((m) => m.text)).toEqual(['const user = ', ' fetchUser(id)'])
    // Outside code: nothing to do, the page's own commands run.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 6, view.state.doc.content.size - 2)))
    expect(codeSelection(view.state)).toBeNull()
    expect(run(view, codeMarkCommand('bold'))).toBe(false)
  })

  it('typing moves the marks; a key at the end grows a mark, at its start not; one undo takes both back', async () => {
    const { crepe, view } = await mount(FENCE)
    selectCode(view, 'fetchUser')
    run(view, codeMarkCommand('bold'))
    typeInCode(view, 0, '// x\n')
    expect(marksFromSpans(block(view).node.textContent, spansIn(view))).toEqual([{ kind: 'bold', color: null, line: 3, col: 22, text: 'fetchUser' }])
    const start = block(view).node.textContent.indexOf('fetchUser')
    typeInCode(view, start + 9, 'X')
    typeInCode(view, start, 'Y')
    expect(marksFromSpans(block(view).node.textContent, spansIn(view))[0].text).toBe('fetchUserX')
    // A line break typed inside the mark splits it; deleting its text drops it.
    typeInCode(view, start + 6, '\n')
    expect(marksFromSpans(block(view).node.textContent, spansIn(view)).map((m) => m.text)).toEqual(['fetch', 'UserX'])
    const before = getMarkdownForSave(crepe)
    view.dispatch(closeHistory(view.state.tr))
    typeInCode(view, start + 1, '', 5)
    expect(marksFromSpans(block(view).node.textContent, spansIn(view)).map((m) => m.text)).toEqual(['UserX'])
    // One undo: the typed delete AND the move of its marks.
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(before)
    expect(redo(view.state, view.dispatch)).toBe(true)
    expect(marksFromSpans(block(view).node.textContent, spansIn(view)).map((m) => m.text)).toEqual(['UserX'])
  })

  it('perf: a key in a 2,000-line block with 200 marks; a block with no marks does no mark work', async () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `const value${i} = compute(${i})`)
    const marks = Array.from({ length: 200 }, (_, i) => `bold ${i * 10 + 1}:7 "value${i * 10}"`).join(', ')
    const { view } = await mount(`\`\`\`js\n${lines.join('\n')}\n\`\`\`\n<!-- code: ${marks} -->\n`)
    expect(spansIn(view)).toHaveLength(200)
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) typeInCode(view, 0, 'x')
    const perKey = (performance.now() - t0) / 20
    expect(spansIn(view)[0].from).toBe(26)
    expect(perKey).toBeLessThan(budgetMs(8))
    // A key in a block with marks appends ONE transaction (the marks' move); with no marks, none.
    const markSteps = (v: EditorView) =>
      v.state
        .applyTransaction(v.state.tr.insertText('x', block(v).pos + 1))
        .transactions.flatMap((tr) => tr.steps)
        .filter((step) => step instanceof AttrStep && step.attr === 'marks').length
    expect(markSteps(view)).toBe(1)
    const plain = await mount(FENCE)
    expect(markSteps(plain.view)).toBe(0)
  })
})

describe('the page toolbar in code (D3, D4)', () => {
  it('in code: only the Text style group, and its buttons run the code marks; on page text: the whole strip', async () => {
    const { view } = await toolbar.mount(`${FENCE}\nplain text here\n`)
    await toolbar.select(view, 'plain text')
    expect(toolbar.order()).toContain('h1')
    // The focus in the block's own editor, as in the app: CodeMirror does not start in jsdom, so a stand-in holds it.
    const codeEditor = Object.assign(document.createElement('div'), { contentEditable: 'true', tabIndex: 0 })
    view.dom.querySelector('.milkdown-code-block')!.appendChild(codeEditor)
    codeEditor.focus()
    selectCode(view, 'fetchUser')
    await toolbar.settle()
    expect(toolbar.order()).toEqual(['bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-more'])
    await toolbar.press('bold')
    await toolbar.press('strikethrough')
    await toolbar.press('highlight-green')
    expect(spansIn(view).map((s: { kind: string; color: string | null }) => `${s.kind}${s.color ? `-${s.color}` : ''}`).sort()).toEqual(['bold', 'highlight-green', 'strike'])
    expect(toolbar.must('bold').classList.contains('active')).toBe(true)
    expect(toolbar.must('italic').classList.contains('active')).toBe(false)
    expect(toolbar.litDots()).toEqual(['highlight-green'])
    await toolbar.press('bold')
    expect(toolbar.must('bold').classList.contains('active')).toBe(false)
    view.focus()
    await toolbar.select(view, 'plain text')
    expect(toolbar.order()).toContain('h1')
  })
})
