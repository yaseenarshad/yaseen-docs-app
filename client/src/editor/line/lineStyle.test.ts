/**
 * The line's style in the file (YAZ-3164, YAZ-3167; CONTRACTS rule 41): real editors (`createCrepe`)
 * load a note, save it, and load the save again. Pinned here, by scenario key: the plain line
 * (S1), only the parts that are not the default and in the fixed order (S2, S3), defaults never
 * written and a hand-written default read as the plain line (S4), every comment that is not ours
 * kept byte for byte (S5–S7), the comment in a bullet with and without children and in a quote
 * (S8–S10), a styled line first and last (S11), two lines in a row (S12), a setext heading (S13),
 * code (S14) and the second save (S17). `parseDOM` / `toDOM` carry the style through a copy (S26).
 * The line pattern (YAZ-3198, 🔒 D7): solid never written (S70), `style dotted` / `style dashed` in
 * the order darkness, thickness, style, length (S71), another style word not ours (S72), a copy (S77).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { DOMParser, DOMSerializer, type Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { splitFrontmatter } from '@shared/frontmatter'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { formatLineComment, parseLineComment, PLAIN_LINE, type LineStyle } from './lineStyle'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, view }
}

afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) {
    await crepe.destroy()
    root.remove()
  }
})

/** Load, save; then load the save and save again — the second save must give the same bytes (S17). */
async function save(markdown: string): Promise<string> {
  const { crepe } = await mount(markdown)
  const out = getMarkdownForSave(crepe)
  const again = await mount(out)
  expect(getMarkdownForSave(again.crepe)).toBe(out)
  return out
}

/** Every `hr` of a document with its style, in order. */
const lines = (doc: ProseNode): LineStyle[] => {
  const out: LineStyle[] = []
  doc.descendants((node) => {
    if (node.type.name === 'hr') out.push({ darkness: node.attrs.darkness, thickness: node.attrs.thickness, pattern: node.attrs.pattern, width: node.attrs.width })
  })
  return out
}

/** Every `html` node's value, in order. */
const htmlValues = (doc: ProseNode): string[] => {
  const out: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'html') out.push(node.attrs.value)
  })
  return out
}

/** The note saved after a style is set on its first line by one transaction. */
async function saveStyled(attrs: Partial<Record<keyof LineStyle, unknown>>, markdown = 'a\n\n***\n\nb\n'): Promise<string> {
  const { crepe, view } = await mount(markdown)
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === 'hr') pos = p
  })
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...PLAIN_LINE, ...attrs }))
  return getMarkdownForSave(crepe)
}

describe('parseLineComment / formatLineComment', () => {
  it('reads the exact form, with only the parts it holds', () => {
    expect(parseLineComment('<!-- line: darkness 80%, thickness 6px, length 40% -->')).toEqual({ darkness: 80, thickness: 6, pattern: null, width: 40 })
    expect(parseLineComment('<!-- line: thickness 6px -->')).toEqual({ darkness: null, thickness: 6, pattern: null, width: null })
    expect(parseLineComment('<!--line:length 99%-->')).toEqual({ darkness: null, thickness: null, pattern: null, width: 99 })
  })

  it('writes the parts that are not the default, in the fixed order', () => {
    expect(formatLineComment({ width: 40, pattern: null, thickness: 6, darkness: 80 })).toBe('<!-- line: darkness 80%, thickness 6px, length 40% -->')
    expect(formatLineComment({ darkness: 50, thickness: 3, pattern: null, width: 100 })).toBeNull()
    expect(formatLineComment(PLAIN_LINE)).toBeNull()
  })

  it('S4: a comment that holds only defaults is ours and reads as the plain line', () => {
    expect(parseLineComment('<!-- line: darkness 50% -->')).toEqual(PLAIN_LINE)
    expect(parseLineComment('<!-- line: darkness 50%, thickness 3px -->')).toEqual(PLAIN_LINE)
  })

  it.each([
    ['darkness 4%'],
    ['darkness 101%'],
    ['thickness 0px'],
    ['thickness 25px'],
    ['length 9%'],
    ['length 100%'],
  ])('S5: %s is out of range, so it is not the line comment', (part) => {
    expect(parseLineComment(`<!-- line: ${part} -->`)).toBeNull()
  })

  it.each([
    ['<!-- line: -->'],
    ['<!-- lines: darkness 80% -->'],
    ['<!-- line: dark 50% -->'],
    ['<!-- line: darkness 80%, color red -->'],
    ['<!-- line: thickness 6px, darkness 80% -->'],
    ['<!-- line: darkness 80%, darkness 60% -->'],
    ['<!-- line: darkness 80 -->'],
    ['<!-- line: darkness 50px -->'],
    ['<!-- line: darkness 5.5% -->'],
    ['<!-- line: darkness 050% -->'],
    ['<!-- line: darkness 80%, -->'],
    ['<!-- line: darkness 80% thickness 6px -->'],
    ['<!-- a note -->'],
  ])('S6: %s is another form, so it is not the line comment', (comment) => {
    expect(parseLineComment(comment)).toBeNull()
  })
})

describe('the line in the file', () => {
  it.each([['---'], ['***'], ['___']])('S1: a plain %s saves as *** with no comment', async (rule) => {
    expect(await save(`a\n\n${rule}\n\nb\n`)).toBe('a\n\n***\n\nb\n')
  })

  it.each([
    [{ darkness: 80 }, '<!-- line: darkness 80% -->'],
    [{ thickness: 6 }, '<!-- line: thickness 6px -->'],
    [{ width: 40 }, '<!-- line: length 40% -->'],
  ])('S2: only %o writes only that part', async (attrs, comment) => {
    expect(await saveStyled(attrs)).toBe(`a\n\n***\n\n${comment}\n\nb\n`)
    expect(await save(`a\n\n***\n${comment}\n\nb\n`)).toBe(`a\n\n***\n\n${comment}\n\nb\n`)
  })

  it('S3: all parts are written as darkness, thickness, length', async () => {
    const out = await saveStyled({ width: 40, thickness: 6, darkness: 80 })
    expect(out).toBe('a\n\n***\n\n<!-- line: darkness 80%, thickness 6px, length 40% -->\n\nb\n')
    expect(await save(out)).toBe(out)
    const { view } = await mount(out)
    expect(lines(view.state.doc)).toEqual([{ darkness: 80, thickness: 6, pattern: null, width: 40 }])
    expect(htmlValues(view.state.doc)).toEqual([])
  })

  it('S4: default values are never written, and a hand-written default reads as the plain line', async () => {
    expect(await saveStyled({ darkness: 50, thickness: 3, pattern: null, width: 100 })).toBe('a\n\n***\n\nb\n')
    const { view } = await mount('a\n\n***\n<!-- line: darkness 50% -->\n\nb\n')
    expect(lines(view.state.doc)).toEqual([PLAIN_LINE])
    expect(htmlValues(view.state.doc)).toEqual([])
    expect(await save('a\n\n***\n<!-- line: darkness 50% -->\n\nb\n')).toBe('a\n\n***\n\nb\n')
    expect(await save('***\n<!-- line: darkness 50%, thickness 6px -->\n')).toBe('***\n\n<!-- line: thickness 6px -->\n')
  })

  it('S4: darkness 10% and thickness 1px are no defaults any more, so they are written', async () => {
    const out = await saveStyled({ darkness: 10, thickness: 1 })
    expect(out).toBe('a\n\n***\n\n<!-- line: darkness 10%, thickness 1px -->\n\nb\n')
    const { view } = await mount(out)
    expect(lines(view.state.doc)).toEqual([{ darkness: 10, thickness: 1, pattern: null, width: null }])
  })

  it('S4: a hand-written darkness 50%, thickness 3px is the plain line and saves as ***', async () => {
    const note = 'a\n\n***\n<!-- line: darkness 50%, thickness 3px -->\n\nb\n'
    const { view } = await mount(note)
    expect(lines(view.state.doc)).toEqual([PLAIN_LINE])
    expect(htmlValues(view.state.doc)).toEqual([])
    expect(await save(note)).toBe('a\n\n***\n\nb\n')
  })

  it.each([
    ['<!-- line: darkness 4% -->'],
    ['<!-- line: thickness 25px -->'],
    ['<!-- line: length 100% -->'],
    ['<!-- line: thickness 6px, darkness 80% -->'],
    ['<!-- line: darkness 80%, color red -->'],
    ['<!-- line: dark 50% -->'],
  ])('S5, S6: %s stays HTML, bytes untouched, and the line stays plain', async (comment) => {
    const { view } = await mount(`a\n\n***\n${comment}\n\nb\n`)
    expect(lines(view.state.doc)).toEqual([PLAIN_LINE])
    expect(htmlValues(view.state.doc)).toEqual([comment])
    expect(await save(`a\n\n***\n${comment}\n\nb\n`)).toBe(`a\n\n***\n\n${comment}\n\nb\n`)
  })

  it('S7: a comment with a block between it and the line, or before a line, stays HTML', async () => {
    const after = 'a\n\n***\n\ntext\n\n<!-- line: darkness 80% -->\n'
    const before = '<!-- line: darkness 80% -->\n\n***\n\nb\n'
    for (const note of [after, before]) {
      const { view } = await mount(note)
      expect(lines(view.state.doc)).toEqual([PLAIN_LINE])
      expect(htmlValues(view.state.doc)).toEqual(['<!-- line: darkness 80% -->'])
      expect(await save(note)).toBe(note)
    }
  })

  it('S8: in a tight bullet with children, the comment is indented in the item and the children stay children', async () => {
    // The item holding a line takes `-`: `* ***` would itself be a line (rule 6).
    const note = '* a\n* ---\n  <!-- line: length 40% -->\n  * child\n* c\n'
    const { view } = await mount(note)
    const item = view.state.doc.child(0).child(1)
    expect(item.type.name).toBe('list_item')
    expect(item.childCount).toBe(2)
    expect(item.child(0).type.name).toBe('hr')
    expect(item.child(0).attrs.width).toBe(40)
    expect(item.child(1).type.name).toBe('bullet_list')
    expect(item.child(1).textContent).toBe('child')
    expect(htmlValues(view.state.doc)).toEqual([])
    const out = await save(note)
    expect(out).toContain('***\n  <!-- line: length 40% -->\n  * child\n')
    const again = await mount(out)
    expect(again.view.state.doc.child(0).child(1).child(1).textContent).toBe('child')
  })

  it('S9: in a bullet without children, the bullets after it stay siblings', async () => {
    const out = await save('* ---\n  <!-- line: darkness 80% -->\n* b\n* c\n')
    const { view } = await mount(out)
    const list = view.state.doc.child(0)
    expect(list.childCount).toBe(3)
    expect(list.child(0).child(0).attrs.darkness).toBe(80)
    expect([list.child(1).textContent, list.child(2).textContent]).toEqual(['b', 'c'])
    expect(htmlValues(view.state.doc)).toEqual([])
  })

  it('S10: a line in a blockquote keeps its comment in the blockquote', async () => {
    const out = await save('> ***\n> <!-- line: thickness 12px -->\n')
    expect(out).toBe('> ***\n>\n> <!-- line: thickness 12px -->\n')
    const { view } = await mount(out)
    const quote = view.state.doc.child(0)
    expect(quote.type.name).toBe('blockquote')
    expect(quote.childCount).toBe(1)
    expect(quote.child(0).attrs.thickness).toBe(12)
  })

  it('S11: a styled line first or last in the note saves and loads the same, and a first *** is no frontmatter', async () => {
    const first = await save('***\n<!-- line: darkness 80% -->\n\ntext\n')
    expect(first).toBe('***\n\n<!-- line: darkness 80% -->\n\ntext\n')
    expect(splitFrontmatter(first).frontmatter).toBe('')
    const last = await save('text\n\n***\n<!-- line: darkness 80% -->\n')
    expect(last).toBe('text\n\n***\n\n<!-- line: darkness 80% -->\n')
    const only = await save('***\n<!-- line: darkness 80%, length 40% -->\n')
    expect(only).toBe('***\n\n<!-- line: darkness 80%, length 40% -->\n')
    const { view } = await mount(only)
    expect(lines(view.state.doc)).toEqual([{ darkness: 80, thickness: null, pattern: null, width: 40 }])
  })

  it('S12: two lines in a row each keep their own style', async () => {
    const out = await save('***\n<!-- line: darkness 80% -->\n\n***\n\n***\n<!-- line: length 20% -->\n')
    expect(out).toBe('***\n\n<!-- line: darkness 80% -->\n\n***\n\n***\n\n<!-- line: length 20% -->\n')
    const { view } = await mount(out)
    expect(lines(view.state.doc)).toEqual([
      { darkness: 80, thickness: null, pattern: null, width: null },
      PLAIN_LINE,
      { darkness: null, thickness: null, pattern: null, width: 20 },
    ])
  })

  it('S13: text with --- under it is still a heading, not a line', async () => {
    const { view } = await mount('Text\n---\n\n<!-- line: darkness 80% -->\n')
    expect(view.state.doc.child(0).type.name).toBe('heading')
    expect(lines(view.state.doc)).toEqual([])
    expect(htmlValues(view.state.doc)).toEqual(['<!-- line: darkness 80% -->'])
  })

  it('S14: *** and the comment inside code are text', async () => {
    const note = '```\n***\n<!-- line: darkness 80% -->\n```\n\nSee `***` and `<!-- line: darkness 80% -->` here.\n'
    const { view } = await mount(note)
    expect(lines(view.state.doc)).toEqual([])
    expect(htmlValues(view.state.doc)).toEqual([])
    expect(await save(note)).toBe(note)
  })
})

describe('parseDOM / toDOM (S26)', () => {
  it('writes the custom properties of the parts that are set, and reads them back', async () => {
    const { view } = await mount('***\n<!-- line: darkness 80%, thickness 6px, length 40% -->\n')
    const { schema } = view.state
    const hr = view.state.doc.child(0)
    const dom = DOMSerializer.fromSchema(schema).serializeNode(hr) as HTMLElement
    expect(dom.tagName).toBe('HR')
    expect(dom.getAttribute('style')).toMatch(/^--line-darkness: 80%; --line-thickness: 6px; --line-width: 40%;?$/)
    const holder = document.createElement('div')
    holder.innerHTML = '<hr style="--line-thickness: 12px"><hr><hr style="--line-darkness: 4%; --line-width: 100%">'
    const parsed = DOMParser.fromSchema(schema).parse(holder)
    expect(lines(parsed)).toEqual([{ darkness: null, thickness: 12, pattern: null, width: null }, PLAIN_LINE, PLAIN_LINE])
  })

  it('a plain line has no style attribute', async () => {
    const { view } = await mount('***\n')
    const dom = DOMSerializer.fromSchema(view.state.schema).serializeNode(view.state.doc.child(0)) as HTMLElement
    expect(dom.hasAttribute('style')).toBe(false)
  })
})

describe('the line pattern (YAZ-3198, D7)', () => {
  it('S70: solid is the default and is never written; a hand-written style solid reads as the plain line', async () => {
    expect(formatLineComment({ ...PLAIN_LINE, pattern: null })).toBeNull()
    expect(parseLineComment('<!-- line: style solid -->')).toEqual(PLAIN_LINE)
    expect(await save('***\n<!-- line: style solid -->\n')).toBe('***\n')
    expect(await save('***\n<!-- line: darkness 80%, style solid -->\n')).toBe('***\n\n<!-- line: darkness 80% -->\n')
  })

  it.each([['dotted'], ['dashed']])('S71: style %s saves and loads', async (pattern) => {
    expect(await saveStyled({ pattern })).toBe(`a\n\n***\n\n<!-- line: style ${pattern} -->\n\nb\n`)
    const { view } = await mount(`***\n<!-- line: style ${pattern} -->\n`)
    expect(lines(view.state.doc)).toEqual([{ ...PLAIN_LINE, pattern }])
  })

  it('S71: the order is darkness, thickness, style, length', async () => {
    const out = await saveStyled({ width: 40, pattern: 'dashed', thickness: 6, darkness: 80 })
    expect(out).toBe('a\n\n***\n\n<!-- line: darkness 80%, thickness 6px, style dashed, length 40% -->\n\nb\n')
    expect(await save(out)).toBe(out)
    expect(parseLineComment('<!-- line: darkness 80%, thickness 6px, style dashed, length 40% -->')).toEqual({ darkness: 80, thickness: 6, pattern: 'dashed', width: 40 })
  })

  it.each([
    ['<!-- line: style wavy -->'],
    ['<!-- line: style -->'],
    ['<!-- line: style dashed dotted -->'],
    ['<!-- line: style Dashed -->'],
    ['<!-- line: style dashed, thickness 6px -->'],
    ['<!-- line: length 40%, style dashed -->'],
    ['<!-- line: style dashed, style dotted -->'],
  ])('S72: %s is not the line comment; it stays HTML, bytes untouched', async (comment) => {
    expect(parseLineComment(comment)).toBeNull()
    const { view } = await mount(`a\n\n***\n${comment}\n\nb\n`)
    expect(lines(view.state.doc)).toEqual([PLAIN_LINE])
    expect(htmlValues(view.state.doc)).toEqual([comment])
    expect(await save(`a\n\n***\n${comment}\n\nb\n`)).toBe(`a\n\n***\n\n${comment}\n\nb\n`)
  })

  it('an unknown pattern value on the node (a paste, a transaction) is drawn and saved as solid', async () => {
    expect(await saveStyled({ pattern: 'wavy' })).toBe('a\n\n***\n\nb\n')
  })

  it('S77: toDOM writes data-line-pattern and parseDOM reads it back, so a copied line pastes with its pattern', async () => {
    const { view } = await mount('***\n<!-- line: thickness 6px, style dotted -->\n')
    const { schema } = view.state
    const dom = DOMSerializer.fromSchema(schema).serializeNode(view.state.doc.child(0)) as HTMLElement
    expect(dom.getAttribute('data-line-pattern')).toBe('dotted')
    const holder = document.createElement('div')
    holder.innerHTML = '<hr data-line-pattern="dashed" style="--line-thickness: 6px"><hr data-line-pattern="wavy"><hr>'
    expect(lines(DOMParser.fromSchema(schema).parse(holder))).toEqual([
      { darkness: null, thickness: 6, pattern: 'dashed', width: null },
      PLAIN_LINE,
      PLAIN_LINE,
    ])
    const plain = DOMSerializer.fromSchema(schema).serializeNode(schema.nodes.hr.create()) as HTMLElement
    expect(plain.hasAttribute('data-line-pattern')).toBe(false)
  })
})
