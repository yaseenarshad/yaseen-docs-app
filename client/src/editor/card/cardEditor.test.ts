/**
 * Edit card with the page's editor (YAZ-5026), against a real page (`createCrepe`) and its real card editor: the
 * round-trip risks of the scope on YAZ-5026, one test each, then the hidden word, the sides, the mirror and Done's one
 * undo step, the keys and the card's on/off list.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { undo, undoDepth } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cardSides, cardTitleOut } from '@shared/cardText'
import { cardIdOf, findCards } from '@shared/cardLine'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { CARD_MIRROR_MS, cardBlockViewAt, setCardEditorKind, type CardBlockView } from './cardBlockView'
import { joinCardParts, splitCardText } from './cardEditorText'
import { SIDE_BREAK } from './cardEditor'
import { listenTour } from '../../course/tourBus'

// The page's editor is Edit card's default (YAZ-5026); the raw-text fallback is one switch away.
beforeAll(() => setCardEditorKind('page'))
afterAll(() => setCardEditorKind('page'))

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

/**
 * A page with one card: `title` its first line (YAZ-5164 part 3: the Title field holds it, out of the card editor), then
 * the card's `body`, what the card editor edits. `title` '': the body is the whole card.
 */
const page = (body: string, line = '<!-- card: WIKI-7 -->', title = 'Card title') => `# Page\n\n\`\`\`\`card\n${title === '' ? '' : `${title}\n\n`}${body}\n\`\`\`\`\n${line}\n\nAfter.\n`

async function mount(markdown: string, opts: Partial<CreateCrepeOptions> = {}): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, image: { root: '/v', pagePath: '/v/Page.md' }, wikilinks: vault(), cards: { path: '/v/Page.md' }, ...opts })
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
/** The card without its title line: what the card editor edits (`cardTitleOut`). */
const cardBody = (view: EditorView, n = 0): string => cardTitleOut(cardText(view, n)).text

/** Edit card on the card, and its editor once it has the card's text. */
async function edit(view: EditorView, n = 0): Promise<{ card: CardBlockView; inner: EditorView }> {
  const card = cardBlockViewAt(view, cardPos(view, n))!
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
    expect(cardBody(view)).toBe('Question now\n---\nAnswer')
    expect(cardSides(cardBody(view))).toEqual(['Question now', 'Answer'])
  })

  it('a paragraph that is only `---` never becomes a side break: it is written `\\---`', async () => {
    const { view } = await mount(page('Front\n---\nBack'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Back')
    inner.dispatch(inner.state.tr.split(inner.state.selection.from))
    // Not typed (typing `---` makes a side): a paragraph whose text is `---`, as a paste can give.
    inner.dispatch(inner.state.tr.insertText('---'))
    card.done()
    expect(cardBody(view)).toBe('Front\n---\nBack\n\n\\---')
    expect(cardSides(cardBody(view))).toHaveLength(2)
  })

  it('`[[link]]` comes back as `[[link]]`, never `\\[\\[link]]`', async () => {
    const { view } = await mount(page('See [[Atlas]] and [[WIKI-12]].\n---\nBack'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Back')
    type(inner, '!')
    caretAfter(inner, '.')
    type(inner, ' Yes')
    card.done()
    expect(cardBody(view)).toBe('See [[Atlas]] and [[WIKI-12]]. Yes\n---\nBack!')
  })

  it('`{{` inside code is never a hidden word', async () => {
    const { view } = await mount(page('Use `{{x}}` and {{y}}.\n\n```js\nconst a = "{{z}}"\n```'))
    const { card, inner } = await edit(view)
    const hidden = [...inner.dom.querySelectorAll('.card__cloze')].map((e) => e.textContent)
    expect(hidden).toEqual(['y'])
    caretAfter(inner, ' and ')
    type(inner, 'so ')
    card.done()
    expect(cardBody(view)).toBe('Use `{{x}}` and so {{y}}.\n\n```js\nconst a = "{{z}}"\n```')
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
    expect(cardBody(view)).toBe('Front\n---\nBack\n\n```js\nlet a = 1\n```')
    const saved = getMarkdownForSave(crepe)
    const cards = findCards(saved)
    expect(cards).toHaveLength(1)
    expect(cardTitleOut(cards[0].text).text).toBe('Front\n---\nBack\n\n```js\nlet a = 1\n```')
    expect(cardIdOf(cards[0].line)).toBe('WIKI-7')
  })

  it('the comments the page joins (`<!-- code: … -->`, `<!-- table: … -->`) stay, in an edited side too', async () => {
    const front = '```js\nx\n```\n<!-- code: width 900 -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- table: stripes -->'
    const { view } = await mount(page(`${front}\n\nFront\n---\nBack`))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'Front')
    type(inner, '!')
    card.done()
    const text = cardBody(view)
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
    const [front, back] = splitCardText(cardBody(view)).sides.map((lines) => lines.join('\n'))
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
    await tick(CARD_MIRROR_MS + 50)
    expect(cardBody(view)).not.toBe(odd)
    undo(inner.state, inner.dispatch)
    card.done()
    expect(cardBody(view)).toBe(odd)
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
    expect([...inner.dom.querySelectorAll('.card__cloze')].map((e) => e.textContent).join('|')).toBe('one|two|three| four')
    caretAfter(inner, '.')
    type(inner, '!')
    card.done()
    expect(cardBody(view)).toBe('A {{one}}, {{1::two}} and {{c2::**three** four}}.!')
  })

  it('⌘L hides the selected word, and in a hidden word shows it again; typing `{{word}}` hides it', async () => {
    const { view } = await mount(page('Paris is in France.'))
    const { card, inner } = await edit(view)
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, 1, 6)))
    key(inner.dom, 'l', { metaKey: true })
    expect(inner.dom.querySelector('.card__cloze')?.textContent).toBe('Paris')
    caretAfter(inner, 'France.')
    type(inner, ' {{Seine}}')
    expect([...inner.dom.querySelectorAll('.card__cloze')].map((e) => e.textContent)).toEqual(['Paris', 'Seine'])
    card.done()
    expect(cardBody(view)).toBe('{{Paris}} is in France. {{Seine}}')
    // ⌘L inside a hidden word takes the braces off the whole word.
    const again = await edit(view)
    again.inner.dispatch(again.inner.state.tr.setSelection(TextSelection.create(again.inner.state.doc, 2, 4)))
    key(again.inner.dom, 'l', { metaKey: true })
    again.card.done()
    expect(cardBody(view)).toBe('Paris is in France. {{Seine}}')
  })

  it('⌘L does nothing in code, or with no selection', async () => {
    const { view } = await mount(page('Use `code` here'))
    const { card, inner } = await edit(view)
    caretAfter(inner, 'cod')
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, inner.state.selection.from - 3, inner.state.selection.from)))
    key(inner.dom, 'l', { metaKey: true })
    caretAfter(inner, 'here')
    key(inner.dom, 'l', { metaKey: true })
    expect(inner.dom.querySelector('.card__cloze')).toBeNull()
    card.done()
    expect(cardBody(view)).toBe('Use `code` here')
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
    expect(cardBody(view)).toBe('Question\n---\nAnswer\n---\nThird\n\n***')
    expect(cardSides(cardBody(view))).toEqual(['Question', 'Answer', 'Third\n\n***'])
  })
})

describe('the guided tour hears the card editor (YAZ-5123)', () => {
  it('typing, Hide word and a new side each fire their event once; opening the editor and showing a word fire none', async () => {
    const heard: string[] = []
    const stop = listenTour((name) => heard.push(name))
    try {
      const { view } = await mount(page('Paris is in France.'))
      const { card, inner } = await edit(view)
      expect(heard).toEqual([])
      caretAfter(inner, 'France.')
      type(inner, 'x')
      expect(heard).toEqual(['card-text-changed'])
      inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, 1, 6)))
      key(inner.dom, 'l', { metaKey: true })
      expect(heard).toEqual(['card-text-changed', 'card-word-hidden'])
      // ⌘L in the hidden word shows it again: that is no hidden word.
      key(inner.dom, 'l', { metaKey: true })
      caretAfter(inner, 'France.x')
      key(inner.dom, 'Enter', { metaKey: true, shiftKey: true })
      expect(heard).toEqual(['card-text-changed', 'card-word-hidden', 'card-side-added'])
      card.done()
    } finally {
      stop()
    }
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
    expect(cardBody(view)).toBe('Front\n---\nBack')
    await tick(CARD_MIRROR_MS + 300)
    expect(cardBody(view)).toBe('Front one\n---\nBack')
    expect(undoDepth(view.state)).toBe(depth)
    // The mirror is saved (a tab switch loses no typing).
    expect(saves.at(-1)).toContain('Front one')
    type(inner, ' two')
    // A save reads the card as it is now.
    expect(getMarkdownForSave(crepe)).toContain('Front one two')
    card.done()
    expect(cardBody(view)).toBe('Front one two\n---\nBack')
    expect(undoDepth(view.state)).toBe(depth + 1)
    undo(view.state, view.dispatch)
    expect(cardBody(view)).toBe('Front\n---\nBack')
  })

  it('Esc and ⌘↵ in the card editor are Done; a second Edit card does Done on the first', async () => {
    const { view } = await mount(`${page('One')}\n\`\`\`card\nTwo\n\`\`\`\n<!-- card: WIKI-8 -->\n`)
    let { card, inner } = await edit(view)
    type(inner, '!')
    key(inner.dom, 'Escape')
    expect(card.editing).toBe(false)
    expect(cardBody(view)).toBe('One!')
    ;({ card, inner } = await edit(view))
    key(inner.dom, 'Enter', { metaKey: true })
    expect(card.editing).toBe(false)
    const first = await edit(view, 0)
    type(first.inner, '?')
    const second = await edit(view, 1)
    expect(first.card.editing).toBe(false)
    expect(cardBody(view, 0)).toBe('One!?')
    expect(second.card.editing).toBe(true)
    second.card.done()
  })

  it('the page`s selection is the card while it is edited, and the page never reads the inner editor', async () => {
    const { view } = await mount(page('Front'))
    const { card, inner } = await edit(view)
    expect(view.state.selection.from).toBe(cardPos(view))
    expect(card.dom.classList.contains('card--editing')).toBe(true)
    expect(card.dom.classList.contains('ProseMirror-selectednode')).toBe(false)
    // The key row under the editor (YAZ-5034), kept.
    expect(card.dom.querySelector('.card__editor + .card__keys')?.textContent).toBe('Cmd + L hide wordCmd + Shift + Enter new sideCmd + Enter / Esc Done')
    const before = view.state.doc
    type(inner, ' more')
    await tick(20)
    expect(view.state.doc).toBe(before)
    card.done()
  })
})

describe('a selection in the card editor shows (YAZ-5026 round 2: "double click highlight doesnt work")', () => {
  it('a card selected before Edit card loses the selected look while edited, so a double click, a drag or ⇧+arrows shows; Done gives the look back', async () => {
    const { view } = await mount(page('A bookshop is la librería'))
    // A click on the card selects it whole first; Edit card (or E) then opens it.
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, cardPos(view))))
    const card = cardBlockViewAt(view, cardPos(view))!
    // The page's look of a selected block, `.milkdown .ProseMirror .ProseMirror-selectednode ::selection { background: transparent }`
    // (Crepe's reset), reaches every word inside the card: the inner editor's selection could not show.
    expect(card.dom.classList.contains('ProseMirror-selectednode')).toBe(true)
    const { inner } = await edit(view)
    expect(card.dom.classList.contains('ProseMirror-selectednode')).toBe(false)
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, 3, 11)))
    expect(inner.dom.closest('.ProseMirror-selectednode')).toBeNull()
    card.done()
    expect(view.state.selection instanceof NodeSelection && view.state.selection.from === cardPos(view)).toBe(true)
    expect(card.dom.classList.contains('ProseMirror-selectednode')).toBe(true)
  })

  it('a card not selected before Edit card is drawn selected after Done', async () => {
    const { view } = await mount(page('Front'))
    const { card } = await edit(view)
    expect(card.dom.classList.contains('ProseMirror-selectednode')).toBe(false)
    card.done()
    expect(card.dom.classList.contains('ProseMirror-selectednode')).toBe(true)
  })
})

describe('an outside change of the card`s text while it is edited', () => {
  it('says so; Done writes ours, and ⌘Z in the page brings theirs back', async () => {
    const notices: string[] = []
    const { view } = await mount(page('Front\n---\nBack'), { wikilinkNav: { onNotice: (m: string) => notices.push(m) } as never })
    const { card, inner } = await edit(view)
    // An agent writes the card's front (an outside merge: out of the undo history), after its title line.
    const pos = cardPos(view)
    view.dispatch(view.state.tr.insertText('Theirs ', pos + 1 + 'Card title\n\n'.length).setMeta('addToHistory', false))
    expect(notices).toHaveLength(1)
    caretAfter(inner, 'Back')
    type(inner, '!')
    card.done()
    expect(cardBody(view)).toBe('Front\n---\nBack!')
    undo(view.state, view.dispatch)
    expect(cardBody(view)).toBe('Theirs Front\n---\nBack')
  })
})

describe('the card editor`s own on/off list (YAZ-5026 description)', () => {
  it('a card in a card is a code block: no card view, its text kept', async () => {
    const { view } = await mount(page('Front\n\n```card\nInner\n```'))
    const { card, inner } = await edit(view)
    expect(inner.dom.querySelector('.card')).toBeNull()
    expect(inner.state.doc.content.content.some((n) => n.type.name === 'code_block' && n.attrs.language === 'card')).toBe(true)
    card.done()
    expect(cardBody(view)).toBe('Front\n\n```card\nInner\n```')
  })

  it('the selection toolbar has "Hide word" and no highlight colours or check list', async () => {
    const { view } = await mount(page('Paris is in France'))
    const { card, inner } = await edit(view)
    inner.focus()
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, 1, 6)))
    const host = inner.dom.parentElement!
    await vi.waitFor(() => expect(host.querySelectorAll('.milkdown-toolbar [data-toolbar-item]').length).toBeGreaterThan(0))
    const buttons = [...host.querySelectorAll<HTMLElement>('.milkdown-toolbar [data-toolbar-item]')].map((b) => b.dataset.toolbarItem)
    expect(buttons).toContain('cloze')
    expect(buttons).toContain('bold')
    for (const off of ['highlight', 'highlight-green', 'highlight-blue', 'highlight-more', 'checklist']) expect(buttons).not.toContain(off)
    // "Hide word" sits right after the heading buttons (YAZ-5026 round 2: Yaseen's mark on the strip), not last.
    expect(buttons.indexOf('cloze')).toBe(buttons.indexOf('text') + 1)
    // The button is ⌘L.
    host.querySelector<HTMLElement>('.milkdown-toolbar [data-toolbar-item="cloze"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(inner.dom.querySelector('.card__cloze')?.textContent).toBe('Paris')
    // The highlight's key and its typing are off in a card; so is the check list's `[ ] `.
    inner.dispatch(inner.state.tr.setSelection(TextSelection.create(inner.state.doc, 13, 19)))
    key(inner.dom, 'h', { metaKey: true, shiftKey: true })
    caretAfter(inner, 'France')
    type(inner, ' ==x==')
    expect(inner.dom.querySelector('mark')).toBeNull()
    card.done()
    expect(cardBody(view)).toBe('{{Paris}} is in France \\=\\=x\\=\\=')
  })

  it('the `/` menu has "New side" (`/side`) and no task list, calendar table, card or drawing; Esc closes the menu first, then is Done', async () => {
    const { view } = await mount(page('Front'), { drawing: { create: async () => null } as never })
    const { card, inner } = await edit(view)
    const host = inner.dom.parentElement!
    caretAfter(inner, 'Front')
    inner.dispatch(inner.state.tr.split(inner.state.selection.from))
    type(inner, '/')
    const menu = () => host.querySelector<HTMLElement>('.milkdown-slash-menu')
    await vi.waitFor(() => expect(menu()?.dataset.show).toBe('true'))
    await tick()
    const rows = [...menu()!.querySelectorAll('.menu-group li')].map((li) => li.textContent?.trim())
    expect(rows).toContain('New side')
    expect(rows).toContain('Table')
    expect(rows).toContain('Code')
    for (const off of ['Task List', 'Calendar table', 'Card', 'Drawing', 'Diagram']) expect(rows).not.toContain(off)
    // Esc: the menu closes (it hears the key on the window first), the card stays in Edit card.
    key(inner.dom, 'Escape')
    expect(card.editing).toBe(true)
    // `/side` + Enter: a new side.
    type(inner, 'side')
    await vi.waitFor(() => expect(menu()?.dataset.show).toBe('true'))
    await tick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(inner.state.doc.content.content.map((n) => n.type.name)).toContain(SIDE_BREAK))
    type(inner, 'Back')
    key(inner.dom, 'Escape')
    expect(card.editing).toBe(false)
    expect(cardBody(view)).toBe('Front\n---\nBack')
  })
})

describe('`/card` with the page`s editor', () => {
  it('the new card opens in the card editor with "Title" selected in its Title field (YAZ-5164 part 3); typing replaces it; Enter goes down to Side 1; Done; ⌘Z takes the text back, the next ⌘Z the card', async () => {
    const { crepe, root, view } = await mount('x\n', { cards: { path: '/v/Page.md', mintId: () => Promise.resolve('WIKI-512') } })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.firstChild!.nodeSize - 1)).insertText('/card'))
    await tick(10)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)))
    await vi.waitFor(() => expect([...root.querySelectorAll('.milkdown-slash-menu .menu-group li')].map((li) => li.textContent?.trim())).toEqual(['Card']))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(cardPos(view)).toBe(0))
    const card = cardBlockViewAt(view, 0)!
    expect(card.editing).toBe(true)
    await card.cardEditor!.ready
    const inner = card.cardEditor!.view()!
    const field = card.dom.querySelector<HTMLInputElement>('.card-editor__title')!
    expect(document.activeElement).toBe(field)
    expect(field.value.slice(field.selectionStart!, field.selectionEnd!)).toBe('Title')
    expect(inner.state.doc.textContent).toBe('')
    await vi.waitFor(() => expect(getMarkdownForSave(crepe)).toBe('```card\nTitle\n```\n<!-- card: WIKI-512 -->\n'))
    field.value = 'Capitals'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    key(field, 'Enter')
    type(inner, 'Capital of {{France}}')
    key(inner.dom, 'Enter', { metaKey: true, shiftKey: true })
    type(inner, 'Paris')
    // The mirror wrote the text into the page meanwhile (out of the undo history).
    await tick(CARD_MIRROR_MS + 50)
    expect(cardText(view)).toBe('Capitals\n\nCapital of {{France}}\n---\nParis')
    card.done()
    expect(getMarkdownForSave(crepe)).toBe('```card\nCapitals\n\nCapital of {{France}}\n---\nParis\n```\n<!-- card: WIKI-512 -->\n')
    undo(view.state, view.dispatch)
    expect(cardText(view)).toBe('Title')
    undo(view.state, view.dispatch)
    expect(cardPos(view)).toBeUndefined()
  })
})

/**
 * YAZ-5164 part 3: Edit card has a Title field above Side 1, for both kinds of card. A card in a page keeps its title as
 * its first line: the field shows it, the editor holds the card without it, and Done writes it back as the first line.
 */
describe('YAZ-5164 part 3: Edit card`s Title field', () => {
  const titleField = (card: CardBlockView) => card.dom.querySelector<HTMLInputElement>('.card-editor__title')

  it('the Title field sits above Side 1 with the title; the editor holds the card without it; nothing changed writes nothing', async () => {
    const { view } = await mount(page('Capital of France\n\nWhich city?\n---\nParis', undefined, ''))
    const { card, inner } = await edit(view)
    const field = titleField(card)!
    expect(field.value).toBe('Capital of France')
    expect(field.compareDocumentPosition(inner.dom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(inner.state.doc.textContent).not.toContain('Capital of France')
    expect(inner.state.doc.textContent).toContain('Which city?')
    card.done()
    expect(cardText(view)).toBe('Capital of France\n\nWhich city?\n---\nParis')
  })

  it('a new title and a new front: Done writes the title as the first line, then the card, one undo step', async () => {
    const { view } = await mount(page('Capital of France\n\nWhich city?\n---\nParis', undefined, ''))
    const { card, inner } = await edit(view)
    const field = titleField(card)!
    field.value = 'France'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    caretAfter(inner, 'Which city?')
    type(inner, ' Name it')
    card.done()
    expect(cardText(view)).toBe('France\n\nWhich city? Name it\n---\nParis')
    undo(view.state, view.dispatch)
    expect(cardText(view)).toBe('Capital of France\n\nWhich city?\n---\nParis')
  })

  it('a card whose first line holds a hidden word: that line stays in the editor; a title typed in the field goes above it', async () => {
    const { view } = await mount(page('The capital is {{Paris}}\n---\nback', undefined, ''))
    const { card, inner } = await edit(view)
    const field = titleField(card)!
    expect(field.value).toBe('The capital is Paris')
    expect(inner.state.doc.textContent).toContain('The capital is')
    field.value = 'Capital'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    card.done()
    expect(cardText(view)).toBe('Capital\n\nThe capital is {{Paris}}\n---\nback')
  })
})
