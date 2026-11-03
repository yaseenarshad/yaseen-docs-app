/**
 * Arrows while typing (YAZ-4273, `typingArrows.ts`): each arrow of the agreed table, the chains for the left and two-way
 * ones, Backspace right after, never in code or an open `<!--`, the setting off, and paste.
 */
import { editorViewCtx } from '@milkdown/kit/core'
import { Slice } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { setTypingArrows } from './typingArrows'

const mounted: Array<{ crepe: ReturnType<typeof createCrepe>; root: HTMLElement }> = []

/** Mounts `markdown` with the caret at the end of its first textblock. */
async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  let end = -1
  view.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isTextblock) end = pos + node.nodeSize - 1
    return end < 0
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
  return { crepe, view }
}

afterEach(async () => {
  setTypingArrows(true)
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Types at the caret the way the browser does: one `handleTextInput` per character, else plain insertion. */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

function backspace(view: EditorView): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

const saved = (crepe: ReturnType<typeof createCrepe>) => getMarkdownForSave(crepe).trim()

describe('typing an arrow makes one arrow character (YAZ-4273 D6, C15)', () => {
  it.each([
    ['->', '→'],
    ['-->', '→'],
    ['==>', '⇒'],
    ['<-', '←'],
    ['<--', '←'],
    ['<->', '↔'],
    ['<-->', '↔'],
    ['<==', '⇐'],
    ['<==>', '⇔'],
  ])('%s gives %s, at its last key (D7)', async (typed, arrow) => {
    const { crepe, view } = await mount('plan\n')
    type(view, ` ${typed} b`)
    expect(saved(crepe)).toBe(`plan ${arrow} b`)
  })

  it('the text around stays: `<=` alone, `=>`, and a single `-` or `=` are text', async () => {
    const { crepe, view } = await mount('a\n')
    type(view, ' <= b => c - d = e')
    expect(saved(crepe)).toBe('a <= b => c - d = e')
  })

  it('in a bullet and in a table cell too', async () => {
    const bullet = await mount('- step\n')
    type(bullet.view, ' -> next')
    expect(saved(bullet.crepe)).toBe('* step → next')
    const table = await mount('| a |\n| --- |\n| x |\n')
    type(table.view, '->')
    expect(saved(table.crepe)).toContain('| a→ |')
  })
})

describe('Backspace right after gives back the text of that step (D7)', () => {
  it('`->`: Backspace gives `->`, and the next key types on', async () => {
    const { crepe, view } = await mount('a\n')
    type(view, ' ->')
    expect(backspace(view)).toBe(true)
    type(view, ' b')
    expect(saved(crepe)).toBe('a -> b')
  })

  it('`<->` is two steps: Backspace right after gives `←>`', async () => {
    const { crepe, view } = await mount('a\n')
    type(view, ' <->')
    expect(backspace(view)).toBe(true)
    expect(saved(crepe)).toBe('a ←>')
  })
})

describe('where arrows stay as typed', () => {
  it('in inline code', async () => {
    const { crepe, view } = await mount('a `xy` b\n')
    // The caret inside the code mark, between `x` and `y` (at the mark's end, typing is outside it).
    let inCode = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'xy') inCode = pos + 1
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inCode)))
    type(view, '->')
    expect(saved(crepe)).toBe('a `x->y` b')
  })

  it('in a code block', async () => {
    const { crepe, view } = await mount('```js\nconst f = x\n```\n')
    type(view, ' => x->y')
    expect(saved(crepe)).toContain('const f = x => x->y')
  })

  it('as the end of an open `<!--` in the line; after it closes, arrows work again', async () => {
    const { crepe, view } = await mount('a\n')
    type(view, ' <!-- note -->')
    expect(saved(crepe)).toContain('<!-- note -->')
    type(view, ' then -> b')
    expect(saved(crepe)).toContain('<!-- note --> then → b')
  })

  it('with Settings › Editor › Typing › Arrows off (D8)', async () => {
    setTypingArrows(false)
    const { crepe, view } = await mount('a\n')
    // The text, not the file: the file escapes `==` (the highlight syntax) as `\=\=`.
    type(view, ' -> b <== c')
    expect(view.state.doc.textContent).toBe('a -> b <== c')
    setTypingArrows(true)
    type(view, ' ->')
    expect(view.state.doc.textContent).toBe('a -> b <== c →')
  })

  it('pasted text keeps its `->` (C19)', async () => {
    const { crepe, view } = await mount('a\n')
    const { from } = view.state.selection
    const text = view.state.schema.text(' x -> y')
    view.dispatch(view.state.tr.replaceRange(from, from, new Slice(view.state.schema.nodes.paragraph.create(null, text).content, 0, 0)))
    expect(saved(crepe)).toBe('a x -> y')
  })
})
