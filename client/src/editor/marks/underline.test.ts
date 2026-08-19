/**
 * Underline mark (GRO-2028): real editor (`createCrepe`), `<u>…</u>` inline HTML ↔ `underline`
 * mark, byte-identical round trip, `Mod-u` through ProseMirror's `handleKeyDown`, and a
 * regression guard that other inline HTML keeps passing through untouched.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const IS_MAC = /Mac/.test(navigator.platform)

function pressModU(crepe: Crepe): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', {
      key: 'u',
      code: 'KeyU',
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

describe('underline mark', () => {
  it('loads `<u>b</u>` as an underline mark, renders <u>, and saves identical bytes', async () => {
    const { crepe, root } = await mount('a <u>b</u> c\n')
    expect(marksOn(crepe, 'b')).toEqual(['underline'])
    expect(root.querySelector('.milkdown u')?.textContent).toBe('b')
    expect(root.querySelector('.milkdown [data-type="html"]')).toBeNull()
    expect(md(crepe)).toBe('a <u>b</u> c\n')
  })

  it('round-trips nested with bold, inside list items and headings', async () => {
    const src = '# Title <u>u</u>\n\n* item with **<u>x</u>** and <u>two words</u>\n  * <u>child</u>\n'
    const { crepe } = await mount(src)
    expect(marksOn(crepe, 'x')).toEqual(['strong', 'underline'])
    expect(md(crepe)).toBe(src)
  })

  it('leaves other inline HTML and unmatched tags untouched', async () => {
    const src = 'a <span>b</span> c<sup>2</sup> d <u>inner <em>e</em> f</u> g\n\nlone <u>tag\n\nstray </u> here\n'
    const { crepe, root } = await mount(src)
    expect(md(crepe)).toBe(src)
    expect(root.querySelectorAll('.milkdown [data-type="html"]').length).toBeGreaterThan(0)
    expect(marksOn(crepe, 'inner')).toEqual(['underline'])
    expect(marksOn(crepe, 'tag')).toEqual([])
    expect(marksOn(crepe, 'here')).toEqual([])
  })

  it('merges a directly nested <u> into one mark', async () => {
    const { crepe } = await mount('<u>a <u>b</u> c</u>\n')
    expect(marksOn(crepe, 'c')).toEqual(['underline'])
    expect(md(crepe)).toBe('<u>a b c</u>\n')
  })

  it('Mod-u adds the mark on a selection and removes it again', async () => {
    const { crepe } = await mount('hello world\n')
    selectText(crepe, 'world')
    expect(pressModU(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello <u>world</u>\n')
    expect(marksOn(crepe, 'world')).toEqual(['underline'])
    expect(pressModU(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello world\n')
  })
})
