/**
 * Keys on a card (YAZ-5006, YAZ-5007, YAZ-5008), against a real editor (`createCrepe`): a selected card is not
 * replaced by a key, Enter is Edit card; Edit card has the writing look and no marks on other copies of the selected
 * word; ⌘L toggles a hidden word.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { EditorSelection } from '@codemirror/state'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { rules } from '../cssRules'
import { cardBlockViewAt, setCardEditorKind } from './cardBlockView'
import { toggleHiddenWord } from './cardEdit'
import css from './card.css?raw'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  while (mounted.length > 0) {
    const c = mounted.pop()!
    await c.crepe.destroy()
    c.root.remove()
  }
})

const CARD = 'Intro\n\n```card\ntest one\ntest two\n---\nA\n```\n<!-- card: WIKI-9, 2026-11-01T09:00Z good -->\n\n```js\ntest\ntest\n```\n'

async function mount(markdown = CARD): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView; pos: number }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, cards: { path: '/v/Page.md' } })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  let pos = -1
  view.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === 'code_block' && n.attrs.language === 'card') pos = p
    return pos === -1
  })
  return { crepe, root, view, pos }
}

const hasCard = (crepe: Crepe) => getMarkdownForSave(crepe).includes('```card\ntest one')

function selectCard(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
}

/** A typed character as the browser sends it: keydown, then keypress (ProseMirror types on keypress). */
function type(view: EditorView, ch: string): void {
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }))
  view.dom.dispatchEvent(new KeyboardEvent('keypress', { key: ch, charCode: ch.charCodeAt(0), keyCode: ch.charCodeAt(0), bubbles: true, cancelable: true }))
}

const key = (view: EditorView, k: string) => view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

describe('YAZ-5006: a key on a selected card', () => {
  it('a letter, a digit, a space or a paste does nothing to the card; a composition`s change is refused', async () => {
    const { crepe, view, pos } = await mount()
    selectCard(view, pos)
    for (const ch of ['d', '7', ' ', '.']) type(view, ch)
    expect(hasCard(crepe)).toBe(true)
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    // A paste.
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (t: string) => (t === 'text/plain' ? 'pasted' : ''), types: ['text/plain'], files: [] } })
    view.dom.dispatchEvent(paste)
    expect(hasCard(crepe)).toBe(true)
    expect(getMarkdownForSave(crepe)).not.toContain('pasted')
    // An IME composition: the change it reads from the page is refused while the card is selected.
    view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text('あ')).setMeta('composition', 1))
    expect(hasCard(crepe)).toBe(true)
  })

  it('Enter opens Edit card; Backspace deletes the card as any block, and ⌘Z brings it back', async () => {
    const { crepe, view, pos } = await mount()
    selectCard(view, pos)
    key(view, 'Enter')
    expect(cardBlockViewAt(view, pos)?.editing).toBe(true)
    cardBlockViewAt(view, pos)!.done()
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    key(view, 'Backspace')
    expect(hasCard(crepe)).toBe(false)
    undo(view.state, view.dispatch)
    expect(hasCard(crepe)).toBe(true)
    // Delete too.
    selectCard(view, pos)
    key(view, 'Delete')
    expect(hasCard(crepe)).toBe(false)
  })

  it('round 2: text with NO key press (dictation, the emoji picker, text replacement) does not replace the card', async () => {
    const { crepe, view, pos } = await mount()
    const { schema } = view.state
    selectCard(view, pos)
    // A transaction that types over the selection, as a DOM read or a command dispatches it: no key event, no meta.
    view.dispatch(view.state.tr.insertText('d'))
    view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.paragraph.create(null, schema.text('dictated'))))
    // In two steps: the card deleted, then the text put where it was.
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.delete(from, to).insert(from, schema.nodes.paragraph.create(null, schema.text('emoji'))))
    expect(hasCard(crepe)).toBe(true)
    expect(getMarkdownForSave(crepe)).not.toMatch(/dictated|emoji|\nd\n/)
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    // The page's `beforeinput` of an insert is cancelled, so the browser does not write the text into the page.
    for (const inputType of ['insertText', 'insertReplacementText', 'insertFromComposition', 'insertFromPaste']) {
      const input = new InputEvent('beforeinput', { inputType, data: '😀', bubbles: true, cancelable: true })
      view.dom.dispatchEvent(input)
      expect(input.defaultPrevented, inputType).toBe(true)
    }
    // Text the browser wrote into the page anyway (an uncancellable composition): the DOM read is refused and redrawn.
    const card = view.dom.querySelector('.card')!
    const p = document.createElement('p')
    p.textContent = 'typed'
    card.replaceWith(p)
    ;(view as unknown as { domObserver: { flush(): void } }).domObserver.flush()
    expect(hasCard(crepe)).toBe(true)
    expect(getMarkdownForSave(crepe)).not.toContain('typed')
    expect(view.dom.querySelector('.card')).not.toBeNull()
  })

  it('round 2: Backspace, cut, the block menu`s delete and a drag move still take the card; ⌘Z brings it back', async () => {
    const { crepe, view, pos } = await mount()
    const size = view.state.doc.nodeAt(pos)!.nodeSize
    // The block menu's delete (a plain delete of the block).
    selectCard(view, pos)
    view.dispatch(view.state.tr.delete(pos, pos + size))
    expect(hasCard(crepe)).toBe(false)
    undo(view.state, view.dispatch)
    expect(hasCard(crepe)).toBe(true)
    // A cut.
    selectCard(view, pos)
    view.dispatch(view.state.tr.deleteSelection().setMeta('uiEvent', 'cut'))
    expect(hasCard(crepe)).toBe(false)
    undo(view.state, view.dispatch)
    // A drag move to the top of the page: deleted here, inserted there.
    selectCard(view, pos)
    const node = view.state.doc.nodeAt(pos)!
    view.dispatch(view.state.tr.delete(pos, pos + size).insert(0, node).setMeta('uiEvent', 'drop'))
    expect(view.state.doc.firstChild!.attrs.language).toBe('card')
    expect(hasCard(crepe)).toBe(true)
  })

  it('a caret in a paragraph still types', async () => {
    const { view } = await mount()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)))
    expect(view.someProp('handleTextInput', (f) => f(view, 6, 6, 'X', () => view.state.tr.insertText('X')))).toBeFalsy()
  })
})

/** Edit card on the card at `pos`: its CodeMirror, once the card language has loaded. */
async function editCard(root: HTMLElement, view: EditorView, pos: number): Promise<CodeMirrorView> {
  cardBlockViewAt(view, pos)!.edit()
  const content = root.querySelector<HTMLElement>('.card .cm-content')!
  await expect.poll(() => content.getAttribute('spellcheck')).toBe('true')
  return CodeMirrorView.findFromDOM(content)!
}

describe('YAZ-5007: Edit card has the writing look', () => {
  // The raw-text fallback (YAZ-5026); the page's editor is `cardEditor.test.ts`.
  beforeAll(() => setCardEditorKind('code'))
  afterAll(() => setCardEditorKind('page'))
  it('no marks on other copies of the selected word in the card; another code block keeps them', async () => {
    const { root, view, pos } = await mount()
    const cm = await editCard(root, view, pos)
    cm.dispatch({ selection: EditorSelection.range(0, 4) })
    await new Promise((r) => setTimeout(r, 20))
    expect(cm.dom.querySelectorAll('.cm-selectionMatch')).toHaveLength(0)
    // The js block: the same word selected marks the other copy.
    let jsPos = -1
    view.state.doc.forEach((node, p) => {
      if (node.attrs.language === 'js') jsPos = p
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, jsPos + 1, jsPos + 5)))
    const js = [...root.querySelectorAll<HTMLElement>('.cm-content')].find((c) => c.closest('.card') === null)!
    await expect.poll(() => js.parentElement!.querySelectorAll('.cm-selectionMatch').length).toBeGreaterThan(0)
  })

  it('no line numbers, no fold arrows, the page font and the card`s padding, only in a card`s editor', () => {
    const rule = (selector: string) => rules(css, selector).find((r) => r.selector === selector)?.body ?? ''
    expect(rule('.card .card__code .cm-gutters')).toMatch(/display:\s*none/)
    expect(rule('.card .card__code .cm-scroller')).toMatch(/font-family:\s*var\(--crepe-font-default\)/)
    // The rendered card's padding, so Edit card / Done does not jump.
    const body = rule('.card .card__body').match(/padding:\s*([^;]+);/)![1]
    expect(rule('.milkdown .card .card__code')).toContain(`padding: ${body};`)
  })
})

describe('YAZ-5008: ⌘L toggles a hidden word in Edit card', () => {
  // The raw-text fallback (YAZ-5026); the page's editor is `cardEditor.test.ts`.
  beforeAll(() => setCardEditorKind('code'))
  afterAll(() => setCardEditorKind('page'))
  const cmOf = (doc: string, from: number, to: number) => new CodeMirrorView({ doc, selection: EditorSelection.range(from, to) })

  it('wraps the selection in {{ }}; unwraps a hidden word (braces included, or its words); no selection does nothing', () => {
    let cm = cmOf('the capital of France', 15, 21)
    expect(toggleHiddenWord(cm)).toBe(true)
    expect(cm.state.doc.toString()).toBe('the capital of {{France}}')
    expect(cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to)).toBe('France')
    // Again on the same selection (the words inside): the braces come off.
    toggleHiddenWord(cm)
    expect(cm.state.doc.toString()).toBe('the capital of France')
    // The whole hidden word, braces included, and the numbered form.
    cm = cmOf('a {{1::Paris}} b', 2, 14)
    toggleHiddenWord(cm)
    expect(cm.state.doc.toString()).toBe('a Paris b')
    // No selection: nothing.
    cm = cmOf('a {{Paris}} b', 5, 5)
    toggleHiddenWord(cm)
    expect(cm.state.doc.toString()).toBe('a {{Paris}} b')
  })

  it('⌘L in the card`s editor wraps the selection', async () => {
    const { root, view, pos } = await mount()
    const cm = await editCard(root, view, pos)
    cm.dispatch({ selection: EditorSelection.range(5, 8) })
    cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', keyCode: 76, metaKey: true, bubbles: true, cancelable: true }))
    expect(cm.state.doc.toString().startsWith('test {{one}}')).toBe(true)
  })
})

describe('YAZ-5034: Edit card`s key row, and ⌘⇧↵ for a new side', () => {
  // The raw-text fallback (YAZ-5026); the page's editor is `cardEditor.test.ts`.
  beforeAll(() => setCardEditorKind('code'))
  afterAll(() => setCardEditorKind('page'))
  const shiftModEnter = (cm: CodeMirrorView) =>
    cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))

  it('the key row shows only in Edit card, each part the app`s hotkey label (YAZ-5332); the head`s Done too', async () => {
    const { root, view, pos } = await mount()
    const card = () => root.querySelector<HTMLElement>('.card')!
    expect(card().querySelector('.card__keys')).toBeNull()
    await editCard(root, view, pos)
    const row = card().querySelector<HTMLElement>('.card__keys')!
    expect(row.textContent).toBe('Hide word (Cmd+L)' + 'New side (Cmd+Shift+Enter)' + 'Done (Cmd+Enter)')
    expect(row.previousElementSibling?.classList.contains('card__code')).toBe(true)
    expect(card().querySelector('.card__edit')!.textContent).toBe('Done (Esc / Cmd+Enter)')
    cardBlockViewAt(view, pos)!.done()
    expect(card().querySelector('.card__keys')).toBeNull()
  })

  it('⌘⇧↵ at the middle, end and start of a line: `---` alone on its line, the caret at the new side; saved; one ⌘Z', async () => {
    const { crepe, root, view, pos } = await mount()
    const cm = await editCard(root, view, pos)
    const at = (offset: number) => cm.dispatch({ selection: EditorSelection.cursor(offset) })
    const caretLine = () => cm.state.doc.lineAt(cm.state.selection.main.head)
    // Middle: "test one" splits after "test" (the space goes).
    at(4)
    shiftModEnter(cm)
    expect(cm.state.doc.toString()).toBe('test\n---\none\ntest two\n---\nA')
    expect(caretLine().text).toBe('one')
    expect(cm.state.selection.main.head).toBe(caretLine().from)
    expect(getMarkdownForSave(crepe)).toContain('```card\ntest\n---\none\ntest two\n---\nA\n```')
    // One ⌘Z (the page's undo) takes the break off.
    undo(view.state, view.dispatch)
    expect(cm.state.doc.toString()).toBe('test one\ntest two\n---\nA')
    // End of a line: a new, empty side after it.
    at(8)
    shiftModEnter(cm)
    expect(cm.state.doc.toString()).toBe('test one\n---\n\ntest two\n---\nA')
    expect(cm.state.selection.main.head).toBe(13)
    undo(view.state, view.dispatch)
    // Start of a line: no empty line before `---`.
    at(9)
    shiftModEnter(cm)
    expect(cm.state.doc.toString()).toBe('test one\n---\ntest two\n---\nA')
    expect(caretLine().text).toBe('test two')
    expect(getMarkdownForSave(crepe)).toContain('```card\ntest one\n---\ntest two\n---\nA\n```')
  })

  it('⌘⇧↵ in a normal code block keeps its meaning: a line above the block', async () => {
    const { crepe, root, view } = await mount()
    let jsPos = -1
    view.state.doc.forEach((node, p) => {
      if (node.attrs.language === 'js') jsPos = p
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, jsPos + 2)))
    let js: HTMLElement | undefined
    await expect.poll(() => (js = [...root.querySelectorAll<HTMLElement>('.cm-content')].find((c) => c.closest('.card') === null))).toBeTruthy()
    const before = view.state.doc.childCount
    shiftModEnter(CodeMirrorView.findFromDOM(js!)!)
    expect(view.state.doc.childCount).toBe(before + 1)
    expect(getMarkdownForSave(crepe)).toContain('```js\ntest\ntest\n```')
    expect(getMarkdownForSave(crepe)).not.toContain('---\ntest')
  })
})
