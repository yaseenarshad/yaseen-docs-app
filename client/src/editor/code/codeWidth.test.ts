/**
 * A code block's own width in the file (YAZ-4783): the `<!-- code: … -->` comment on its own, then real editors
 * (`createCrepe`) that load a note, save it, and load the save again; the box's decoration; one transaction per change
 * and one undo; the line numbers. The drag itself needs a real layout and is checked by hand in the app.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { blockLines } from '../lineNumbers/blockLines'
import { fileLines } from '../lineNumbers/fileLines'
import { showLineNumbers } from '../lineNumbers/lineNumbers'
import { CODE_WIDTH_ATTR, codeBlockCount, codeWidthsToNote, formatCodeComment, parseCodeComment, PLAIN_CODE } from './codeWidth'

afterEach(unmountAll)

/** Load, save; then load the save and save again — the second save must give the same bytes. */
async function save(markdown: string): Promise<string> {
  const { crepe } = await mount(markdown)
  const out = getMarkdownForSave(crepe)
  const again = await mount(out)
  expect(getMarkdownForSave(again.crepe)).toBe(out)
  return out
}

const codeBlocks = (doc: ProseNode): Array<{ node: ProseNode; pos: number }> => {
  const out: Array<{ node: ProseNode; pos: number }> = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') out.push({ node, pos })
  })
  return out
}
const htmlValues = (doc: ProseNode): string[] => {
  const out: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'html') out.push(node.attrs.value)
  })
  return out
}
const box = (view: EditorView): HTMLElement => view.dom.querySelector<HTMLElement>('.milkdown-code-block')!

const CODE = '```js\nconst a = 1\nconst b = 2\n```\n'

describe('the code comment', () => {
  it('reads and writes the width', () => {
    expect(parseCodeComment('<!-- code: width 900 -->')).toEqual({ width: 900, unknownParts: [] })
    expect(formatCodeComment({ width: 900, unknownParts: [] })).toBe('<!-- code: width 900 -->')
    expect(formatCodeComment(PLAIN_CODE)).toBeNull()
  })

  it('keeps the parts it does not read, each on its side of the width', () => {
    const comment = '<!-- code: wrap, width 1300, theme dark -->'
    const look = parseCodeComment(comment)!
    expect(look).toEqual({ width: 1300, unknownParts: [{ afterWidth: false, text: 'wrap' }, { afterWidth: true, text: 'theme dark' }] })
    expect(formatCodeComment(look)).toBe(comment)
    expect(formatCodeComment({ ...look, width: null })).toBe('<!-- code: wrap, theme dark -->')
  })

  it('keeps a width it cannot read as text, until it writes a width itself', () => {
    const look = parseCodeComment('<!-- code: width 100 -->')!
    expect(look).toEqual({ width: null, unknownParts: [{ afterWidth: false, text: 'width 100' }] })
    expect(formatCodeComment(look)).toBe('<!-- code: width 100 -->')
    expect(formatCodeComment({ ...look, width: 500 })).toBe('<!-- code: width 500 -->')
  })

  it.each(['<!-- code: -->', '<!-- code -->', '<!-- codes: width 900 -->', '<!-- code: width 900,, x -->', '<!-- code:\nwidth 900 -->', '<!-- note -->'])(
    '%j is not ours',
    (comment) => expect(parseCodeComment(comment)).toBeNull(),
  )
})

describe('the code block in the file', () => {
  it('a code block with a width loads into the attribute and saves the same bytes, the comment under the fence', async () => {
    const note = `${CODE}<!-- code: width 900 -->\n\nAfter\n`
    const { view } = await mount(note)
    const [{ node }] = codeBlocks(view.state.doc)
    expect(node.attrs).toMatchObject({ language: 'js', width: 900, unknownParts: null })
    expect(node.textContent).toBe('const a = 1\nconst b = 2')
    expect(htmlValues(view.state.doc)).toEqual([])
    expect(await save(note)).toBe(note)
  })

  it('a code block with no width saves with no comment, the bytes of before', async () => {
    expect(await save(CODE)).toBe(CODE)
    expect(await save(`x\n\n${CODE}\ny\n`)).toBe(`x\n\n${CODE}\ny\n`)
  })

  it('unknown words survive, in their places', async () => {
    const note = `${CODE}<!-- code: wrap, width 900, theme dark -->\n`
    const { view } = await mount(note)
    expect(codeBlocks(view.state.doc)[0].node.attrs.width).toBe(900)
    expect(await save(note)).toBe(note)
  })

  it('a code block in a tight bullet keeps its comment inside the bullet, indented, and the next bullet stays a sibling', async () => {
    const note = '* item\n  ```\n  x\n  ```\n  <!-- code: width 900 -->\n* next\n'
    const { view } = await mount(note)
    const list = view.state.doc.child(0)
    expect(list.childCount).toBe(2)
    expect(list.child(0).child(1).attrs.width).toBe(900)
    expect(htmlValues(view.state.doc)).toEqual([])
    expect(await save(note)).toBe(note)
  })

  it('a comment after a blank line is read too, and saves on the line under the fence', async () => {
    const { view, crepe } = await mount(`${CODE}\n<!-- code: width 900 -->\n`)
    expect(codeBlocks(view.state.doc)[0].node.attrs.width).toBe(900)
    expect(getMarkdownForSave(crepe)).toBe(`${CODE}<!-- code: width 900 -->\n`)
  })

  it.each(['<!-- code: -->', '<!-- codes: width 900 -->', '<!-- note -->'])('a comment that is not ours, %s, stays an HTML block with its text', async (comment) => {
    const note = `${CODE}\n${comment}\n`
    const { view } = await mount(note)
    expect(codeBlocks(view.state.doc)[0].node.attrs.width).toBeNull()
    expect(htmlValues(view.state.doc)).toEqual([comment])
    expect(await save(note)).toBe(note)
  })

  it('a comment that is not right after a code block stays a normal comment', async () => {
    const note = `${CODE}\ntext\n\n<!-- code: width 900 -->\n`
    const { view } = await mount(note)
    expect(codeBlocks(view.state.doc)[0].node.attrs.width).toBeNull()
    expect(htmlValues(view.state.doc)).toEqual(['<!-- code: width 900 -->'])
    expect(await save(note)).toBe(note)
  })
})

describe('the width on the page', () => {
  it('the box carries the width from the attribute, and a plain box carries none', async () => {
    const { view } = await mount(`${CODE}<!-- code: width 900 -->\n\n${CODE}`)
    const [sized, plain] = [...view.dom.querySelectorAll<HTMLElement>('.milkdown-code-block')]
    expect(sized.getAttribute(CODE_WIDTH_ATTR)).toBe('900')
    expect(sized.style.getPropertyValue('--code-width')).toBe('900px')
    expect(plain.hasAttribute(CODE_WIDTH_ATTR)).toBe(false)
  })

  it('a width set by one transaction is one undo step, and the text, the language and the box follow', async () => {
    const { view, crepe } = await mount(CODE)
    const { pos } = codeBlocks(view.state.doc)[0]
    view.dispatch(view.state.tr.setNodeAttribute(pos, 'width', 1300))
    expect(box(view).getAttribute(CODE_WIDTH_ATTR)).toBe('1300')
    expect(getMarkdownForSave(crepe)).toBe(`${CODE}<!-- code: width 1300 -->\n`)
    undo(view.state, view.dispatch)
    expect(box(view).hasAttribute(CODE_WIDTH_ATTR)).toBe(false)
    expect(getMarkdownForSave(crepe)).toBe(CODE)
  })

  it('typing in the code keeps the width; removing it writes no comment', async () => {
    const { view, crepe } = await mount(`${CODE}<!-- code: width 900 -->\n`)
    const { pos } = codeBlocks(view.state.doc)[0]
    view.dispatch(view.state.tr.insertText('x', pos + 1))
    expect(box(view).getAttribute(CODE_WIDTH_ATTR)).toBe('900')
    expect(getMarkdownForSave(crepe)).toBe('```js\nxconst a = 1\nconst b = 2\n```\n<!-- code: width 900 -->\n')
    view.dispatch(view.state.tr.setNodeAttribute(pos, 'width', null))
    expect(box(view).hasAttribute(CODE_WIDTH_ATTR)).toBe(false)
    expect(getMarkdownForSave(crepe)).toBe('```js\nxconst a = 1\nconst b = 2\n```\n')
  })
})

describe('"Use 900 px for all code blocks in this note" (YAZ-4783 layer 2)', () => {
  const NESTED = '* item\n\n  ```py\n  x = 1\n  ```\n  <!-- code: wrap, width 700 -->\n'

  it('ONE transaction takes every block\'s own width away, its other parts and its code kept; one undo puts them all back', async () => {
    const note = `${CODE}<!-- code: width 900 -->\n\n${CODE}\n${CODE}<!-- code: width 1300 -->\n\n${NESTED}`
    const { view, crepe } = await mount(note)
    const before = getMarkdownForSave(crepe)
    expect(codeBlockCount(view.state.doc)).toBe(4)
    const tr = codeWidthsToNote(view.state)!
    view.dispatch(tr)
    expect(codeBlocks(view.state.doc).map(({ node }) => node.attrs.width)).toEqual([null, null, null, null])
    expect([...view.dom.querySelectorAll('.milkdown-code-block')].some((el) => el.hasAttribute(CODE_WIDTH_ATTR))).toBe(false)
    const after = getMarkdownForSave(crepe)
    expect(after).not.toContain('width')
    expect(after).toContain('<!-- code: wrap -->')
    expect(after).toContain('x = 1')
    undo(view.state, view.dispatch)
    expect(codeBlocks(view.state.doc).map(({ node }) => node.attrs.width)).toEqual([900, null, 1300, 700])
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('a note whose blocks have no width of their own gets no transaction', async () => {
    const { view } = await mount(`${CODE}\n${CODE}`)
    expect(codeBlockCount(view.state.doc)).toBe(2)
    expect(codeWidthsToNote(view.state)).toBeNull()
  })
})

describe('line numbers', () => {
  it('the comment is no block: the code block ends on it, and the next block keeps its line', () => {
    const { lines, ends, kinds } = blockLines(`${CODE}<!-- code: width 900 -->\nafter`)
    expect({ lines, ends, kinds }).toEqual({ lines: [1, 6], ends: [5, 6], kinds: 'cp' })
    expect(blockLines('* a\n  ```\n  x\n  ```\n  <!-- code: width 900 -->\n* b')).toMatchObject({ lines: [1, 2, 6], kinds: 'pcp' })
    expect(blockLines(`${CODE}<!-- code: -->\nafter`).kinds).toBe('cpp')
  })

  it('the code block still counts its code lines in lines of the file', async () => {
    const note = `Intro\n\n${CODE}<!-- code: width 900 -->\n\nAfter\n`
    const { crepe, view } = await mount(note)
    const { text, toFileLine } = fileLines('', note)
    const { lines, ends, kinds } = blockLines(text)
    showLineNumbers(crepe, { lines: lines.map(toFileLine), ends: ends.map(toFileLine), kinds })
    const code = box(view)
    expect([code.dataset.line, code.dataset.lineEnd, code.getAttribute('data-line-code')]).toEqual(['3', '7', '4'])
    expect(view.dom.querySelectorAll('[data-line]')[2].textContent).toBe('After')
  })
})
