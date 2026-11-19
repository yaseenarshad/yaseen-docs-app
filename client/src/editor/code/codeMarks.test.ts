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
import { clearCodeMarks, codeMarkCommand, codeMarkDecorations, codeMarkKeys, codeSelection } from './codeMarks'
import { applyHighlight, highlightSchema, removeHighlight } from '../marks/highlight'
import { DOMParser as ProseDOMParser } from '@milkdown/kit/prose/model'
import { EditorState as CodeMirrorState } from '@codemirror/state'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe } from '../createCrepe'
import { applyExternalMarkdown, EXTERNAL_EDIT_META } from '../external/applyExternalMarkdown'
import { OUTSIDE_EDIT } from './codeMarks'
import { IS_MAC } from '../marks/markTestKit'
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
/**
 * The focus in the block's own editor, as CodeMirror holds it in the app: CodeMirror does not start in jsdom, so a
 * stand-in inside the block's DOM holds it. With the focus on the page instead, ProseMirror reads the DOM selection
 * back and drops a selection inside the block.
 */
function focusCode(view: EditorView): void {
  const stand = Object.assign(document.createElement('div'), { contentEditable: 'true', tabIndex: 0 })
  ;(view.nodeDOM(block(view).pos) as HTMLElement).appendChild(stand)
  stand.focus()
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
    // The marks' own work on a key: the plugin's appendTransaction (map, check, one attribute step). Timed alone,
    // warm, because the whole key on a 2,000-line page in jsdom costs ms and varies by more than this work.
    const plugin = view.state.plugins.find((p) => String((p as unknown as { key: string }).key).startsWith('mdapp-code-marks'))!
    const append = plugin.spec.appendTransaction!.bind(plugin)
    const key = view.state.tr.insertText('x', block(view).pos + 1)
    const after = view.state.apply(key)
    for (let i = 0; i < 5; i++) append([key], view.state, after)
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) append([key], view.state, after)
    expect((performance.now() - t0) / 20).toBeLessThan(budgetMs(1))
    for (let i = 0; i < 20; i++) typeInCode(view, 0, 'x')
    expect(spansIn(view)[0].from).toBe(26)
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
    focusCode(view)
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

describe('where the code marks do not go (D3, D4, YAZ-5827)', () => {
  const shown = () => document.querySelector('.milkdown-toolbar')?.getAttribute('data-show') === 'true'

  it('no toolbar: an empty selection, a card block, a read-only page, or an editor with code marks off', async () => {
    const { view } = await toolbar.mount(FENCE)
    focusCode(view)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, block(view).pos + 3)))
    await toolbar.settle()
    expect(shown()).toBe(false)
    selectCode(view, 'fetchUser')
    await toolbar.settle()
    expect(shown()).toBe(true)
    view.setProps({ editable: () => false })
    selectCode(view, 'user.name')
    await toolbar.settle()
    expect(shown()).toBe(false)
    await toolbar.unmountAll()

    const card = await toolbar.mount('```card\nfront side\n```\n')
    focusCode(card.view)
    selectCode(card.view, 'front')
    await toolbar.settle()
    expect(shown()).toBe(false)
    expect(run(card.view, codeMarkCommand('bold'))).toBe(false)

    const root = document.body.appendChild(document.createElement('div'))
    const off = createCrepe({ root, defaultValue: FENCE, codeMarks: false })
    await off.create()
    const offView = off.editor.action((ctx) => ctx.get(editorViewCtx))
    focusCode(offView)
    selectCode(offView, 'fetchUser')
    await toolbar.settle()
    expect([...root.querySelectorAll('.milkdown-toolbar')].some((el) => el.getAttribute('data-show') === 'true')).toBe(false)
    await off.destroy()
    root.remove()
  })

  it("the keys in a code block run the code marks, with the user's own key, and not on a read-only page", async () => {
    const { view } = await mount(FENCE)
    // A real CodeMirror in the block's box, with the app's code mark extensions, as Crepe starts one in the app.
    const box = view.dom.querySelector<HTMLElement>('.milkdown-code-block')!
    const cm = new CodeMirrorView({
      state: CodeMirrorState.create({ doc: block(view).node.textContent, extensions: [codeMarkDecorations, codeMarkKeys({ 'page.italic': 'CmdOrCtrl+Alt+I' })] }),
      parent: box,
    })
    const press = (key: string, extra: KeyboardEventInit = {}) =>
      cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }), ...extra }))
    const kinds = () => (spansIn(view) ?? []).map((s: { kind: string }) => s.kind).sort()
    selectCode(view, 'fetchUser')
    press('b')
    press('u')
    press('x', { shiftKey: true })
    press('h', { shiftKey: true })
    expect(kinds()).toEqual(['bold', 'highlight', 'strike', 'underline'])
    // The user moved Italic to ⌘⌥I: ⌘I does nothing in code, ⌘⌥I runs it.
    press('i')
    expect(kinds()).not.toContain('italic')
    press('i', { altKey: true })
    expect(kinds()).toContain('italic')
    press('\\')
    expect(spansIn(view)).toBeNull()
    view.setProps({ editable: () => false })
    press('b')
    expect(spansIn(view)).toBeNull()
    cm.destroy()
  })

  it("a custom colour and the ▾ panel's None work in code", async () => {
    const { crepe, view } = await mount(FENCE)
    const type = crepe.editor.action((ctx) => highlightSchema.type(ctx))
    focusCode(view)
    selectCode(view, 'fetchUser')
    expect(applyHighlight(type, '#a1b2c3')(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toContain('<!-- code: highlight-#a1b2c3 2:22 "fetchUser" -->')
    expect(removeHighlight(type)(view.state, view.dispatch)).toBe(true)
    expect(spansIn(view)).toBeNull()
    expect(removeHighlight(type)(view.state, view.dispatch)).toBe(false)
  })

  it('a colour this build does not know is no mark: it stays as text in the comment', async () => {
    const page = `${FENCE}<!-- code: highlight-teal 2:22 "fetchUser" -->\n`
    const { crepe, view } = await mount(page)
    expect(spansIn(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(page)
  })

  it('a paste of part of a block: each mark is fitted to the pasted code, and never lands on other text', async () => {
    const { view } = await mount('x\n')
    const html = (marks: string, code: string) => {
      const div = document.createElement('div')
      const pre = div.appendChild(document.createElement('pre'))
      pre.setAttribute('data-code-marks', marks)
      pre.appendChild(document.createElement('code')).textContent = code
      return ProseDOMParser.fromSchema(view.state.schema).parse(div).firstChild!
    }
    // Copied from line 2 of a block: the marks still name lines of the whole block, so they do not fit and go.
    const part = html('bold 2:22 "fetchUser"\nitalic 1:1 "async"', '  return user.name')
    expect(part.attrs.marks).toBeNull()
    // The whole block: each mark fits.
    const whole = html('bold 2:22 "fetchUser"', CODE)
    expect(marksFromSpans(whole.textContent, whole.attrs.marks).map((m) => m.text)).toEqual(['fetchUser'])
  })
})

describe('checker round 1 bugs', () => {
  const PAD = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i} with some words to keep the page big.`).join('\n\n')
  const page = (code: string, comment: string) => `\`\`\`js\n${code}\n\`\`\`\n${comment}\n\n${PAD}\n`

  it('YAZ-5851: an outside edit fits the marks as a fresh load does (D2), never as typing', async () => {
    for (const [comment, edit] of [
      ['<!-- code: highlight 3:10 "user.name" -->', (c: string) => c.replace('user.name', 'user.nameFull')],
      ['<!-- code: bold 2:22 "fetchUser" -->', (c: string) => c.replace('fetchUser', 'fetchUserById')],
      ['<!-- code: bold 2:22 "fetchUser", highlight-green 3:10 "user.name" -->', (c: string) => c.replace('load', 'read').replace('}', '};')],
    ] as const) {
      const { crepe } = await mount(page(CODE, comment))
      const next = page(edit(CODE), comment)
      expect(applyExternalMarkdown(crepe, next)).toBe('applied')
      const fresh = await mount(next)
      expect(getMarkdownForSave(crepe)).toBe(getMarkdownForSave(fresh.crepe))
    }
  })

  it('the outside-edit stamp is the one the app puts on an outside edit', () => expect(OUTSIDE_EDIT).toBe(EXTERNAL_EDIT_META))

  it('YAZ-5854: a comment with no width, a mark and a part after it saves the same bytes twice', () => {
    const look = parseCodeComment('<!-- code: width 900, bold 2:22 "fetchUser", theme dark -->')!
    const written = formatCodeComment({ ...look, width: null })!
    expect(formatCodeComment(parseCodeComment(written)!)).toBe(written)
  })

  it('YAZ-5853: a copy that starts inside a code block keeps each mark on its own text', async () => {
    const { view } = await mount(page(CODE, '<!-- code: bold 2:22 "fetchUser", italic 1:1 "async" -->'))
    const start = block(view).pos + 1 + CODE.indexOf('const')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, view.state.doc.content.size - 2)))
    const { dom } = (view as unknown as { serializeForClipboard: (s: unknown) => { dom: HTMLElement } }).serializeForClipboard(view.state.selection.content())
    const back = ProseDOMParser.fromSchema(view.state.schema).parse(dom)
    let pasted: ProseNode | null = null
    back.descendants((n) => {
      if (pasted === null && n.type.name === 'code_block') pasted = n
      return pasted === null
    })
    const node = pasted as unknown as ProseNode
    expect(marksFromSpans(node.textContent, node.attrs.marks ?? []).map((m) => `${m.kind} ${m.text}`)).toEqual(['bold fetchUser'])
  })
})
