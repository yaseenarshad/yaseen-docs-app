/**
 * The card block in the page (YAZ-4961), against a real editor (`createCrepe`): the slash row and its ID, the card
 * line's round trip, the ⋯ menu, the pills, the outside write of the sweep, and the one render function the Inbox reuses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { undo, undoDepth } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, cardLook, type CreateCrepeOptions } from '../createCrepe'
import { applyExternalMarkdown } from '../external/applyExternalMarkdown'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import { CrepeFeature } from '../crepe'
import { features } from '../featureConfig'
import { CARD_OPEN, CARD_TITLE_PLACEHOLDER, cardLanguage, cardBlockViewAt, setCardEditorKind, type CardOpenRequest } from './cardBlockView'
import { refreshCardLook, renderCard } from './cardRender'
import { READ_ONLY_EDIT, type ReadOnlyEditEvent } from '../readOnlyEdit'
import { CARD_PREVIEW, type CardPreviewRequest } from './cardOpen'
import { pageCards } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'


/** A read-only page's ⋯ writes the card line to the file (`changeCardLine`): here it is only heard. */
const fileWrites = vi.hoisted(() => [] as Array<{ path: string; id: string; index: number | undefined; line: string | null }>)
vi.mock('../../review/cardFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../review/cardFile')>()),
  changeCardLine: async (path: string, id: string, change: (l: import('@shared/cardLine').CardLine) => import('@shared/cardLine').CardLine, index?: number) => {
    const { formatCardLine, parseCardLine } = await import('@shared/cardLine')
    fileWrites.push({ path, id, index, line: formatCardLine(change(parseCardLine('<!-- card: WIKI-7, 2026-11-12T14:05Z good -->')!)) })
  },
}))

/** The page's file for the Reviews delete (YAZ-5000): the real card-line transforms, on bytes in memory. */
const disk = vi.hoisted(() => new Map<string, string>())
vi.mock('../../views/writeProperty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../views/writeProperty')>()),
  transformFile: async (path: string, transform: (content: string) => string) => {
    const next = transform(disk.get(path) ?? '')
    disk.set(path, next)
    return { mtime: 1, content: next }
  },
}))

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

afterEach(async () => {
  setCardEditorKind('page')
  while (mounted.length > 0) {
    const current = mounted.pop()!
    await current.crepe.destroy()
    current.root.remove()
  }
})

/** An index that knows one page, "France", in a vault that gives IDs (or not). */
function vault(ids: boolean) {
  const source = createWikilinkResolveSource()
  source.update((target) => (target === 'France' ? '/v/France.md' : null), [], [], ids, ids ? ['WIKI'] : [])
  return source
}

async function mount(markdown: string, opts: Partial<CreateCrepeOptions> = {}): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, image: { root: '/v', pagePath: '/v/Page.md' }, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  return { crepe, root, view }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** Types `typed` as the whole text of the first paragraph, the caret after it (the slash menu's own way in). */
async function typeSlash(view: EditorView, typed: string): Promise<void> {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.firstChild!.nodeSize - 1)).insertText(typed))
  await tick(10)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + typed.length)))
}

const slashRows = (root: HTMLElement) => [...(root.querySelector('.milkdown-slash-menu')?.querySelectorAll('.menu-group li') ?? [])].map((li) => li.textContent?.trim() ?? '')

/** The first card's position. */
function cardPos(view: EditorView): number {
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === 'code_block' && node.attrs.language === 'card') at = pos
    return at === -1
  })
  return at
}

const CARD = '```card\nWhat is the capital of {{France}}?\n---\nParis\n```\n'

describe('the "Card" slash row (D1, idea 9)', () => {
  it('/card and /card find one row in a vault with IDs; it inserts a card that starts with its title line and takes its ID at once, and one ⌘Z removes it', async () => {
    // The raw-text fallback (YAZ-5026: `setCardEditorKind('code')`); the page's editor is `cardEditor.test.ts`.
    setCardEditorKind('code')
    let mint = (_path: string): Promise<string> => Promise.resolve('WIKI-512')
    const mintId = vi.fn((path: string) => mint(path))
    const { crepe, root, view } = await mount('x\n', { wikilinks: vault(true), cards: { path: '/v/Page.md', mintId } })
    for (const typed of ['/card', '/card']) {
      await typeSlash(view, typed)
      await vi.waitFor(() => expect(slashRows(root)).toEqual(['Card']))
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(cardPos(view)).toBe(0))
    expect(mintId).toHaveBeenCalledWith('/v/Page.md')
    // The card is edited at once: Crepe's code editor in the card, the caret in its text.
    expect(cardBlockViewAt(view, 0)?.editing).toBe(true)
    expect(view.state.selection.$from.parent.attrs.language).toBe('card')
    // YAZ-5030: the card starts with its title line, "Title", selected whole, so typing replaces it.
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe(CARD_TITLE_PLACEHOLDER)
    expect(view.state.selection.from).toBe(1)
    // The ID lands without any sweep, on the line under the fence.
    await vi.waitFor(() => expect(getMarkdownForSave(crepe)).toBe('```card\nTitle\n```\n<!-- card: WIKI-512 -->\n'))
    // The ID is out of the undo history: one ⌘Z takes the card away whole.
    undo(view.state, view.dispatch)
    expect(cardPos(view)).toBe(-1)
    // A door that fails leaves the card with no line: the sweep is the safety net.
    mint = () => Promise.reject(new Error('no IDs'))
  })

  it('hides in a vault without IDs, and in an editor whose host gives no cards', async () => {
    const plain = await mount('x\n', { wikilinks: vault(false), cards: { path: '/v/Page.md', mintId: () => Promise.resolve('WIKI-1') } })
    await typeSlash(plain.view, '/card')
    await tick(60)
    expect(slashRows(plain.root)).not.toContain('Card')
    await typeSlash(plain.view, '/code')
    await vi.waitFor(() => expect(slashRows(plain.root)).toContain('Code'))
    const noHost = await mount('x\n', { wikilinks: vault(true) })
    await typeSlash(noHost.view, '/code')
    await vi.waitFor(() => expect(slashRows(noHost.root)).toContain('Code'))
    expect(slashRows(noHost.root)).not.toContain('Card')
  })

  it('D8: in a vault without IDs a ```card block is a plain code block: no card head, no ⋯, no Edit card', async () => {
    const { root } = await mount(`${CARD}<!-- card: WIKI-7 -->\n`, { wikilinks: vault(false), cards: { path: '/v/Page.md' } })
    expect(root.querySelector('.card')).toBeNull()
    expect(root.querySelector('.milkdown-code-block')).not.toBeNull()
  })
})

describe('the card line (load and save)', () => {
  it('joins the block on load and comes back byte for byte on save: unknown parts, a card in a bullet, a code comment, other code untouched', async () => {
    const md = [
      'Intro',
      '',
      '```card',
      'What is **the {{capital}} of** [[France]]?',
      '---',
      'Paris',
      '```',
      '<!-- card: WIKI-5, 2026-11-12T14:05Z good, mochi abc,  off -->',
      '<!-- code: width 900 -->',
      '',
      '* A bullet',
      '',
      '  ```card',
      '  Q',
      '  ```',
      '  <!-- card: WIKI-6 -->',
      '',
      '```js',
      'const card = 1',
      '```',
      '',
    ].join('\n')
    const { crepe, view } = await mount(md)
    const lines: unknown[] = []
    view.state.doc.descendants((node) => {
      if (node.type.name === 'code_block') lines.push([node.attrs.language, node.attrs.cardLine])
    })
    // The lines are the cards' attributes, not HTML blocks of the page (so line numbers match the worker, idea 29).
    expect(lines).toEqual([
      ['card', '<!-- card: WIKI-5, 2026-11-12T14:05Z good, mochi abc,  off -->'],
      ['card', '<!-- card: WIKI-6 -->'],
      ['js', null],
    ])
    expect(view.dom.querySelectorAll('.milkdown-html-block, [data-type="html"]')).toHaveLength(0)
    expect(getMarkdownForSave(crepe)).toBe(md)
  })
})

describe('a card fence never closed (the look-by-eye item 1)', () => {
  it('draws as a card, and the first save writes its closing fence: then the index reads it as a card and the sweep gives its ID', async () => {
    const { crepe, root } = await mount('Intro\n\n```card\nFront\n---\nBack')
    expect(root.querySelector('.card')).not.toBeNull()
    const saved = getMarkdownForSave(crepe)
    expect(saved).toBe('Intro\n\n```card\nFront\n---\nBack\n```\n')
    expect(pageCards(saved).map((c) => c.text)).toEqual(['Front\n---\nBack'])
  })
})

describe('the card in the page', () => {
  it('draws the head and the sides; hidden words highlighted; a link is the page pill that opens in Explore, ⌘-click in a tab', async () => {
    const follow: Array<[string, string]> = []
    const { view } = await mount(CARD.replace('{{France}}', '{{France}} ([[France]], [[Gone]])'), {
      wikilinks: vault(true),
      wikilinkNav: { root: '/v', createFolder: () => '', openCurrent: (p) => follow.push(['thisTab', p]), openBackground: (p) => follow.push(['backgroundTab', p]), openExplore: (p) => follow.push(['explore', p]), onNotice: () => {} },
    })
    const card = view.dom.querySelector<HTMLElement>('.card')!
    // The head does not repeat the card's first line: the text is right below it.
    expect(card.querySelector('.card__title')).toBeNull()
    const shown = (el: Element | null) => [...(el?.children ?? [])].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent).join('')
    expect(shown(card.querySelector('.card__head'))).toBe('Edit card⋯')
    expect([...card.querySelectorAll('.card__side')].map((side) => side.textContent?.trim())).toEqual(['What is the capital of France (France, Gone)?', 'Paris'])
    expect(card.querySelector('.card__rule')).not.toBeNull()
    expect(card.querySelector('.card__hidden')?.textContent).toBe('France')
    // No CodeMirror until "Edit card" (idea 25).
    expect(card.querySelector('.cm-editor')).toBeNull()
    const [found, gone] = [...card.querySelectorAll<HTMLElement>('.wikilink')]
    expect(found.classList.contains('wikilink--unresolved')).toBe(false)
    expect(gone.classList.contains('wikilink--unresolved')).toBe(true)
    found.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    found.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, metaKey: true }))
    expect(follow).toEqual([
      ['explore', '/v/France.md'],
      ['backgroundTab', '/v/France.md'],
    ])
  })

  it('YAZ-5015: a board embed is its picture, and a click opens the board in Explore as its link (⌘-click a tab); YAZ-5014: a press on a sound`s player selects no card', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    try {
      const follow: Array<[string, string]> = []
      // A board is a view-only file: its link resolves through the view-only catalog, as in the app.
      const viewOnlyLinks = createViewOnlyLinkSource()
      viewOnlyLinks.update({ entries: [], resolve: (target: string) => (target === 'Card loop.excalidraw' ? '/v/Card loop.excalidraw' : null) } as never)
      const { view } = await mount('```card\nThe loop\n---\n![[Card loop.excalidraw]] ![[tone.mp3]]\n```\n', {
        wikilinks: vault(true),
        viewOnlyLinks,
        wikilinkNav: { root: '/v', createFolder: () => '', openCurrent: (p) => follow.push(['thisTab', p]), openBackground: (p) => follow.push(['backgroundTab', p]), openExplore: (p) => follow.push(['explore', p]), onNotice: () => {} },
      })
      const card = view.dom.querySelector<HTMLElement>('.card')!
      const board = card.querySelector<HTMLElement>('.card__board')!
      expect(board.querySelector('img')?.getAttribute('loading')).toBe('lazy')
      board.querySelector('img')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      board.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, metaKey: true }))
      expect(follow).toEqual([
        ['explore', '/v/Card loop.excalidraw'],
        ['backgroundTab', '/v/Card loop.excalidraw'],
      ])
      card.querySelector('.card__audio-name')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      expect(card.classList.contains('ProseMirror-selectednode')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('D20: the head shows the card ID first, small and grey; a click copies it and opens nothing; a card with no ID shows none', async () => {
    const { root } = await mount(`${CARD}<!-- card: WIKI-7 -->\n`, { cards: { path: '/v/Page.md' } })
    const id = root.querySelector<HTMLButtonElement>('.card__head > .card__id:first-child')!
    expect([id.textContent, id.hidden]).toEqual(['WIKI-7', false])
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const opened: unknown[] = []
    const onOpen = (e: Event) => opened.push(e)
    document.addEventListener(CARD_OPEN, onOpen)
    id.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    document.removeEventListener(CARD_OPEN, onOpen)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('WIKI-7')
    expect(opened).toEqual([])
    const bare = await mount(CARD, { cards: { path: '/v/Page.md' } })
    expect(bare.root.querySelector<HTMLButtonElement>('.card__id')?.hidden).toBe(true)
  })

  it('YAZ-5152: ⋯ › Preview, P on the selected card, and Edit card\'s Preview each send the one preview ask, with the card as shown (the typed text in Edit card); none writes', async () => {
    const { crepe, root, view } = await mount(`${CARD}<!-- card: WIKI-7, notitle, 2026-11-12T14:05Z good -->\n`, { cards: { path: '/v/Page.md' } })
    const asks: CardPreviewRequest[] = []
    document.addEventListener(CARD_PREVIEW, (e) => asks.push((e as CustomEvent<CardPreviewRequest>).detail))
    const before = getMarkdownForSave(crepe)
    root.querySelector<HTMLElement>('.card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    const row = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith('Preview'))!
    expect(row.textContent).toContain('P')
    row.click()
    expect(asks).toEqual([{ path: '/v/Page.md', id: 'WIKI-7', text: 'What is the capital of {{France}}?\n---\nParis', notitle: true, reviews: [{ at: '2026-11-12T14:05Z', rating: 'good' }] }])
    // P with the card selected: Preview, and the card is not typed over.
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, cardPos(view))))
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }))
    expect(asks).toHaveLength(2)
    expect(getMarkdownForSave(crepe)).toBe(before)
    // Edit card: its head has Preview beside Done (none while reading).
    const preview = () => root.querySelector<HTMLButtonElement>('.card__preview')!
    expect(preview().hidden).toBe(true)
    cardBlockViewAt(view, cardPos(view))!.edit()
    expect(preview().hidden).toBe(false)
    preview().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(asks).toHaveLength(3)
    expect(asks[2].text).toContain('What is the capital of {{France}}?')
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('the ⋯ menu changes the card line in one undo step each; Copy card ID; Open card sends the one hook', async () => {
    const { crepe, root, view } = await mount(`${CARD}<!-- card: WIKI-7, 2026-11-12T14:05Z good, kept -->\n`, { cards: { path: '/v/Page.md' } })
    const run = (label: string) => {
      root.querySelector<HTMLElement>('.card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      const row = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith(label))!
      row.click()
    }
    const line = () => getMarkdownForSave(crepe).split('\n').find((l) => l.startsWith('<!-- card'))
    run('Archive card')
    expect(line()).toBe('<!-- card: WIKI-7, off, 2026-11-12T14:05Z good, kept -->')
    // YAZ-5046: an archived card says "Archived" in its head and looks muted.
    expect(root.querySelector('.card__state')?.textContent).toBe('Archived')
    expect(root.querySelector('.card')?.classList.contains('card--off')).toBe(true)
    run('Reset history')
    expect(line()).toBe('<!-- card: WIKI-7, off, kept -->')
    undo(view.state, view.dispatch)
    expect(line()).toBe('<!-- card: WIKI-7, off, 2026-11-12T14:05Z good, kept -->')
    run('Unarchive card')
    expect(line()).toBe('<!-- card: WIKI-7, 2026-11-12T14:05Z good, kept -->')
    expect(root.querySelector('.card__state')?.textContent).toBe('')
    expect(root.querySelector('.card')?.classList.contains('card--off')).toBe(false)
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    run('Copy card ID')
    expect(writeText).toHaveBeenCalledWith('WIKI-7')
    const opened: CardOpenRequest[] = []
    document.addEventListener(CARD_OPEN, (e) => opened.push((e as CustomEvent<CardOpenRequest>).detail), { once: true })
    run('Open card')
    expect(opened).toEqual([{ path: '/v/Page.md', cardId: 'WIKI-7', index: 0 }])
  })

  it('YAZ-5030: ⋯ "Title on the front" Show / Hide sets and removes `notitle` in one undo step; the head says "Title hidden in review"; the card still shows its title', async () => {
    const { crepe, root, view } = await mount(`${CARD}<!-- card: WIKI-7, 2026-11-12T14:05Z good -->\n`, { cards: { path: '/v/Page.md' } })
    const rowOf = () => {
      root.querySelector<HTMLElement>('.card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      return [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith('Title on the front'))!
    }
    const line = () => getMarkdownForSave(crepe).split('\n').find((l) => l.startsWith('<!-- card'))
    const mark = () => root.querySelector<HTMLElement>('.card__notitle')!
    expect(mark().hidden).toBe(true)
    const row = rowOf()
    expect(row.dataset.hint).toBe('Show')
    row.click()
    expect(line()).toBe('<!-- card: WIKI-7, notitle, 2026-11-12T14:05Z good -->')
    expect([mark().hidden, mark().textContent]).toEqual([false, 'Title hidden in review'])
    // The page shows the whole card, its first line too.
    expect(root.querySelector('.card__body')?.textContent).toContain('What is the capital of')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(rowOf().dataset.hint).toBe('Hide')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    undo(view.state, view.dispatch)
    expect([line(), mark().hidden]).toEqual(['<!-- card: WIKI-7, 2026-11-12T14:05Z good -->', true])
  })

  it('YAZ-4999: ⋯ Put at top of Inbox and the chip`s × set and remove `next`, each in one undo step; read only, they write the FILE', async () => {
    const { crepe, root, view } = await mount(`${CARD}<!-- card: WIKI-7, 2026-11-12T14:05Z good -->\n`, { cards: { path: '/v/Page.md' } })
    const rowOf = (label: string) => {
      root.querySelector<HTMLElement>('.card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      return [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith(label))
    }
    const line = () => getMarkdownForSave(crepe).split('\n').find((l) => l.startsWith('<!-- card'))
    const chip = () => root.querySelector<HTMLElement>('.card__next')!
    const remove = () => chip().querySelector('.card__next-remove')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(chip().hidden).toBe(true)
    rowOf('Put at top of Inbox')!.click()
    expect(line()).toBe('<!-- card: WIKI-7, next, 2026-11-12T14:05Z good -->')
    expect([chip().hidden, chip().textContent]).toEqual([false, 'Up next×'])
    expect(chip().querySelector('button')?.getAttribute('aria-label')).toBe('Remove from top of Inbox')
    undo(view.state, view.dispatch)
    expect([line(), chip().hidden]).toEqual(['<!-- card: WIKI-7, 2026-11-12T14:05Z good -->', true])
    rowOf('Put at top of Inbox')!.click()
    expect(rowOf('Remove from top of Inbox')).toBeDefined()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    remove()
    expect([line(), chip().hidden]).toEqual(['<!-- card: WIKI-7, 2026-11-12T14:05Z good -->', true])
    undo(view.state, view.dispatch)
    expect(line()).toBe('<!-- card: WIKI-7, next, 2026-11-12T14:05Z good -->')
    // Read only: the mark is review, not text — the file is written (no question asked).
    fileWrites.length = 0
    crepe.setReadonly(true)
    remove()
    await tick()
    expect(fileWrites).toEqual([{ path: '/v/Page.md', id: 'WIKI-7', index: 0, line: '<!-- card: WIKI-7, 2026-11-12T14:05Z good -->' }])
  })

  it('read only locks the card`s text, not its review: no Edit card; ⋯ Archive card and Reset history write the FILE', async () => {
    fileWrites.length = 0
    const { crepe, root } = await mount(`${CARD}<!-- card: WIKI-7, 2026-11-12T14:05Z good -->\n`, { cards: { path: '/v/Page.md' } })
    crepe.setReadonly(true)
    const run = (label: string) => {
      root.querySelector<HTMLElement>('.card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      const row = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith(label))!
      expect(row.disabled).toBe(false)
      row.click()
    }
    run('Archive card')
    run('Reset history')
    await tick()
    expect(fileWrites).toEqual([
      { path: '/v/Page.md', id: 'WIKI-7', index: 0, line: '<!-- card: WIKI-7, off, 2026-11-12T14:05Z good -->' },
      { path: '/v/Page.md', id: 'WIKI-7', index: 0, line: '<!-- card: WIKI-7 -->' },
    ])
    // The editor's own text is untouched: the file write comes back as an outside change.
    expect(getMarkdownForSave(crepe)).toContain('<!-- card: WIKI-7, 2026-11-12T14:05Z good -->')
  })

  it('Edit card is Crepe\'s code editor (made only then); YAZ-5001: ⌘↵ there is Done, while ⌘↵ in another code block still adds a line; the head says "Done esc ⌘↵"', async () => {
    // The raw-text fallback (YAZ-5026: `setCardEditorKind('code')`); the page's editor is `cardEditor.test.ts`.
    setCardEditorKind('code')
    const { root, view } = await mount(`${CARD}<!-- card: WIKI-8 -->\n\n\`\`\`js\nx\n\`\`\`\n`, { cards: { path: '/v/Page.md' } })
    const card = root.querySelector<HTMLElement>('.card')!
    const edit = () => card.querySelector('.card__edit')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    edit()
    const cm = card.querySelector<HTMLElement>('.cm-content')!
    expect(cm.textContent).toContain('What is the capital of {{France}}?')
    expect([...card.querySelectorAll('.card__edit kbd')].map((k) => k.textContent)).toEqual(['Esc', 'Cmd', 'Enter'])
    expect(card.querySelector('.card__edit')?.textContent).toBe('DoneEscCmd + Enter')
    // The card language: Markdown with spell check (idea 8), once the language loads.
    await vi.waitFor(() => expect(cm.getAttribute('spellcheck')).toBe('true'))
    const opened: CardOpenRequest[] = []
    const listen = (e: Event) => opened.push((e as CustomEvent<CardOpenRequest>).detail)
    document.addEventListener(CARD_OPEN, listen)
    const modEnter = (el: HTMLElement) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
    const doc = view.state.doc
    modEnter(cm)
    // Done: the card draws again, selected; nothing opens and the text is the same.
    expect(card.querySelector('.cm-editor')).toBeNull()
    expect(card.querySelector('.card__edit')?.textContent).toBe('Edit card')
    expect(card.querySelector('.card__hidden')?.textContent).toBe('France')
    expect(view.state.doc.eq(doc)).toBe(true)
    expect(view.state.selection.from).toBe(0)
    expect(opened).toEqual([])
    // Another code block keeps its ⌘↵: a line below it (YAZ-4800).
    view.focus()
    const js = [...root.querySelectorAll<HTMLElement>('.milkdown-code-block')].find((b) => !card.contains(b))!
    let jsPos = -1
    view.state.doc.forEach((node, pos) => {
      if (node.attrs.language === 'js') jsPos = pos
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, jsPos + 2)))
    await vi.waitFor(() => expect(js.querySelector('.cm-content')).not.toBeNull())
    const blocks = view.state.doc.childCount
    modEnter(js.querySelector<HTMLElement>('.cm-content')!)
    expect(view.state.doc.childCount).toBe(blocks + 1)
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(opened).toEqual([])
    // Done by its button draws the card again too; then the card selected, ⌘↵ in the page opens it (D13).
    edit()
    expect(card.querySelector('.cm-editor')).not.toBeNull()
    edit()
    expect(card.querySelector('.cm-editor')).toBeNull()
    expect(view.state.selection.from).toBe(0)
    modEnter(view.dom)
    expect(opened).toEqual([{ path: '/v/Page.md', cardId: 'WIKI-8', index: 0 }])
    document.removeEventListener(CARD_OPEN, listen)
  })

  it("YAZ-5008: in Edit card a selection (a drag, a double or triple click) stays CodeMirror's and the page's TEXT selection, never the card's node selection; ⌘L wraps it", async () => {
    // The raw-text fallback (YAZ-5026: `setCardEditorKind('code')`); the page's editor is `cardEditor.test.ts`.
    setCardEditorKind('code')
    const { EditorView: CodeMirrorView } = await import('@codemirror/view')
    const { root, view } = await mount(`${CARD}<!-- card: WIKI-8 -->\n`, { cards: { path: '/v/Page.md' } })
    const card = root.querySelector<HTMLElement>('.card')!
    card.querySelector('.card__edit')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    const cm = CodeMirrorView.findFromDOM(card.querySelector<HTMLElement>('.cm-editor')!)!
    await vi.waitFor(() => expect(cm.contentDOM.getAttribute('spellcheck')).toBe('true'))
    const text = cm.state.doc.toString()
    const from = text.indexOf('capital')
    cm.dispatch({ selection: { anchor: from, head: from + 'capital'.length }, userEvent: 'select.pointer' })
    expect(view.state.selection.constructor.name).toBe('TextSelection')
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('capital')
    expect(card.classList.contains('ProseMirror-selectednode')).toBe(false)
    expect(cm.state.selection.main).toMatchObject({ from, to: from + 'capital'.length })
    cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true, cancelable: true }))
    expect(cm.state.doc.toString()).toContain('the {{capital}} of')
    expect(view.state.doc.textContent).toContain('the {{capital}} of')
  })

  it('draws the same in a read-only preview (idea 10: the hover preview, QuickLook, read-only pages mount this editor), with no Edit card', async () => {
    // `useReadOnlyPage.ts`'s features and its read-only switch.
    const { crepe, root } = await mount(CARD, { features: { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }, wikilinks: vault(true) })
    crepe.setReadonly(true)
    expect(root.querySelector('.card__hidden')?.textContent).toBe('France')
    expect(root.querySelectorAll('.card__side')).toHaveLength(2)
    expect(root.querySelector('.ProseMirror[contenteditable="false"] .card__edit')).not.toBeNull() // hidden by card.css
    root.querySelector('.card__edit')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(root.querySelector('.card .cm-editor')).toBeNull()
  })

  it('YAZ-5145 round 2: Edit card in a page locked by Read only is an edit attempt that carries itself; once the page is editable, the attempt opens Edit card, with no second double-click', async () => {
    const { crepe, root } = await mount(CARD)
    crepe.setReadonly(true)
    const told: ReadOnlyEditEvent[] = []
    root.addEventListener(READ_ONLY_EDIT, (e) => told.push(e as ReadOnlyEditEvent))
    root.querySelector('.card__body')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(told.map((e) => e.detail)).toEqual(['card'])
    expect(root.querySelector('.card--editing')).toBeNull()
    // The chip's "Allow edits" unlocks the page, then runs what the attempt carried.
    crepe.setReadonly(false)
    told[0].resume?.()
    await vi.waitFor(() => expect(root.querySelector('.card--editing')).not.toBeNull())
  })

  it("the sweep's write of the open page lands as one change of the card's line, the text around it kept", async () => {
    const { crepe, view } = await mount(`# Page\n\nSome text above the card.\n\n${CARD}\nMore text below.\n`)
    const before = view.state.doc.child(0)
    const result = applyExternalMarkdown(crepe, `# Page\n\nSome text above the card.\n\n${CARD}<!-- card: WIKI-9 -->\n\nMore text below.\n`)
    expect(result).toBe('applied')
    expect(view.state.doc.child(0).eq(before)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(`# Page\n\nSome text above the card.\n\n${CARD}<!-- card: WIKI-9 -->\n\nMore text below.\n`)
    expect(view.state.doc.nodeAt(cardPos(view))?.attrs.cardLine).toBe('<!-- card: WIKI-9 -->')
    expect(view.dom.querySelector('.card__side')?.textContent).toContain('capital')
  })
})

describe('"Reviews (n)" under the card in the page (YAZ-5000)', () => {
  // YAZ-5033: the last review has its seconds (64 s); the older ones have none.
  const LINE = '<!-- card: WIKI-7, 2026-11-01T09:00Z good, 2026-11-05T09:00Z again 13s, 2026-11-06T09:00Z good 64s -->'
  const PAGE = `# Page\n\n${CARD}${LINE}\n\nAfter.\n`
  const settings = () => DEFAULT_REVIEW_SETTINGS
  const header = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.card .card-reviews .backlinks__header')
  // YAZ-5105 round 4: the strip is the Inbox's own `CardReviews` (a React root): a click toggles it, as there.
  const press = (el: Element) => (el as HTMLElement).click()
  /** Each row's answer (its glyph's word, the hover) — '' for the review to come. */
  const rows = (root: HTMLElement) => [...root.querySelectorAll('.card-reviews__table tbody tr')].map((tr) => tr.querySelector('.card-answer')?.getAttribute('title') ?? '')
  const cells = (root: HTMLElement) => [...root.querySelectorAll('.card-reviews__table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))

  it('a card with reviews shows "✓ 3 Reviews" closed, with no table, and the strip on the same row (YAZ-5032); a card with none shows no section; a preview with no door shows none', async () => {
    const { root } = await mount(`${PAGE}\n\`\`\`card\nAnother\n\`\`\`\n<!-- card: WIKI-8 -->\n`, { cards: { path: '/v/Page.md' }, cardReviews: { settings, deleteReview: vi.fn() } })
    const cards = root.querySelectorAll('.card')
    expect(cards).toHaveLength(2)
    await vi.waitFor(() => expect(header(root)?.textContent).toBe('3 Reviews'))
    // YAZ-5105 round 4: the ONE strip (the Inbox's), its host right after the card's text, so the text tucks over it.
    const strip = cards[0].querySelector('.card-reviews')!
    expect(strip.classList.contains('card-reviews--strip')).toBe(true)
    expect(strip.parentElement?.classList.contains('card__reviews')).toBe(true)
    expect(strip.parentElement?.previousElementSibling?.classList.contains('card__body')).toBe(true)
    expect(header(root)?.querySelector('svg')).not.toBeNull()
    expect(header(root)?.getAttribute('aria-expanded')).toBe('false')
    expect(root.querySelector('.card-reviews__table')).toBeNull()
    // Closed, the facts show as one line of words (YAZ-5032; round 2: no "Last"): when it is due, the recall chance with its (i).
    await vi.waitFor(() => expect(cards[0].querySelector('.card-reviews__facts .card-strip__line')).not.toBeNull())
    const facts = cards[0].querySelector('.card-reviews__facts')!
    expect(facts.textContent).toMatch(/^Due (today|later today|(tomorrow|yesterday|in \d+ days|\d+ days ago) \([A-Z][a-z]{2} \d{1,2}, \d{4}\)) · \d+% chance you remember it$/)
    // The (i) is the app's own tip (round 2: a native title shows nothing in the app); no other hover to puzzle out.
    expect(facts.querySelector('.card-strip__info .info-tip__button')).not.toBeNull()
    expect(facts.querySelectorAll('[title]')).toHaveLength(0)
    expect(facts.querySelectorAll('svg')).toHaveLength(1)
    expect(cards[1].querySelector('.card-reviews')).toBeNull()
    const preview = await mount(PAGE, { cards: { path: '/v/Page.md' } })
    expect(preview.root.querySelector('.card-reviews')).toBeNull()
  })

  it('a click opens the card window`s table with each review and the upcoming row; open and closed are no change of the page and no undo step', async () => {
    const { crepe, root, view } = await mount(PAGE, { cards: { path: '/v/Page-open.md' }, cardReviews: { settings, deleteReview: vi.fn() } })
    const doc = view.state.doc
    await vi.waitFor(() => expect(header(root)).not.toBeNull())
    press(header(root)!)
    await vi.waitFor(() => expect(rows(root)).toEqual(['Remembered', 'Forgot', 'Remembered', '']))
    await vi.waitFor(() => expect(header(root)?.getAttribute('aria-expanded')).toBe('true'))
    // YAZ-5032, Yaseen's columns: Reviewed on · Answer · Gap · Time · Next due. Dates in full; the answer's glyph and
    // word; the Gap blank for the first, "Same day" for 0; the review to come in words, with no delete.
    expect([...root.querySelectorAll('.card-reviews__table th')].map((th) => th.textContent)).toEqual(['Reviewed on', 'Answer', 'Gap', 'Time', 'Next due', ''])
    const table = cells(root)
    expect(table.slice(0, 3).map((r) => r.slice(0, 4))).toEqual([
      ['Nov 1, 2026', 'Remembered', '', '—'],
      ['Nov 5, 2026', 'Forgot', '4 days', '13 s'],
      ['Nov 6, 2026', 'Remembered', '1 day', '1 min 4 s'],
    ])
    expect(table[0][4]).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/)
    expect(table[3][0]).toMatch(/^Due (today|later today|(tomorrow|yesterday|in \d+ days|\d+ days ago) \([A-Z][a-z]{2} \d{1,2}, \d{4}\))$/)
    const trs = root.querySelectorAll('.card-reviews__table tbody tr')
    expect([...trs].map((tr) => tr.querySelector('button')?.getAttribute('title') ?? null)).toEqual(['Remove this review', 'Remove this review', 'Remove this review', null])
    expect(trs[3].classList.contains('card-reviews__next')).toBe(true)
    expect(view.state.doc).toBe(doc)
    expect(undoDepth(view.state)).toBe(0)
    expect(root.querySelector('.card')?.classList.contains('ProseMirror-selectednode')).toBe(false)
    press(header(root)!)
    await vi.waitFor(() => expect(root.querySelector('.card-reviews__table')).toBeNull())
    expect(getMarkdownForSave(crepe)).toBe(PAGE)
  })

  it('works read only: × deletes through the vault`s door (the file), the open table follows the new line, and Undo puts the file back byte for byte', async () => {
    const path = '/v/Page-delete.md'
    disk.set(path, PAGE)
    let undoDelete: (() => Promise<unknown>) | null = null
    const { deleteCardReview, restoreCardReview } = await import('../../review/cardFile')
    const deleteReview = vi.fn(async (p: string, id: string, review: import('@shared/cardLine').CardReview) => {
      const at = await deleteCardReview(p, id, review.at)
      undoDelete = () => restoreCardReview(p, id, review, at)
    })
    const { crepe, root } = await mount(PAGE, { cards: { path }, cardReviews: { settings, deleteReview } })
    crepe.setReadonly(true)
    await vi.waitFor(() => expect(header(root)).not.toBeNull())
    press(header(root)!)
    await vi.waitFor(() => expect(rows(root)).toHaveLength(4))
    root.querySelectorAll<HTMLButtonElement>('.card-reviews__table tbody button')[1].click()
    // YAZ-5032 round 2: the bin asks first, and says what the remove does.
    await vi.waitFor(() => expect(document.querySelector('.confirm .confirm__title')?.textContent).toBe('Remove the review of Nov 5, 2026?'))
    expect(deleteReview).not.toHaveBeenCalled()
    ;[...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === 'Remove review')!.click()
    await vi.waitFor(() => expect(document.querySelector('.confirm')).toBeNull())
    expect(deleteReview).toHaveBeenCalledWith(path, 'WIKI-7', { at: '2026-11-05T09:00Z', rating: 'again', seconds: 13 })
    await vi.waitFor(() => expect(disk.get(path)).toBe(PAGE.replace(' 2026-11-05T09:00Z again 13s,', '')))
    // The app merges its own write into the open page: the section counts again, and the open table shows the new rows.
    expect(applyExternalMarkdown(crepe, disk.get(path)!)).toBe('applied')
    await vi.waitFor(() => expect(rows(root)).toEqual(['Remembered', 'Remembered', '']))
    await vi.waitFor(() => expect(root.querySelector('.card-reviews')?.querySelector('.backlinks__title')?.textContent).toBe('2 Reviews'))
    await undoDelete!()
    expect(disk.get(path)).toBe(PAGE)
  })
})

describe('the card editor`s language (idea 8)', () => {
  it('is Markdown with no setext heading: the front line above --- is no heading; a # line still is', async () => {
    const { language } = await cardLanguage.load()
    const kinds = (text: string) => {
      const names: string[] = []
      language.parser.parse(text).iterate({ enter: (n) => void names.push(n.name) })
      return names
    }
    expect(kinds('Front\n---\nBack').some((n) => n.startsWith('SetextHeading'))).toBe(false)
    expect(kinds('# Front\n---\nBack')).toContain('ATXHeading1')
  })
})

describe('renderCard (the page and the Inbox, D18)', () => {
  const text = '**bold {{one}} more**\n\n* an item with {{two}}\n* [a link {{three}}](https://example.com)\n---\nBack {{four}}'

  it('renders each side as one Markdown text: hidden words inside bold, a list item and a link', () => {
    const el = renderCard(text)
    const [front] = el.querySelectorAll('.card__side')
    expect(front.querySelector('strong')?.innerHTML).toBe('bold <span class="card__hidden" data-hidden="0"><span class="card__word">one</span></span> more')
    expect(front.querySelector('li .card__hidden')?.textContent).toBe('two')
    expect(front.querySelector('a[href="https://example.com"] .card__hidden')?.textContent).toBe('three')
    expect([...el.querySelectorAll('.card__hidden')].map((s) => s.textContent)).toEqual(['one', 'two', 'three', 'four'])
  })

  it('steps: `sides` shows the first sides, `shown` the first hidden words in page order; a word not shown is a blank', () => {
    const step = renderCard(text, { sides: 1, shown: 1 })
    expect(step.querySelectorAll('.card__side')).toHaveLength(1)
    expect([...step.querySelectorAll('.card__hidden')].map((s) => s.textContent)).toEqual(['one'])
    const blanks = [...step.querySelectorAll<HTMLElement>('.card__blank')]
    expect(blanks.map((b) => b.dataset.hidden)).toEqual(['1', '2'])
    const last = renderCard(text, { sides: 2, shown: 3 })
    expect([...last.querySelectorAll('.card__blank')].map((b) => (b as HTMLElement).dataset.hidden)).toEqual(['3'])
  })

  it('YAZ-5053 round 3: the ONE blank the next Space shows carries `data-next`, from the same step; none when the next Space shows a side, none when all show', () => {
    const next = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-next]')].map((b) => [b.dataset.hidden, b.className])
    expect(next(renderCard(text, { sides: 1, shown: 0 }))).toEqual([['0', 'card__blank']])
    expect(next(renderCard(text, { sides: 1, shown: 2 }))).toEqual([['2', 'card__blank']])
    // Every word of side 1 shows: the next Space adds side 2, so no word is marked.
    expect(next(renderCard(text, { sides: 1, shown: 3 }))).toEqual([])
    expect(next(renderCard(text, { sides: 2, shown: 3 }))).toEqual([['3', 'card__blank']])
    // The page shows everything: nothing is next.
    expect(next(renderCard(text))).toEqual([])
    expect(next(renderCard(text, { sides: 2, shown: 4 }))).toEqual([])
  })

  it('YAZ-5013: the blank and the shown word are the same two spans with the real word inside — only the class (and what a screen reader hears) changes — and a copy over a blank leaves the word out', () => {
    const outer = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-hidden="0"]')!
    const blank = outer(renderCard('Capital of {{France}} today', { shown: 0 }))
    const shown = outer(renderCard('Capital of {{France}} today', { shown: 1 }))
    // The word is inside the blank, so the blank is the word's width; nothing on the line moves when it shows.
    expect(blank.innerHTML).toBe('<span class="card__word" aria-hidden="true">France</span>')
    expect(shown.innerHTML).toBe('<span class="card__word">France</span>')
    expect([blank.className, blank.getAttribute('role'), blank.getAttribute('aria-label')]).toEqual(['card__blank', 'img', 'Hidden word'])
    expect([shown.className, shown.getAttribute('role'), shown.getAttribute('aria-label')]).toEqual(['card__hidden', null, null])
    expect(blank.style.width).toBe('')

    // A selection from "Capital" to "today", over the blank: the copy has no "France".
    const card = renderCard('Capital of {{France}} today', { shown: 0 })
    document.body.append(card)
    const text = card.querySelector('p')!
    const range = document.createRange()
    range.setStart(text.firstChild!, 0)
    range.setEnd(text.lastChild!, text.lastChild!.nodeValue!.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    const data = new Map<string, string>()
    const copy = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(copy, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } })
    text.dispatchEvent(copy)
    expect(copy.defaultPrevented).toBe(true)
    expect(data.get('text/plain')).toBe('Capital of  today')
    expect(data.get('text/html')).not.toContain('France')
    // A selection inside the blank's word copies nothing of it.
    const word = card.querySelector('.card__word')!.firstChild!
    range.setStart(word, 1)
    range.setEnd(word, 4)
    text.dispatchEvent(copy)
    expect(data.get('text/plain')).toBe('')
    card.remove()
  })

  it('YAZ-4974: a pill drawn through the page`s look keeps `wikilink` (and `wikilink--unresolved`) beside the icon`s class; a refresh draws the new look', () => {
    const source = vault(true)
    const linkLook = { icon: (path: string) => ({ class: 'file-icon file-icon--file', 'data-icon-path': path }) }
    const card = renderCard('[[France]] and [[Gone]]', {}, cardLook(source, undefined, undefined, linkLook))
    const [found, gone] = [...card.querySelectorAll<HTMLElement>('[data-card-link]')]
    expect([...found.classList]).toEqual(['wikilink', 'file-icon', 'file-icon--file'])
    expect(found.getAttribute('data-icon-path')).toBe('/v/France.md')
    expect([...gone.classList]).toEqual(['wikilink', 'wikilink--unresolved'])
    // The index changes: "Gone" now resolves and "France" does not. Only the pills draw again.
    source.update((target) => (target === 'Gone' ? '/v/Gone.md' : null), [], [], true, ['WIKI'])
    const side = card.querySelector('.card__side')!
    refreshCardLook(card, cardLook(source, undefined, undefined, linkLook))
    expect(card.querySelector('.card__side')).toBe(side)
    const [france, now] = [...card.querySelectorAll<HTMLElement>('[data-card-link]')]
    expect([...france.classList]).toEqual(['wikilink', 'wikilink--unresolved'])
    expect(france.hasAttribute('data-icon-path')).toBe(false)
    expect(now.getAttribute('data-icon-path')).toBe('/v/Gone.md')
  })

  it('sanitises: no script, no form control, and an image takes the vault URL from the look', () => {
    const el = renderCard('<script>alert(1)</script><input value="x">\n\n![pic|300](images/a%20b.png)', {}, { image: (src) => `app://vault/x/${src}` })
    expect(el.querySelector('script, input')).toBeNull()
    const img = el.querySelector('img')!
    expect(img.getAttribute('src')).toBe('app://vault/x/images/a%20b.png')
    expect(img.getAttribute('alt')).toBe('pic')
    expect(img.getAttribute('width')).toBe('300')
  })
})
