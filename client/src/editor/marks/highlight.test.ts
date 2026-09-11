/**
 * Highlight mark (YAZ-1480): real editor (`createCrepe`), Obsidian's `==text==` ↔ `highlight`
 * mark / `<mark>` in the DOM, byte-identical round trips, the `\=` adjacency escape, the four
 * adjacency shapes (text before / after a mark, and content whose own edges are `=`),
 * `Mod-Shift-h` through ProseMirror's `handleKeyDown`, the `==x==` typing rule, and pasted
 * `<mark>` HTML.
 *
 * Modelled on `underline.test.ts` (same mount / posOf / selectText / marksOn / md helpers).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { highlightSchema, selectionHighlightColor, setHighlightCommand, type HighlightColor } from './highlight'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, view: crepe.editor.ctx.get(editorViewCtx) }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const IS_MAC = /Mac/.test(navigator.platform)

function pressModShiftH(crepe: Crepe): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', {
      key: 'h',
      code: 'KeyH',
      shiftKey: true,
      ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
      bubbles: true,
      cancelable: true,
    })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

function posOf(crepe: Crepe, text: string): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    return pos
  })
}

function selectText(crepe: Crepe, text: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const from = posOf(crepe, text)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + text.length)))
  })
}

/** Mark names on the text node containing `text`. */
function marksOn(crepe: Crepe, text: string): string[] {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    const $pos = doc.resolve(posOf(crepe, text) + 1)
    return $pos.marks().map((m) => m.type.name).sort()
  })
}

const md = (crepe: Crepe) => getMarkdownForSave(crepe)
const textOf = (view: EditorView) => view.state.doc.textContent
const markEls = (root: HTMLElement) => [...root.querySelectorAll('.milkdown mark')].map((el) => el.textContent)

/** Put `text` in an empty document as literal characters — no parser, no input rules. */
async function insertLiteral(text: string) {
  const { crepe, root, view } = await mount('\n')
  view.dispatch(view.state.tr.insertText(text, 1))
  return { crepe, root, view }
}

/** Select from the start of `start` to the end of `end` — a range that can span text nodes. */
function selectAcross(crepe: Crepe, start: string, end: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const from = posOf(crepe, start)
    const to = posOf(crepe, end) + end.length
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  })
}

/** Run the mark's one command with a colour, exactly as a swatch press does. */
function setHighlight(crepe: Crepe, color: HighlightColor): boolean {
  return crepe.editor.action((ctx) => ctx.get(commandsCtx).call(setHighlightCommand.key, color))
}

/** The attrs of the `highlight` mark on the text node containing `text` (null when unmarked). */
function colorOn(crepe: Crepe, text: string): HighlightColor | 'none' {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    const mark = doc.resolve(posOf(crepe, text) + 1).marks().find((m) => m.type.name === 'highlight')
    return mark === undefined ? 'none' : ((mark.attrs.color ?? null) as HighlightColor)
  })
}

/** What `selectionHighlightColor` answers for the CURRENT selection. */
function currentColor(crepe: Crepe): HighlightColor | undefined {
  return crepe.editor.action((ctx) => selectionHighlightColor(ctx.get(editorViewCtx).state, highlightSchema.type(ctx)))
}

/** How many `highlight` marks the document carries in total (one per distinct run). */
function highlightRuns(crepe: Crepe): number {
  return crepe.editor.action((ctx) => {
    let count = 0
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'highlight')) count++
      return true
    })
    return count
  })
}

/** Put the caret (empty selection) just inside the text node containing `text`. */
function caretIn(crepe: Crepe, text: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const at = posOf(crepe, text) + 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
  })
}

/** Type `text` one character at a time at the end of the document, the way the browser does. */
function typeAtEnd(view: EditorView, text: string): void {
  let pos = view.state.doc.content.size - 1
  for (const char of text) {
    const handled = view.someProp('handleTextInput', (f) => f(view, pos, pos, char, () => view.state.tr.insertText(char, pos)))
    if (!handled) view.dispatch(view.state.tr.insertText(char, pos))
    pos++
  }
}

describe('highlight mark', () => {
  it('loads `==b==` as a highlight mark, renders <mark>, and saves identical bytes', async () => {
    const { crepe, root } = await mount('a ==b== c\n')
    expect(marksOn(crepe, 'b')).toEqual(['highlight'])
    expect(root.querySelector('.milkdown mark')?.textContent).toBe('b')
    expect(md(crepe)).toBe('a ==b== c\n')
  })

  it('round-trips nested with bold, inside list items and headings', async () => {
    const src = '# Title ==h==\n\n* item with **==x==** and ==two words==\n  * ==child==\n'
    const { crepe, root } = await mount(src)
    expect(marksOn(crepe, 'x')).toEqual(['highlight', 'strong'])
    expect(markEls(root)).toEqual(['h', 'x', 'two words', 'child'])
    expect(md(crepe)).toBe(src)
  })

  it('carries bold INSIDE the highlight', async () => {
    const { crepe } = await mount('==a **b** c==\n')
    expect(marksOn(crepe, 'b')).toEqual(['highlight', 'strong'])
    expect(marksOn(crepe, 'a ')).toEqual(['highlight'])
    expect(md(crepe)).toBe('==a **b** c==\n')
  })

  it('never touches a LONE `=` — every spacing of it is byte-identical', async () => {
    const src = 'a = b, x=5, x =5, x= 5\n'
    const { crepe, root } = await mount(src)
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe(src)
    expect(md(crepe)).not.toContain('\\')
  })

  it('escapes every `=` that touches another `=`, and the escapes read back as the same text', async () => {
    const { crepe, root } = await mount('a == b, a === b, ====, a==b\n')
    expect(markEls(root)).toEqual([])
    // NB the third `=` of the 3-run is not escaped: mdast-util-to-markdown compiles the two
    // `unsafe` rules into CONSUMING regexes, so a run of three yields only two match positions.
    // `\=\==` still reads back as the literal `===` it came from, and is byte-stable.
    expect(md(crepe)).toBe('a \\=\\= b, a \\=\\== b, \\=\\=\\=\\=, a\\=\\=b\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('a == b, a === b, ====, a==b')
    expect(md(again.crepe)).toBe(md(crepe))
  })

  it('escapes a tight run typed as plain text, and the escape reads back as the same text', async () => {
    const { crepe, root, view } = await insertLiteral('x==5 and y==6')
    expect(markEls(root)).toEqual([])
    expect(textOf(view)).toBe('x==5 and y==6')
    expect(md(crepe)).toBe('x\\=\\=5 and y\\=\\=6\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('x==5 and y==6')
  })

  it('the UNESCAPED form of the same string on disk is a highlight — two tight runs pair up', async () => {
    const { crepe, root } = await mount('x==5 and y==6\n')
    expect(markEls(root)).toEqual(['5 and y'])
    expect(md(crepe)).toBe('x==5 and y==6\n')
  })

  it('escapes a spaced pair written as plain text too', async () => {
    const { crepe, root } = await insertLiteral('total == 5 and count == 6')
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe('total \\=\\= 5 and count \\=\\= 6\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('total == 5 and count == 6')
  })

  it('reads a backslash-escaped `\\==` as literal text, and writes it back per character', async () => {
    const { crepe, root, view } = await mount('literal \\==not a mark\\== here\n')
    expect(markEls(root)).toEqual([])
    expect(textOf(view)).toBe('literal ==not a mark== here')
    expect(md(crepe)).toBe('literal \\=\\=not a mark\\=\\= here\n')
    const again = await mount(md(crepe))
    expect(textOf(again.view)).toBe('literal ==not a mark== here')
    expect(md(again.crepe)).toBe(md(crepe))
  })

  it('left adjacency, letter before: text ending in `=` right before a highlight', async () => {
    const { crepe, view } = await mount('ab\n')
    selectText(crepe, 'b')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('a==b==\n')
    view.dispatch(view.state.tr.insertText('=', posOf(crepe, 'b')))
    expect(md(crepe)).toBe('a\\===b==\n')
    const again = await mount(md(crepe))
    expect(marksOn(again.crepe, 'b')).toEqual(['highlight'])
    expect(textOf(again.view)).toBe('a=b')
  })

  it('left adjacency, SPACE before: the `=` still escapes, so the mark survives the reload', async () => {
    const { crepe, view } = await mount('hello world\n')
    selectText(crepe, 'world')
    expect(pressModShiftH(crepe)).toBe(true)
    view.dispatch(view.state.tr.insertText('=', posOf(crepe, 'world')))
    expect(md(crepe)).toBe('hello \\===world==\n')
    const again = await mount(md(crepe))
    expect(marksOn(again.crepe, 'world')).toEqual(['highlight'])
    expect(textOf(again.view)).toBe('hello =world')
  })

  it('right adjacency: text starting with `=` right after a highlight', async () => {
    const { crepe } = await mount('x=more\n')
    selectText(crepe, 'x')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('==x==\\=more\n')
    const again = await mount(md(crepe))
    expect(marksOn(again.crepe, 'x')).toEqual(['highlight'])
    expect(marksOn(again.crepe, '=more')).toEqual([])
    expect(textOf(again.view)).toBe('x=more')
  })

  it('content edges: a highlight whose own text starts and ends with `=`', async () => {
    const { crepe } = await mount('=x=\n')
    selectText(crepe, '=x=')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('==\\=x\\===\n')
    const again = await mount(md(crepe))
    expect(marksOn(again.crepe, '=x=')).toEqual(['highlight'])
    expect(textOf(again.view)).toBe('=x=')
  })

  it('Mod-Shift-h adds the mark on a selection and removes it again', async () => {
    const { crepe, root } = await mount('hello world\n')
    selectText(crepe, 'world')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello ==world==\n')
    expect(marksOn(crepe, 'world')).toEqual(['highlight'])
    expect(markEls(root)).toEqual(['world'])
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello world\n')
    expect(markEls(root)).toEqual([])
  })

  it('typing `==word==` converts as the closing run lands', async () => {
    const { crepe, root, view } = await mount('hello\n')
    view.dispatch(view.state.tr.insertText(' ', view.state.doc.content.size - 1))
    typeAtEnd(view, '==word==')
    expect(textOf(view)).toBe('hello word')
    expect(markEls(root)).toEqual(['word'])
    expect(md(crepe)).toBe('hello ==word==\n')
  })

  it('typing a SPACED pair never converts — `== spaced ==` stays exactly that text', async () => {
    const { crepe, root, view } = await mount('hello\n')
    view.dispatch(view.state.tr.insertText(' ', view.state.doc.content.size - 1))
    typeAtEnd(view, '== spaced ==')
    expect(textOf(view)).toBe('hello == spaced ==')
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe('hello \\=\\= spaced \\=\\=\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('hello == spaced ==')
  })

  it('pasted <mark> HTML becomes the mark and saves as `==…==`', async () => {
    const { crepe, root, view } = await mount('\n')
    const html = '<p>x <mark>y</mark> z</p>'
    view.pasteHTML(html, {
      clipboardData: { getData: (t: string) => (t === 'text/html' ? html : '') },
      preventDefault() {},
    } as unknown as ClipboardEvent)
    expect(marksOn(crepe, 'y')).toEqual(['highlight'])
    expect(markEls(root)).toEqual(['y'])
    expect(md(crepe)).toBe('x ==y== z\n')
  })

  it('`==` under a paragraph is still a setext heading, not a mark', async () => {
    const { crepe, root } = await mount('Title\n==\n')
    expect(root.querySelector('.milkdown .ProseMirror h1')?.textContent).toBe('Title')
    expect(markEls(root)).toEqual([])
    // Rule 6's setext → ATX normalisation.
    expect(md(crepe)).toBe('# Title\n')
  })

  it('an unmatched opener stays text — and is escaped so it keeps reading as text', async () => {
    const { crepe, root } = await mount('open ==never closed\n')
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe('open \\=\\=never closed\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('open ==never closed')
  })

  it('never escapes a `==` inside a URL', async () => {
    const { crepe, root } = await mount('see <https://x.y/?a==b> now\n')
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe('see <https://x.y/?a==b> now\n')
  })
})

describe('coloured highlights (YAZ-1480)', () => {
  it.each([
    ['green'],
    ['blue'],
    ['pink'],
  ])('loads `<mark class="highlight-%s">` as that colour and saves identical bytes', async (color) => {
    const src = `a <mark class="highlight-${color}">g</mark> b\n`
    const { crepe, root } = await mount(src)
    expect(colorOn(crepe, 'g')).toBe(color)
    expect(root.querySelector(`.milkdown mark.highlight-${color}`)?.textContent).toBe('g')
    expect(md(crepe)).toBe(src)
  })

  it('round-trips a colour inside bold, inside a list item and a heading', async () => {
    const src =
      '# Title <mark class="highlight-blue">h</mark>\n\n' +
      '* item with **<mark class="highlight-green">x</mark>** and <mark class="highlight-pink">two words</mark>\n' +
      '  * <mark class="highlight-blue">child</mark>\n'
    const { crepe } = await mount(src)
    expect(marksOn(crepe, 'x')).toEqual(['highlight', 'strong'])
    expect(colorOn(crepe, 'x')).toBe('green')
    expect(colorOn(crepe, 'two words')).toBe('pink')
    expect(colorOn(crepe, 'child')).toBe('blue')
    expect(md(crepe)).toBe(src)
  })

  it('reads a BARE <mark> as yellow and normalises it to `==…==`', async () => {
    const { crepe, root } = await mount('<mark>plain</mark>\n')
    expect(colorOn(crepe, 'plain')).toBe(null)
    expect(markEls(root)).toEqual(['plain'])
    expect(md(crepe)).toBe('==plain==\n')
  })

  it('leaves an unknown <mark class/style> as inline HTML, byte-identical', async () => {
    const src = '<mark class="foo">x</mark> and <mark style="background:red">y</mark>\n'
    const { crepe, root } = await mount(src)
    expect(colorOn(crepe, 'x')).toBe('none')
    expect(colorOn(crepe, 'y')).toBe('none')
    expect(root.querySelectorAll('.milkdown [data-type="html"]').length).toBeGreaterThan(0)
    expect(md(crepe)).toBe(src)
  })

  it('a highlight nested inside a highlight ENDS the outer one — the tail loses the colour', async () => {
    // 🔒 Milkdown's ParserState has ONE mark set: `openMark` of the same type REPLACES the outer
    // mark and `closeMark` removes the type outright, so there is nothing to restore the green to
    // after the inner `==b==` closes. The outer colour therefore survives only up to the nested
    // run. Lossy on the FIRST save, stable from then on. Same for colour-in-colour; a highlight
    // inside a DIFFERENT mark (`<u>`, `**`) is unaffected.
    const { crepe } = await mount('<mark class="highlight-green">a ==b== c</mark>\n')
    expect(colorOn(crepe, 'a ')).toBe('green')
    expect(colorOn(crepe, 'b')).toBe(null)
    expect(colorOn(crepe, ' c')).toBe('none')
    const saved = '<mark class="highlight-green">a</mark> ==b== c\n'
    expect(md(crepe)).toBe(saved)
    // Stable from the first save on.
    const again = await mount(saved)
    expect(md(again.crepe)).toBe(saved)
  })

  it('a highlight inside a DIFFERENT mark round-trips untouched', async () => {
    const src = '<u>a <mark class="highlight-green">b</mark> c</u>\n'
    const { crepe } = await mount(src)
    expect(marksOn(crepe, 'b')).toEqual(['highlight', 'underline'])
    expect(colorOn(crepe, 'b')).toBe('green')
    expect(md(crepe)).toBe(src)
  })

  it('one command, one click: apply, remove, switch, and back to yellow', async () => {
    const { crepe } = await mount('hello world\n')

    selectText(crepe, 'world')
    expect(setHighlight(crepe, 'green')).toBe(true)
    expect(md(crepe)).toBe('hello <mark class="highlight-green">world</mark>\n')

    selectText(crepe, 'world')
    expect(setHighlight(crepe, 'green')).toBe(true)
    expect(md(crepe)).toBe('hello world\n')

    selectText(crepe, 'world')
    setHighlight(crepe, 'green')
    selectText(crepe, 'world')
    setHighlight(crepe, 'blue')
    expect(md(crepe)).toBe('hello <mark class="highlight-blue">world</mark>\n')
    expect(highlightRuns(crepe)).toBe(1)
    expect(colorOn(crepe, 'world')).toBe('blue')

    selectText(crepe, 'world')
    setHighlight(crepe, null)
    expect(md(crepe)).toBe('hello ==world==\n')
  })

  it('selectionHighlightColor answers the one colour, or undefined for mixed / none', async () => {
    const { crepe } = await mount('==yellow== and <mark class="highlight-green">green</mark> and plain\n')

    selectText(crepe, 'yellow')
    expect(currentColor(crepe)).toBe(null)

    selectText(crepe, 'green')
    expect(currentColor(crepe)).toBe('green')

    selectAcross(crepe, 'green', 'plain')
    expect(currentColor(crepe)).toBeUndefined()

    selectText(crepe, 'plain')
    expect(currentColor(crepe)).toBeUndefined()

    caretIn(crepe, 'green')
    expect(currentColor(crepe)).toBe('green')
  })

  it('pasted coloured <mark> HTML keeps its colour', async () => {
    const { crepe, root, view } = await mount('\n')
    const html = '<p>x <mark class="highlight-blue">y</mark> z</p>'
    view.pasteHTML(html, {
      clipboardData: { getData: (t: string) => (t === 'text/html' ? html : '') },
      preventDefault() {},
    } as unknown as ClipboardEvent)
    expect(colorOn(crepe, 'y')).toBe('blue')
    expect(root.querySelector('.milkdown mark.highlight-blue')?.textContent).toBe('y')
    expect(md(crepe)).toBe('x <mark class="highlight-blue">y</mark> z\n')
  })

  it('the HTML form needs no `=` escape: text ending in `=` right before a colour', async () => {
    const { crepe, view } = await mount('ab\n')
    selectText(crepe, 'b')
    setHighlight(crepe, 'green')
    view.dispatch(view.state.tr.insertText('=', posOf(crepe, 'b')))
    expect(md(crepe)).toBe('a=<mark class="highlight-green">b</mark>\n')
    const again = await mount(md(crepe))
    expect(colorOn(again.crepe, 'b')).toBe('green')
    expect(colorOn(again.crepe, 'a=')).toBe('none')
    expect(textOf(again.view)).toBe('a=b')
  })

  it('Mod-Shift-h is always YELLOW: it switches a coloured run, then removes it', async () => {
    const { crepe } = await mount('hello <mark class="highlight-green">world</mark>\n')
    selectText(crepe, 'world')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello ==world==\n')
    expect(colorOn(crepe, 'world')).toBe(null)
    selectText(crepe, 'world')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello world\n')
  })
})
