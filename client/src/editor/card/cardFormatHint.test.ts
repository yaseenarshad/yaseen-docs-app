/**
 * The format hint on a new card (YAZ-5114), against a real page (`createCrepe`) and its real card editor: it shows only
 * on a new, empty card in Edit card, names the first three formats and "N more" of a made-up skill, goes at the first
 * text, stays off with Card tips Off, and its link asks App to open the skill's `formats` folder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { cardBlockViewAt, setCardEditorKind } from './cardBlockView'
import { CARD_FORMATS_OPEN, cardFormatHintText, cardFormatsFor, cardFormatsOpenIn, setCardFormatHints, type CardFormatsOpenRequest } from './cardFormatHint'

/** A made-up skill: eleven formats, as the placeholder skill has, in the order the folder gives them. */
const FORMATS = ['acronym', 'book', 'comparison', 'concept', 'fact', 'person', 'procedure', 'quote', 'script and sounds', 'story', 'vocabulary']
const SKILL = { folder: '/demo/profile/card-skill/formats', formats: FORMATS }

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
beforeEach(() => setCardFormatHints({ on: true, byVault: new Map([['/v', SKILL]]) }))
afterEach(async () => {
  setCardEditorKind('page')
  setCardFormatHints({ on: true, byVault: new Map() })
  while (mounted.length > 0) {
    const m = mounted.pop()!
    await m.crepe.destroy()
    m.root.remove()
  }
})

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function vault() {
  const source = createWikilinkResolveSource()
  source.update(() => null, [], [], true, ['WIKI'])
  return source
}

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

const page = (card: string) => `\`\`\`\`card\n${card}\n\`\`\`\`\n<!-- card: WIKI-7 -->\n`
const hint = (root: HTMLElement) => root.querySelector<HTMLElement>('.card .card__formats')

/** Edit card on the first card; with the page's editor, once it has the card's text. */
async function edit(view: EditorView) {
  const card = cardBlockViewAt(view, 0)!
  card.edit()
  await card.cardEditor?.ready
  return card
}

/** Types `text` at the caret of the card's own editor, as a key press does. */
function type(inner: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = inner.state.selection
    inner.dispatch(inner.state.tr.insertText(ch, from, to))
  }
}

describe('the words of the line (YAZ-5114)', () => {
  it('names the first three formats of the folder and how many more', () => {
    expect(cardFormatHintText(FORMATS)).toBe('Formats in your card skill: acronym · book · comparison · 8 more.')
    expect(cardFormatHintText(['vocabulary', 'concept', 'comparison', 'fact'])).toBe('Formats in your card skill: vocabulary · concept · comparison · 1 more.')
    expect(cardFormatHintText(['quote', 'story'])).toBe('Formats in your card skill: quote · story.')
  })

  it('takes the formats of the vault that holds the page; with no match, the first vault of the window', () => {
    const own = { folder: '/v/Work/Card skill/formats', formats: ['mine'] }
    setCardFormatHints({ byVault: new Map([['/v', SKILL], ['/v/Work', own]]) })
    expect(cardFormatsFor('/v/Work/Deck.md')).toBe(own)
    expect(cardFormatsFor('/v/Deck.md')).toBe(SKILL)
    expect(cardFormatsFor('/elsewhere/Deck.md')).toBe(SKILL)
    expect(cardFormatsFor(null)).toBe(SKILL)
  })

  it('"Learn the formats" opens the vault\'s own skill in Files, and the app\'s copy in Finder', () => {
    expect(cardFormatsOpenIn('/v/Card skill/formats', ['/v'])).toBe('files')
    expect(cardFormatsOpenIn('/v/Card skill/formats', ['/other', '/v/'])).toBe('files')
    expect(cardFormatsOpenIn('/demo/profile/card-skill/formats', ['/v'])).toBe('finder')
    // A vault whose name only starts the same is not the folder's vault.
    expect(cardFormatsOpenIn('/v2/Card skill/formats', ['/v'])).toBe('finder')
  })
})

describe('the hint in Edit card (YAZ-5114)', () => {
  it('/card: the line shows under the key row of the new card, and goes at the first typed character', async () => {
    const { root, view } = await mount('x\n', { cards: { path: '/v/Page.md', mintId: () => Promise.resolve('WIKI-512') } })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)).insertText('/card'))
    await tick(10)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)))
    await vi.waitFor(() => expect(root.querySelector('.milkdown-slash-menu .menu-group li')?.textContent?.trim()).toBe('Card'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const card = await vi.waitFor(() => {
      const c = cardBlockViewAt(view, 0)
      expect(c?.cardEditor).toBeTruthy()
      return c!
    })
    await card.cardEditor!.ready
    const line = hint(root)!
    expect(line.textContent).toBe('Formats in your card skill: acronym · book · comparison · 8 more. Learn the formats')
    // Below the key row, in the card.
    expect(line.previousElementSibling?.classList.contains('card__keys')).toBe(true)
    type(card.cardEditor!.view()!, 'l')
    expect(hint(root)).toBeNull()
    // The hint is UI only: nothing of it reaches the page.
    card.done()
    expect(getMarkdownForSave(mounted[0].crepe)).not.toContain('Formats')
  })

  it('a new card with no text (New card) shows it; Done removes it', async () => {
    const { root, view } = await mount(page(''))
    const card = await edit(view)
    expect(hint(root)?.textContent).toContain('acronym · book · comparison · 8 more.')
    card.done()
    expect(hint(root)).toBeNull()
  })

  it('a card that has text when Edit card opens never shows it', async () => {
    const { root, view } = await mount(page('What is the capital of {{France}}?'))
    const card = await edit(view)
    expect(card.editing).toBe(true)
    expect(hint(root)).toBeNull()
    expect(card.formatHintDom).toBeNull()
  })

  it('Card tips Off: no line on a new card', async () => {
    setCardFormatHints({ on: false })
    const { root, view } = await mount(page(''))
    await edit(view)
    expect(hint(root)).toBeNull()
  })

  it('a skill with no `formats` folder, or an empty one: no line', async () => {
    setCardFormatHints({ byVault: new Map([['/v', null]]) })
    const none = await mount(page(''))
    await edit(none.view)
    expect(hint(none.root)).toBeNull()
    setCardFormatHints({ byVault: new Map([['/v', { folder: '/v/Card skill/formats', formats: [] }]]) })
    const empty = await mount(page(''))
    await edit(empty.view)
    expect(hint(empty.root)).toBeNull()
  })

  it('the names follow the folder of the skill in use', async () => {
    setCardFormatHints({ byVault: new Map([['/v', { folder: '/v/Card skill/formats', formats: ['recipe', 'verb'] }]]) })
    const { root, view } = await mount(page(''))
    await edit(view)
    expect(hint(root)?.textContent).toBe('Formats in your card skill: recipe · verb. Learn the formats')
  })

  it('"Learn the formats" sends ONE bubbling event with the skill\'s formats folder, and does not select the card', async () => {
    const { root, view } = await mount(page(''))
    const card = await edit(view)
    const heard: CardFormatsOpenRequest[] = []
    const listen = (e: Event) => heard.push((e as CustomEvent<CardFormatsOpenRequest>).detail)
    document.addEventListener(CARD_FORMATS_OPEN, listen)
    try {
      hint(root)!.querySelector('button')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    } finally {
      document.removeEventListener(CARD_FORMATS_OPEN, listen)
    }
    expect(heard).toEqual([{ folder: SKILL.folder }])
    expect(card.editing).toBe(true)
  })

  it('the raw-text editor: the line shows on a new card and goes when the card has text', async () => {
    setCardEditorKind('code')
    const { root, view } = await mount(page(''))
    const card = await edit(view)
    expect(card.editingText).toBe(true)
    expect(hint(root)).not.toBeNull()
    const pos = view.state.selection.from
    view.dispatch(view.state.tr.insertText(' of the river', pos))
    expect(hint(root)).toBeNull()
  })
})
