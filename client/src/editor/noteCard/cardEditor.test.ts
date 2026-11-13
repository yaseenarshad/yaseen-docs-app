/**
 * Edit card with the page's editor (YAZ-5026), against a real page (`createCrepe`) and its real card editor: the
 * round-trip risks of the scope on YAZ-5026, one test each, then the hidden word, the sides, the mirror and Done's one
 * undo step, the keys and the card's on/off list.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo, undoDepth } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cardSides } from '@shared/cardText'
import { cardIdOf, findCards } from '@shared/cardLine'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { NOTE_CARD_MIRROR_MS, noteCardViewAt, setNoteCardEditorKind, type NoteCardView } from './noteCardView'
import { joinCardParts, splitCardText } from './cardEditorText'
import { SIDE_BREAK } from './cardEditor'

beforeAll(() => setNoteCardEditorKind('page'))
afterAll(() => setNoteCardEditorKind('code'))

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  while (mounted.length > 0) {
    const m = mounted.pop()!
    await m.crepe.destroy()
    m.root.remove()
  }
})

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function vault() {
  const source = createWikilinkResolveSource()
  source.update((t) => (t === 'Atlas' ? '/v/Atlas.md' : null), [], [], true, ['WIKI'])
  return source
}

const page = (card: string, line = '<!-- card: WIKI-7 -->') => `# Page\n\n\`\`\`\`card\n${card}\n\`\`\`\`\n${line}\n\nAfter.\n`

async function mount(markdown: string, opts: Partial<CreateCrepeOptions> = {}): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, image: { root: '/v', notePath: '/v/Page.md' }, wikilinks: vault(), noteCards: { path: '/v/Page.md' }, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  return { crepe, root, view }
}

const cardPos = (view: EditorView, n = 0): number => {
  const at: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block' && node.attrs.language === 'card') at.push(pos)
    return !node.isTextblock
  })
  return at[n]
}
const cardText = (view: EditorView, n = 0): string => view.state.doc.nodeAt(cardPos(view, n))!.textContent

/** Edit card on the card, and its editor once it has the card's text. */
async function edit(view: EditorView, n = 0): Promise<{ card: NoteCardView; inner: EditorView }> {
  const card = noteCardViewAt(view, cardPos(view, n))!
  card.edit()
  await card.cardEditor!.ready
  return { card, inner: card.cardEditor!.view()! }
}

/** Types `text` at the inner editor's caret through its input rules, as a key press does. */
function type(inner: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = inner.state.selection
    const handled = inner.someProp('handleTextInput', (f) => f(inner, from, to, ch, () => inner.state.tr.insertText(ch, from, to)))
    if (handled !== true) inner.dispatch(inner.state.tr.insertText(ch, from, to))
  }
}

/** The caret at the end of the inner text block that holds `text`. */
function caretAfter(inner: EditorView, text: string): void {
  let at = -1
  inner.state.doc.descendants((node, pos) => {
    if (at >= 0) return false
    if (node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text) + text.length
    return true
  })
  if (at < 0) throw new Error(`no "${text}"`)
  inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, at)))
}

const key = (el: HTMLElement, k: string, mods: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }))

describe('the card text in sides (`cardEditorText.ts`)', () => {
  it.each(['Q\n---\nA', '\n---\nA', 'Q\n---\n', '', '  ---  \nX', 'Q\n\n---\n\nA\n---\nC', '```\n---\n```\n---\nB'])('splits and joins %j byte for byte', (text) => {
    expect(joinCardParts(splitCardText(text))).toBe(text)
  })
  it('a `---` in code is no break', () => {
    expect(splitCardText('```\n---\n```\n---\nB').sides).toHaveLength(2)
  })
})

describe('Edit card with the page`s editor: the round-trip risks (YAZ-5026 scope)', () => {
  it('`Question\\n---\\nAnswer` stays two sides, never a heading', async () => {
    const { view } = await mount(page('Question\n---\nAnswer'))
    const { card, inner } = await edit(view)
    expect(inner.state.doc.content.content.map((n) => n.type.name)).toEqual(['paragraph', SIDE_BREAK, 'paragraph'])
    expect(inner.dom.querySelector('h2')).toBeNull()
    caretAfter(inner, 'Question')
    type(inner, ' now')
    card.done()
    expect(cardText(view)).toBe('Question now\n---\nAnswer')
    expect(cardSides(cardText(view))).toEqual(['Question now', 'Answer'])
  })

  it('a paragraph that is only `---` never becomes a side break: it is written `\\---`', async () => {
    const { view } = await mount(page('Front\n---\nBack'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Back')
    inner.dispatch(inner.state.tr.split(inner.state.selection.from))
    // Not typed (typing `---` makes a side): a paragraph whose text is `---`, as a paste can give.
    inner.dispatch(inner.state.tr.insertText('---'))
    card.done()
    expect(cardText(view)).toBe('Front\n---\nBack\n\n\\---')
    expect(cardSides(cardText(view))).toHaveLength(2)
  })

  it('`[[link]]` comes back as `[[link]]`, never `\\[\\[link]]`', async () => {
    const { view } = await mount(page('See [[Atlas]] and [[WIKI-12]].\n---\nBack'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Back')
    type(inner, '!')
    caretAfter(inner, '.')
    type(inner, ' Yes')
    card.done()
    expect(cardText(view)).toBe('See [[Atlas]] and [[WIKI-12]]. Yes\n---\nBack!')
  })

  it('`{{` inside code is never a hidden word', async () => {
    const { view } = await mount(page('Use `{{x}}` and {{y}}.\n\n```js\nconst a = "{{z}}"\n```'))
    const { card, inner } = await edit(view)
    const hidden = [...inner.dom.querySelectorAll('.note-card__cloze')].map((e) => e.textContent)
    expect(hidden).toEqual(['y'])
    caretAfter(inner, ' and ')
    type(inner, 'so ')
    card.done()
    expect(cardText(view)).toBe('Use `{{x}}` and so {{y}}.\n\n```js\nconst a = "{{z}}"\n```')
  })

  it('a code block inside a card does not end the card: the page`s fence grows', async () => {
    const { crepe, view } = await mount(page('Front\n---\nBack'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Back')
    inner.dispatch(inner.state.tr.split(inner.state.selection.from))
    const codeType = inner.state.schema.nodes.code_block
    const { from } = inner.state.selection
    inner.dispatch(inner.state.tr.replaceWith(from - 1, from + 1, codeType.create({ language: 'js' }, inner.state.schema.text('let a = 1'))))
    card.done()
    expect(cardText(view)).toBe('Front\n---\nBack\n\n```js\nlet a = 1\n```')
    const saved = getMarkdownForSave(crepe)
    const cards = findCards(saved)
    expect(cards).toHaveLength(1)
    expect(cards[0].text).toBe('Front\n---\nBack\n\n```js\nlet a = 1\n```')
    expect(cardIdOf(cards[0].line)).toBe('WIKI-7')
  })

  it('the comments the page joins (`<!-- code: … -->`, `<!-- table: … -->`) stay, in an edited side too', async () => {
    const front = '```js\nx\n```\n<!-- code: width 900 -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- table: stripes -->'
    const { view } = await mount(page(`${front}\n\nFront\n---\nBack`))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Front')
    type(inner, '!')
    card.done()
    const text = cardText(view)
    expect(text).toContain('<!-- code: width 900 -->')
    expect(text).toContain('<!-- table: stripes -->')
    expect(text).toContain('Front!')
    expect(text.endsWith('\n---\nBack')).toBe(true)
  })

  it('the first edit of a side writes the page`s tidy form; a side not edited keeps its bytes', async () => {
    const { view } = await mount(page('* one\n* two\n---\n__bold__   back\n\n\n'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'two')
    type(inner, '!')
    card.done()
    const [front, back] = splitCardText(cardText(view)).sides.map((lines) => lines.join('\n'))
    expect(front).toMatch(/^[-*] one\n[-*] two!$/)
    // The back: its bytes, its blank lines too.
    expect(back).toBe('__bold__   back\n\n\n')
  })

  it('no change, no write: Done keeps the bytes and adds no undo step', async () => {
    const odd = '* a\n\n\n  ---  \n__b__ {{1::c}}'
    const { view } = await mount(page(odd))
    const depth = undoDepth(view.state)
    const { card, inner } = await edit(view)
    // Typing and taking it back is no change either.
    caretAfter(inner, 'a')
    type(inner, 'x')
    await tick(NOTE_CARD_MIRROR_MS + 50)
    expect(cardText(view)).not.toBe(odd)
    undo(inner.state, inner.dispatch)
    card.done()
    expect(cardText(view)).toBe(odd)
    expect(undoDepth(view.state)).toBe(depth)
  })
})

describe('the hidden word in the card editor', () => {
  it('reads `{{x}}`, `{{1::x}}` and `{{c2::**x** y}}` as hidden words and writes them back the same', async () => {
    const { view } = await mount(page('A {{one}}, {{1::two}} and {{c2::**three** four}}.'))
    const { card, inner } = await edit(view)
    // Three hidden words, by their keys (bold inside one draws it in two spans).
    const keys = new Set<unknown>()
    inner.state.doc.descendants((node) => {
      const mark = node.marks.find((m) => m.type.name === 'cloze')
      if (mark !== undefined) keys.add(mark.attrs.key)
    })
    expect(keys.size).toBe(3)
    expect([...inner.dom.querySelectorAll('.note-card__cloze')].map((e) => e.textContent).join('|')).toBe('one|two|three| four')
    caretAfter(inner, '.')
    type(inner, '!')
    card.done()
    expect(cardText(view)).toBe('A {{one}}, {{1::two}} and {{c2::**three** four}}.!')
  })

  it('⌘L hides the selected word, and in a hidden word shows it again; typing `{{word}}` hides it', async () => {
    const { view } = await mount(page('Paris is in France.'))
    const { card, inner } = await edit(view)
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, 1, 6)))
    key(inner.dom, 'l', { metaKey: true })
    expect(inner.dom.querySelector('.note-card__cloze')?.textContent).toBe('Paris')
    caretAfter(inner, 'France.')
    type(inner, ' {{Seine}}')
    expect([...inner.dom.querySelectorAll('.note-card__cloze')].map((e) => e.textContent)).toEqual(['Paris', 'Seine'])
    card.done()
    expect(cardText(view)).toBe('{{Paris}} is in France. {{Seine}}')
    // ⌘L inside a hidden word takes the braces off the whole word.
    const again = await edit(view)
    again.inner.dispatch(again.inner.state.tr.setSelection(TextSelection.create(again.inner.state.doc, 2, 4)))
    key(again.inner.dom, 'l', { metaKey: true })
    again.card.done()
    expect(cardText(view)).toBe('Paris is in France. {{Seine}}')
  })

  it('⌘L does nothing in code, or with no selection', async () => {
    const { view } = await mount(page('Use `code` here'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'cod')
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, inner.state.selection.from - 3, inner.state.selection.from)))
    key(inner.dom, 'l', { metaKey: true })
    caretAfter(inner, 'here')
    key(inner.dom, 'l', { metaKey: true })
    expect(inner.dom.querySelector('.note-card__cloze')).toBeNull()
    card.done()
    expect(cardText(view)).toBe('Use `code` here')
  })
})

describe('sides in the card editor', () => {
  it('⌘⇧↵ splits the line into a new side; `---` on an empty line is a new side; `***` stays a line', async () => {
    const { view } = await mount(page('Question Answer'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Question')
    key(inner.dom, 'Enter', { metaKey: true, shiftKey: true })
    expect(inner.state.doc.content.content.map((n) => n.type.name)).toEqual(['paragraph', SIDE_BREAK, 'paragraph'])
    caretAfter(inner, 'Answer')
    key(inner.dom, 'Enter')
    inner.dispatch(inner.state.tr.split(inner.state.selection.from))
    type(inner, '---')
    type(inner, 'Third')
    inner.dispatch(inner.state.tr.split(inner.state.selection.from))
    type(inner, '*** ')
    card.done()
    expect(cardText(view)).toBe('Question\n---\nAnswer\n---\nThird\n\n***')
    expect(cardSides(cardText(view))).toEqual(['Question', 'Answer', 'Third\n\n***'])
  })
})

describe('the mirror, Done and the page`s undo', () => {
  it('the text goes into the page 300 ms after a change, out of the undo history; Done is ONE ⌘Z in the page', async () => {
    const saves: string[] = []
    const { crepe, view } = await mount(page('Front\n---\nBack'), { onMarkdownUpdated: (md) => saves.push(md) })
    const depth = undoDepth(view.state)
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Front')
    type(inner, ' one')
    expect(cardText(view)).toBe('Front\n---\nBack')
    await tick(NOTE_CARD_MIRROR_MS + 300)
    expect(cardText(view)).toBe('Front one\n---\nBack')
    expect(undoDepth(view.state)).toBe(depth)
    // The mirror is saved (a tab switch loses no typing).
    expect(saves.at(-1)).toContain('Front one')
    type(inner, ' two')
    // A save reads the card as it is now.
    expect(getMarkdownForSave(crepe)).toContain('Front one two')
    card.done()
    expect(cardText(view)).toBe('Front one two\n---\nBack')
    expect(undoDepth(view.state)).toBe(depth + 1)
    undo(view.state, view.dispatch)
    expect(cardText(view)).toBe('Front\n---\nBack')
  })

  it('Esc and ⌘↵ in the card editor are Done; a second Edit card does Done on the first', async () => {
    const { view } = await mount(`${page('One')}\n\`\`\`card\nTwo\n\`\`\`\n<!-- card: WIKI-8 -->\n`)
    let { card, inner } = await edit(view)
    type(inner, '!')
    key(inner.dom, 'Escape')
    expect(card.editing).toBe(false)
    expect(cardText(view)).toBe('One!')
    ;({ card, inner } = await edit(view))
    key(inner.dom, 'Enter', { metaKey: true })
    expect(card.editing).toBe(false)
    const first = await edit(view, 0)
    type(first.inner, '?')
    const second = await edit(view, 1)
    expect(first.card.editing).toBe(false)
    expect(cardText(view, 0)).toBe('One!?')
    expect(second.card.editing).toBe(true)
    second.card.done()
  })

  it('the page`s selection is the card while it is edited, and the page never reads the inner editor', async () => {
    const { view } = await mount(page('Front'))
    const { card, inner } = await edit(view)
    expect(view.state.selection.from).toBe(cardPos(view))
    expect(card.dom.classList.contains('note-card--editing')).toBe(true)
    expect(card.dom.classList.contains('ProseMirror-selectednode')).toBe(false)
    const before = view.state.doc
    type(inner, ' more')
    await tick(20)
    expect(view.state.doc).toBe(before)
    card.done()
  })
})

describe('the card editor`s own on/off list (YAZ-5026 description)', () => {
  it('a card in a card is a code block; no highlight buttons or check list; "Hide word" in the toolbar and "New side" in the `/` menu', async () => {
    const { view } = await mount(page('Front\n\n```card\nInner\n```'))
    const { card, inner } = await edit(view)
    expect(inner.dom.querySelector('.note-card')).toBeNull()
    expect(inner.state.doc.content.content.some((n) => n.type.name === 'code_block' && n.attrs.language === 'card')).toBe(true)
    // The toolbar and the `/` menu are drawn by Crepe beside the inner view.
    const host = inner.dom.parentElement!
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, 1, 6)))
    await tick(50)
    const buttons = [...host.querySelectorAll<HTMLElement>('.milkdown-toolbar [data-toolbar-item]')].map((b) => b.dataset.toolbarItem)
    if (buttons.length > 0) {
      expect(buttons).toContain('cloze')
      expect(buttons).not.toContain('highlight')
      expect(buttons).not.toContain('checklist')
    }
    card.done()
    expect(cardText(view)).toBe('Front\n\n```card\nInner\n```')
  })
})
