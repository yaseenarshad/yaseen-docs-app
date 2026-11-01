/**
 * A plain line whose whole text is a block marker saves escaped (YAZ-3727 B5, `textStringify.ts`). Milkdown's own text
 * handler wrote such a line raw (`1. `, `# `), so it reloaded as an empty numbered line, a heading, a quote or a bullet.
 * Trailing spaces still save as spaces, never `&#x20;`, as Milkdown intended.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from './createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<Crepe> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return crepe
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The note's one paragraph, its text replaced by `text` (what typing leaves behind). */
async function paragraphOf(text: string): Promise<Crepe> {
  const crepe = await mount('x\n')
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dispatch(view.state.tr.insertText(text, 1, 2))
  return crepe
}

const blocks = (crepe: Crepe): string[] => {
  const out: string[] = []
  crepe.editor.ctx.get(editorViewCtx).state.doc.forEach((node) => { out.push(`${node.type.name} ${JSON.stringify(node.textContent)}`) })
  return out
}

describe('a line that is only a marker saves escaped (YAZ-3727 B5)', () => {
  it.each([
    ['1. ', '1\\. \n'],
    ['# ', '\\# \n'],
    ['> ', '\\> \n'],
    ['- ', '\\- \n'],
    ['+ ', '\\+ \n'],
    ['12. ', '12\\. \n'],
    ['1) ', '1\\) \n'],
    ['--- ', '\\--- \n'],
  ])('plain %j saves as %j and reloads as the same plain line', async (text, saved) => {
    const crepe = await paragraphOf(text)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    const reloaded = await mount(saved)
    // CommonMark drops a paragraph's trailing space on load; the line stays a paragraph with its marker as text.
    expect(blocks(reloaded)).toEqual([`paragraph ${JSON.stringify(text.trimEnd())}`])
  })

  it('a marker before formatting saves escaped too: "1. " then bold', async () => {
    const crepe = await mount('x\n')
    const view = crepe.editor.ctx.get(editorViewCtx)
    const { schema } = view.state
    view.dispatch(view.state.tr.replaceWith(1, 2, [schema.text('1. '), schema.text('Plan', [schema.marks.strong.create()])]))
    expect(getMarkdownForSave(crepe)).toBe('1\\. **Plan**\n')
  })

  it('"1. Plan" keeps its escape', async () => {
    expect(getMarkdownForSave(await paragraphOf('1. Plan'))).toBe('1\\. Plan\n')
  })

  it.each([
    ['hello  ', 'hello  \n'],
    ['a ', 'a \n'],
    ['end\t', 'end\t\n'],
    ['x ', 'x \n'],
  ])('trailing whitespace stays as typed, never an entity: %j', async (text, saved) => {
    expect(getMarkdownForSave(await paragraphOf(text))).toBe(saved)
  })

  // Each expected string is what Milkdown's own handler wrote before this change.
  it.each([
    ['* x\n', 'item ', '* item \n'],
    ['# x\n', 'Head ', '# Head \n'],
    ['x\n', '  ', '  \n'],
    ['x\n', 'a * b ', 'a \\* b&#x20;\n'],
  ])('text with no marker keeps Milkdown\'s bytes: %j + %j', async (markdown, text, saved) => {
    const crepe = await mount(markdown)
    const view = crepe.editor.ctx.get(editorViewCtx)
    let at = -1
    view.state.doc.descendants((node, pos) => { if (at < 0 && node.isText) at = pos; return at < 0 })
    view.dispatch(view.state.tr.insertText(text, at, at + 1))
    expect(getMarkdownForSave(crepe)).toBe(saved)
  })

  it('a space before formatting stays a plain space: "word " then bold', async () => {
    const crepe = await mount('x\n')
    const view = crepe.editor.ctx.get(editorViewCtx)
    const { schema } = view.state
    view.dispatch(view.state.tr.replaceWith(1, 2, [schema.text('word '), schema.text('bold', [schema.marks.strong.create()])]))
    expect(getMarkdownForSave(crepe)).toBe('word **bold**\n')
  })
})
