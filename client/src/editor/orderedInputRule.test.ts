/**
 * Typing a list marker (YAZ-3727 D8, D9, `listMarkerTyping.ts`): `n. ` or `* ` / `- ` on a plain line starts a list line,
 * as its own undo step; ⌘Z or Backspace right after gives the plain text back; Enter never converts; inside a list item
 * the marker stays text. `Mod-Alt-7` stays off (YAZ-793).
 */
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, it, test } from 'vitest'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { isBulletsOnly, lockToBullets, outlineFeatures } from './outline/bulletsOnly'

const mounted: Array<{ crepe: ReturnType<typeof createCrepe>; root: HTMLElement }> = []

/** Mounts `markdown` with the caret at the end of the text `at`. */
async function mount(markdown: string, at: string, outline = false) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...(outline ? { features: outlineFeatures } : {}) })
  if (outline) lockToBullets(crepe)
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text === at) pos = p + at.length
    return pos < 0
  })
  if (pos < 0) throw new Error(`text not found: ${at}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  return { crepe, view }
}

afterEach(async () => {
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

/** A keydown through the editor's keymaps; `meta` is ⌘ (test-setup pins `navigator.platform` to Mac). */
function press(view: EditorView, key: string, meta = false): boolean {
  const event = new KeyboardEvent('keydown', { key, code: key === 'z' ? 'KeyZ' : key, metaKey: meta, bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

/** The saved file, lines joined by ` / ` (Crepe's trailing empty paragraph trimmed). */
const saved = (crepe: ReturnType<typeof createCrepe>) => getMarkdownForSave(crepe).trim().replace(/\n/g, ' / ')

/** The block types from the top, `paragraph` or `<list> <order>`, for the line holding the caret. */
function caretLine(view: EditorView): string {
  const { $from } = view.state.selection
  const list = $from.depth > 2 ? $from.node($from.depth - 2) : null
  if (list?.type.name === 'ordered_list') return `ordered_list from ${list.attrs.order as number}`
  return list?.type.name ?? $from.parent.type.name
}

describe('typing a marker on a plain line starts a list line (YAZ-3727 D8)', () => {
  it.each([
    ['1. ', 'ordered_list from 1', 'para /  / 1.'],
    ['5. ', 'ordered_list from 5', 'para /  / 5.'],
    ['* ', 'bullet_list', 'para /  / *'],
    ['- ', 'bullet_list', 'para /  / *'],
    ['+ ', 'bullet_list', 'para /  / *'],
  ])('plain %j makes a %s', async (marker, line, file) => {
    const { crepe, view } = await mount('para\n', 'para')
    press(view, 'Enter')
    type(view, marker)
    expect(caretLine(view)).toBe(line)
    expect(view.state.selection.$from.parent.textContent).toBe('')
    expect(saved(crepe)).toBe(file)
  })

  it('a marker before existing text makes that text the list line: "1. " at the start of "Plan"', async () => {
    const { crepe, view } = await mount('Plan\n', 'Plan')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    type(view, '1. ')
    expect(saved(crepe)).toBe('1. Plan')
  })

  it('a plain "3. " right after "1. a" / "2. b" joins that list', async () => {
    const { crepe, view } = await mount('1. a\n2. b\n\nc\n', 'c')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    type(view, '3. ')
    expect(saved(crepe)).toBe('1. a / 2. b / 3. c')
    let lists = 0
    view.state.doc.forEach((node) => { if (node.type.name === 'ordered_list') lists++ })
    expect(lists).toBe(1)
  })

  it('a number that does not follow on starts its own list: "5. " after "1. a" / "2. b"', async () => {
    const { crepe, view } = await mount('1. a\n2. b\n\nc\n', 'c')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    type(view, '5. ')
    const orders: number[] = []
    view.state.doc.forEach((node) => { if (node.type.name === 'ordered_list') orders.push(node.attrs.order as number) })
    expect(orders).toEqual([1, 5])
    // remark writes the second of two adjacent numbered lists with `)` so they stay two lists.
    expect(saved(crepe)).toBe('1. a / 2. b /  / 5) c')
  })

  it('a plain "* " right after a bullet list joins it', async () => {
    const { crepe, view } = await mount('* a\n\nc\n', 'c')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    type(view, '* ')
    expect(saved(crepe)).toBe('* a / * c')
  })

  it('in a quote "1. " makes a numbered line inside the quote', async () => {
    const { crepe, view } = await mount('> q\n', 'q')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    type(view, '1. ')
    expect(saved(crepe)).toBe('> 1. q')
  })
})

describe('inside a list item the marker stays text (YAZ-3727 D8)', () => {
  it.each([
    // The same-line rule (YAZ-1329, `restoreItemLine`) writes `* 1. x` bare; it loads back as bullet text.
    ['* a\n', '1. x', '* a / * 1. x'],
    ['1. a\n', '1. x', '1. a / 2. 1\\. x'],
    ['* a\n', '* x', '* a / * \\* x'],
    ['1. a\n', '- x', '1. a / 2. \\- x'],
  ])('in %j a new line typed %j stays text', async (markdown, typed, file) => {
    const { crepe, view } = await mount(markdown, 'a')
    press(view, 'Enter')
    type(view, typed)
    expect(saved(crepe)).toBe(file)
  })

  it.each(['- ', '* ', '1. '])('in the folder outline %j at a bullet\'s start stays text', async (typed) => {
    const { view } = await mount('- a\n', 'a', true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    type(view, typed)
    expect(view.state.selection.$from.parent.textContent).toBe(`${typed}a`)
    expect(isBulletsOnly(view.state.doc)).toBe(true)
  })

  it('"* " typed at the start of a bullet stays as typed (it used to vanish)', async () => {
    const { crepe, view } = await mount('* a\n', 'a')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    type(view, '* ')
    expect(view.state.selection.$from.parent.textContent).toBe('* a')
    expect(saved(crepe)).toBe('* \\* a')
  })
})

describe('the conversion is its own undo step (YAZ-3727 D9)', () => {
  const undoWays: Array<[string, (view: EditorView) => void]> = [
    ['⌘Z', (view) => { expect(press(view, 'z', true)).toBe(true) }],
    ['history undo', (view) => { expect(undo(view.state, view.dispatch)).toBe(true) }],
    ['Backspace', (view) => { expect(press(view, 'Backspace')).toBe(true) }],
  ]

  describe.each([['1. ', '1.'], ['* ', '*'], ['- ', '-']])('typed %j', (marker, bare) => {
    it.each(undoWays)('%s right after gives back the plain text, caret after the space', async (_name, undoOnce) => {
      const { view } = await mount('para\n', 'para')
      press(view, 'Enter')
      type(view, marker)
      undoOnce(view)
      const { $from } = view.state.selection
      expect($from.parent.type.name).toBe('paragraph')
      expect($from.depth).toBe(1)
      expect($from.parent.textContent).toBe(marker)
      expect($from.parentOffset).toBe(marker.length)
    })

    it('⌘Z, then Enter makes a plain line, and typing there stays plain', async () => {
      const { crepe, view } = await mount('para\n', 'para')
      press(view, 'Enter')
      type(view, marker)
      press(view, 'z', true)
      press(view, 'Enter')
      type(view, 'next')
      expect(caretLine(view)).toBe('paragraph')
      expect(view.state.doc.child(1).textContent).toBe(marker)
      expect(view.state.doc.child(1).type.name).toBe('paragraph')
      expect(saved(crepe)).toMatch(/ \/ {2}\/ next$/)
    })

    it('a second ⌘Z takes the typed text away too', async () => {
      const { crepe, view } = await mount('para\n', 'para')
      press(view, 'Enter')
      type(view, marker)
      press(view, 'z', true)
      press(view, 'z', true)
      expect(view.state.doc.textContent).toBe('para')
      expect(saved(crepe)).toBe('para')
    })

    it(`plain "${bare}" then Enter makes a plain new line`, async () => {
      const { view } = await mount('para\n', 'para')
      press(view, 'Enter')
      type(view, bare)
      press(view, 'Enter')
      type(view, 'next')
      expect(caretLine(view)).toBe('paragraph')
      expect(view.state.doc.child(1).textContent).toBe(bare)
      expect(view.state.doc.child(1).type.name).toBe('paragraph')
    })
  })

  it('Backspace still undoes after the list node view puts the caret back (one frame later)', async () => {
    const { view } = await mount('para\n', 'para')
    press(view, 'Enter')
    type(view, '1. ')
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    expect(press(view, 'Backspace')).toBe(true)
    expect(view.state.selection.$from.parent.textContent).toBe('1. ')
    expect(view.state.selection.$from.depth).toBe(1)
  })

  it('Backspace after typing on is ordinary: "1. Pl" then Backspace is no undo (the browser deletes the "l")', async () => {
    const { crepe, view } = await mount('para\n', 'para')
    press(view, 'Enter')
    type(view, '1. Pl')
    expect(press(view, 'Backspace')).toBe(false)
    expect(saved(crepe)).toBe('para /  / 1. Pl')
  })

  it('a caret move clears it: Backspace then joins as usual, no undo', async () => {
    const { crepe, view } = await mount('para\n', 'para')
    press(view, 'Enter')
    type(view, '1. ')
    const at = view.state.selection.from
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
    press(view, 'Backspace')
    expect(view.state.doc.textContent).not.toContain('1.')
    expect(saved(crepe)).toBe('para')
  })

  it('"1. Plan" then Enter continues the list with 2.', async () => {
    const { crepe, view } = await mount('para\n', 'para')
    press(view, 'Enter')
    type(view, '1. Plan')
    press(view, 'Enter')
    type(view, 'Build')
    expect(saved(crepe)).toBe('para /  / 1. Plan / 2. Build')
  })

  it('"* Plan" then Enter continues the bullets', async () => {
    const { crepe, view } = await mount('para\n', 'para')
    press(view, 'Enter')
    type(view, '* Plan')
    press(view, 'Enter')
    type(view, 'Build')
    expect(saved(crepe)).toBe('para /  / * Plan / * Build')
  })
})

test('Mod-Alt-7 does not create a numbered list', async () => {
  const { crepe, view } = await mount('hello\n', 'hello')
  const isMac = /Mac/.test(navigator.platform)
  const event = new KeyboardEvent('keydown', {
    key: '7',
    code: 'Digit7',
    keyCode: 55,
    altKey: true,
    ...(isMac ? { metaKey: true } : { ctrlKey: true }),
    bubbles: true,
    cancelable: true,
  })
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  expect(handled).toBe(false)
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
  expect(getMarkdownForSave(crepe)).toBe('hello\n')
})
