/**
 * The note card block in the page (YAZ-4961), against a real editor (`createCrepe`): the slash row and its ID, the card
 * line's round trip, the ⋯ menu, the pills, the outside write of the sweep, and the one render function the Inbox reuses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo, undoDepth } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, noteCardLook, type CreateCrepeOptions } from '../createCrepe'
import { applyExternalMarkdown } from '../external/applyExternalMarkdown'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import { CrepeFeature } from '../crepe'
import { features } from '../featureConfig'
import { NOTE_CARD_OPEN, noteCardLanguage, noteCardViewAt, type NoteCardOpenRequest } from './noteCardView'
import { refreshNoteCardLook, renderNoteCard } from './noteCardRender'
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
  const crepe = createCrepe({ root, defaultValue: markdown, image: { root: '/v', notePath: '/v/Page.md' }, ...opts })
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

describe('the "Note card" slash row (D1, idea 9)', () => {
  it('/card and /notecard find one row in a vault with IDs; it inserts a card that takes its ID at once, and one ⌘Z removes it', async () => {
    let mint = (_path: string): Promise<string> => Promise.resolve('WIKI-512')
    const mintId = vi.fn((path: string) => mint(path))
    const { crepe, root, view } = await mount('x\n', { wikilinks: vault(true), noteCards: { path: '/v/Page.md', mintId } })
    for (const typed of ['/card', '/notecard']) {
      await typeSlash(view, typed)
      await vi.waitFor(() => expect(slashRows(root)).toEqual(['Note card']))
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(cardPos(view)).toBe(0))
    expect(mintId).toHaveBeenCalledWith('/v/Page.md')
    // The card is edited at once: Crepe's code editor in the card, the caret in its text.
    expect(noteCardViewAt(view, 0)?.editing).toBe(true)
    expect(view.state.selection.$from.parent.attrs.language).toBe('card')
    // The ID lands without any sweep, on the line under the fence.
    await vi.waitFor(() => expect(getMarkdownForSave(crepe)).toBe('```card\n```\n<!-- card: WIKI-512 -->\n'))
    // The ID is out of the undo history: one ⌘Z takes the card away whole.
    undo(view.state, view.dispatch)
    expect(cardPos(view)).toBe(-1)
    // A door that fails leaves the card with no line: the sweep is the safety net.
    mint = () => Promise.reject(new Error('no IDs'))
  })

  it('hides in a vault without IDs, and in an editor whose host gives no cards', async () => {
    const plain = await mount('x\n', { wikilinks: vault(false), noteCards: { path: '/v/Page.md', mintId: () => Promise.resolve('WIKI-1') } })
    await typeSlash(plain.view, '/card')
    await tick(60)
    expect(slashRows(plain.root)).not.toContain('Note card')
    await typeSlash(plain.view, '/code')
    await vi.waitFor(() => expect(slashRows(plain.root)).toContain('Code'))
    const noHost = await mount('x\n', { wikilinks: vault(true) })
    await typeSlash(noHost.view, '/code')
    await vi.waitFor(() => expect(slashRows(noHost.root)).toContain('Code'))
    expect(slashRows(noHost.root)).not.toContain('Note card')
  })

  it('D8: in a vault without IDs a ```card block is a plain code block: no card head, no ⋯, no Edit card', async () => {
    const { root } = await mount(`${CARD}<!-- card: WIKI-7 -->\n`, { wikilinks: vault(false), noteCards: { path: '/v/Page.md' } })
    expect(root.querySelector('.note-card')).toBeNull()
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
    expect(root.querySelector('.note-card')).not.toBeNull()
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
    const card = view.dom.querySelector<HTMLElement>('.note-card')!
    // The head does not repeat the card's first line: the text is right below it.
    expect(card.querySelector('.note-card__title')).toBeNull()
    const shown = (el: Element | null) => [...(el?.children ?? [])].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent).join('')
    expect(shown(card.querySelector('.note-card__head'))).toBe('Edit card⋯')
    expect([...card.querySelectorAll('.note-card__side')].map((side) => side.textContent?.trim())).toEqual(['What is the capital of France (France, Gone)?', 'Paris'])
    expect(card.querySelector('.note-card__rule')).not.toBeNull()
    expect(card.querySelector('.note-card__hidden')?.textContent).toBe('France')
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
      const card = view.dom.querySelector<HTMLElement>('.note-card')!
      const board = card.querySelector<HTMLElement>('.note-card__board')!
      expect(board.querySelector('img')?.getAttribute('loading')).toBe('lazy')
      board.querySelector('img')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      board.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, metaKey: true }))
      expect(follow).toEqual([
        ['explore', '/v/Card loop.excalidraw'],
        ['backgroundTab', '/v/Card loop.excalidraw'],
      ])
      card.querySelector('.note-card__audio-name')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      expect(card.classList.contains('ProseMirror-selectednode')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('D20: the head shows the card ID first, small and grey; a click copies it and opens nothing; a card with no ID shows none', async () => {
    const { root } = await mount(`${CARD}<!-- card: WIKI-7 -->\n`, { noteCards: { path: '/v/Page.md' } })
    const id = root.querySelector<HTMLButtonElement>('.note-card__head > .note-card__id:first-child')!
    expect([id.textContent, id.hidden]).toEqual(['WIKI-7', false])
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const opened: unknown[] = []
    const onOpen = (e: Event) => opened.push(e)
    document.addEventListener(NOTE_CARD_OPEN, onOpen)
    id.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    document.removeEventListener(NOTE_CARD_OPEN, onOpen)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('WIKI-7')
    expect(opened).toEqual([])
    const bare = await mount(CARD, { noteCards: { path: '/v/Page.md' } })
    expect(bare.root.querySelector<HTMLButtonElement>('.note-card__id')?.hidden).toBe(true)
  })

  it('the ⋯ menu changes the card line in one undo step each; Copy card ID; Open card sends the one hook', async () => {
    const { crepe, root, view } = await mount(`${CARD}<!-- card: WIKI-7, 2026-11-12T14:05Z good, kept -->\n`, { noteCards: { path: '/v/Page.md' } })
    const run = (label: string) => {
      root.querySelector<HTMLElement>('.note-card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      const row = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith(label))!
      row.click()
    }
    const line = () => getMarkdownForSave(crepe).split('\n').find((l) => l.startsWith('<!-- card'))
    run('Turn review off')
    expect(line()).toBe('<!-- card: WIKI-7, off, 2026-11-12T14:05Z good, kept -->')
    expect(root.querySelector('.note-card__state')?.textContent).toBe('Review off')
    run('Reset history')
    expect(line()).toBe('<!-- card: WIKI-7, off, kept -->')
    undo(view.state, view.dispatch)
    expect(line()).toBe('<!-- card: WIKI-7, off, 2026-11-12T14:05Z good, kept -->')
    run('Turn review on')
    expect(line()).toBe('<!-- card: WIKI-7, 2026-11-12T14:05Z good, kept -->')
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    run('Copy card ID')
    expect(writeText).toHaveBeenCalledWith('WIKI-7')
    const opened: NoteCardOpenRequest[] = []
    document.addEventListener(NOTE_CARD_OPEN, (e) => opened.push((e as CustomEvent<NoteCardOpenRequest>).detail), { once: true })
    run('Open card')
    expect(opened).toEqual([{ path: '/v/Page.md', cardId: 'WIKI-7', index: 0 }])
  })

  it('YAZ-4999: ⋯ Put at top of Inbox and the chip`s × set and remove `next`, each in one undo step; read only, they write the FILE', async () => {
    const { crepe, root, view } = await mount(`${CARD}<!-- card: WIKI-7, 2026-11-12T14:05Z good -->\n`, { noteCards: { path: '/v/Page.md' } })
    const rowOf = (label: string) => {
      root.querySelector<HTMLElement>('.note-card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      return [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith(label))
    }
    const line = () => getMarkdownForSave(crepe).split('\n').find((l) => l.startsWith('<!-- card'))
    const chip = () => root.querySelector<HTMLElement>('.note-card__next')!
    const remove = () => chip().querySelector('.note-card__next-remove')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
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

  it('read only locks the card`s text, not its review: no Edit card; ⋯ Turn review off and Reset history write the FILE', async () => {
    fileWrites.length = 0
    const { crepe, root } = await mount(`${CARD}<!-- card: WIKI-7, 2026-11-12T14:05Z good -->\n`, { noteCards: { path: '/v/Page.md' } })
    crepe.setReadonly(true)
    const run = (label: string) => {
      root.querySelector<HTMLElement>('.note-card__more')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      const row = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent?.startsWith(label))!
      expect(row.disabled).toBe(false)
      row.click()
    }
    run('Turn review off')
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
    const { root, view } = await mount(`${CARD}<!-- card: WIKI-8 -->\n\n\`\`\`js\nx\n\`\`\`\n`, { noteCards: { path: '/v/Page.md' } })
    const card = root.querySelector<HTMLElement>('.note-card')!
    const edit = () => card.querySelector('.note-card__edit')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    edit()
    const cm = card.querySelector<HTMLElement>('.cm-content')!
    expect(cm.textContent).toContain('What is the capital of {{France}}?')
    expect([...card.querySelectorAll('.note-card__edit kbd')].map((k) => k.textContent)).toEqual(['esc', '⌘↵'])
    expect(card.querySelector('.note-card__edit')?.textContent).toBe('Doneesc⌘↵')
    // The card language: Markdown with spell check (idea 8), once the language loads.
    await vi.waitFor(() => expect(cm.getAttribute('spellcheck')).toBe('true'))
    const opened: NoteCardOpenRequest[] = []
    const listen = (e: Event) => opened.push((e as CustomEvent<NoteCardOpenRequest>).detail)
    document.addEventListener(NOTE_CARD_OPEN, listen)
    const modEnter = (el: HTMLElement) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
    const doc = view.state.doc
    modEnter(cm)
    // Done: the card draws again, selected; nothing opens and the text is the same.
    expect(card.querySelector('.cm-editor')).toBeNull()
    expect(card.querySelector('.note-card__edit')?.textContent).toBe('Edit card')
    expect(card.querySelector('.note-card__hidden')?.textContent).toBe('France')
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
    document.removeEventListener(NOTE_CARD_OPEN, listen)
  })

  it("YAZ-5008: in Edit card a selection (a drag, a double or triple click) stays CodeMirror's and the page's TEXT selection, never the card's node selection; ⌘L wraps it", async () => {
    const { EditorView: CodeMirrorView } = await import('@codemirror/view')
    const { root, view } = await mount(`${CARD}<!-- card: WIKI-8 -->\n`, { noteCards: { path: '/v/Page.md' } })
    const card = root.querySelector<HTMLElement>('.note-card')!
    card.querySelector('.note-card__edit')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
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

  it('draws the same in a read-only preview (idea 10: the hover preview, QuickLook, read-only notes mount this editor), with no Edit card', async () => {
    // `useReadOnlyNote.ts`'s features and its read-only switch.
    const { crepe, root } = await mount(CARD, { features: { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }, wikilinks: vault(true) })
    crepe.setReadonly(true)
    expect(root.querySelector('.note-card__hidden')?.textContent).toBe('France')
    expect(root.querySelectorAll('.note-card__side')).toHaveLength(2)
    expect(root.querySelector('.ProseMirror[contenteditable="false"] .note-card__edit')).not.toBeNull() // hidden by noteCard.css
    root.querySelector('.note-card__edit')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(root.querySelector('.note-card .cm-editor')).toBeNull()
  })

  it("the sweep's write of the open page lands as one change of the card's line, the text around it kept", async () => {
    const { crepe, view } = await mount(`# Page\n\nSome text above the card.\n\n${CARD}\nMore text below.\n`)
    const before = view.state.doc.child(0)
    const result = applyExternalMarkdown(crepe, `# Page\n\nSome text above the card.\n\n${CARD}<!-- card: WIKI-9 -->\n\nMore text below.\n`)
    expect(result).toBe('applied')
    expect(view.state.doc.child(0).eq(before)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(`# Page\n\nSome text above the card.\n\n${CARD}<!-- card: WIKI-9 -->\n\nMore text below.\n`)
    expect(view.state.doc.nodeAt(cardPos(view))?.attrs.cardLine).toBe('<!-- card: WIKI-9 -->')
    expect(view.dom.querySelector('.note-card__side')?.textContent).toContain('capital')
  })
})

describe('"Reviews (n)" under the card in the page (YAZ-5000)', () => {
  const LINE = '<!-- card: WIKI-7, 2026-11-01T09:00Z good, 2026-11-05T09:00Z again, 2026-11-06T09:00Z good -->'
  const PAGE = `# Page\n\n${CARD}${LINE}\n\nAfter.\n`
  const settings = () => DEFAULT_REVIEW_SETTINGS
  const header = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.note-card .note-card-reviews .backlinks__header')
  const press = (el: Element) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  /** Each row's answer (its glyph's word, the hover) — '' for the review to come. */
  const rows = (root: HTMLElement) => [...root.querySelectorAll('.note-card-reviews__table tbody tr')].map((tr) => tr.querySelector('.note-card-answer')?.getAttribute('title') ?? '')
  const cells = (root: HTMLElement) => [...root.querySelectorAll('.note-card-reviews__table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))

  it('a card with reviews shows "✓ 3 Reviews" closed, with no table, and the strip on the same row (YAZ-5032); a card with none shows no section; a preview with no door shows none', async () => {
    const { root } = await mount(`${PAGE}\n\`\`\`card\nAnother\n\`\`\`\n<!-- card: WIKI-8 -->\n`, { noteCards: { path: '/v/Page.md' }, noteCardReviews: { settings, deleteReview: vi.fn() } })
    const cards = root.querySelectorAll('.note-card')
    expect(cards).toHaveLength(2)
    expect(header(root)?.textContent).toBe('3 Reviews')
    expect(header(root)?.querySelector('svg')).not.toBeNull()
    expect(header(root)?.getAttribute('aria-expanded')).toBe('false')
    expect(root.querySelector('.note-card-reviews__table')).toBeNull()
    // Closed, the facts show: the last answer's glyph, the interval, the next due date, the recall badge.
    await vi.waitFor(() => expect(cards[0].querySelectorAll('.note-card-reviews__facts > .note-card-strip__fact')).toHaveLength(4))
    const facts = cards[0].querySelector('.note-card-reviews__facts')!
    expect(facts.querySelector('.note-card-answer')?.getAttribute('title')).toBe('Last answer: Remembered, Nov 6')
    expect(facts.querySelector('[title="Interval"]')?.textContent).not.toBe('')
    expect(facts.querySelector('.note-card-strip__recall')?.textContent).toMatch(/^\d+%$/)
    expect(cards[1].querySelector('.note-card-reviews')).toBeNull()
    const preview = await mount(PAGE, { noteCards: { path: '/v/Page.md' } })
    expect(preview.root.querySelector('.note-card-reviews')).toBeNull()
  })

  it('a click opens the card window`s table with each review and the upcoming row; open and closed are no change of the page and no undo step', async () => {
    const { crepe, root, view } = await mount(PAGE, { noteCards: { path: '/v/Page-open.md' }, noteCardReviews: { settings, deleteReview: vi.fn() } })
    const doc = view.state.doc
    press(header(root)!)
    await vi.waitFor(() => expect(rows(root)).toEqual(['Remembered', 'Forgot', 'Remembered', '']))
    expect(header(root)?.getAttribute('aria-expanded')).toBe('true')
    // YAZ-5032: icons, "# of days" with its unit (blank for the first), dates in full; the review to come is muted,
    // "-- " under Next due, and has no delete.
    const table = cells(root)
    expect(table.map((r) => r[1])).toEqual(['', '4 days', '1 day', expect.stringMatching(/^(\d+ days?|later today)$/)])
    expect(table[0][2]).toBe('Nov 1, 2026')
    expect(table[0][3]).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/)
    expect(table[3][2]).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/)
    expect(table[3][3]).toBe('--')
    const trs = root.querySelectorAll('.note-card-reviews__table tbody tr')
    expect([...trs].map((tr) => tr.querySelector('button')?.getAttribute('title') ?? null)).toEqual(['Delete this review', 'Delete this review', 'Delete this review', null])
    expect(trs[3].classList.contains('note-card-reviews__next')).toBe(true)
    expect([...root.querySelectorAll('.note-card-reviews__table th')].map((th) => th.textContent)).toEqual(['Answer', '# of days', 'Review date', 'Next due', ''])
    expect(view.state.doc).toBe(doc)
    expect(undoDepth(view.state)).toBe(0)
    expect(root.querySelector('.note-card')?.classList.contains('ProseMirror-selectednode')).toBe(false)
    press(header(root)!)
    expect(root.querySelector('.note-card-reviews__table')).toBeNull()
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
    const { crepe, root } = await mount(PAGE, { noteCards: { path }, noteCardReviews: { settings, deleteReview } })
    crepe.setReadonly(true)
    press(header(root)!)
    await vi.waitFor(() => expect(rows(root)).toHaveLength(4))
    root.querySelectorAll<HTMLButtonElement>('.note-card-reviews__table tbody button')[1].click()
    expect(deleteReview).toHaveBeenCalledWith(path, 'WIKI-7', { at: '2026-11-05T09:00Z', rating: 'again' })
    await vi.waitFor(() => expect(disk.get(path)).toBe(PAGE.replace(' 2026-11-05T09:00Z again,', '')))
    // The app merges its own write into the open page: the section counts again, and the open table shows the new rows.
    expect(applyExternalMarkdown(crepe, disk.get(path)!)).toBe('applied')
    await vi.waitFor(() => expect(rows(root)).toEqual(['Remembered', 'Remembered', '']))
    expect(root.querySelector('.note-card-reviews')?.querySelector('.backlinks__title')?.textContent).toBe('2 Reviews')
    await undoDelete!()
    expect(disk.get(path)).toBe(PAGE)
  })
})

describe('the card editor`s language (idea 8)', () => {
  it('is Markdown with no setext heading: the front line above --- is no heading; a # line still is', async () => {
    const { language } = await noteCardLanguage.load()
    const kinds = (text: string) => {
      const names: string[] = []
      language.parser.parse(text).iterate({ enter: (n) => void names.push(n.name) })
      return names
    }
    expect(kinds('Front\n---\nBack').some((n) => n.startsWith('SetextHeading'))).toBe(false)
    expect(kinds('# Front\n---\nBack')).toContain('ATXHeading1')
  })
})

describe('renderNoteCard (the page and the Inbox, D18)', () => {
  const text = '**bold {{one}} more**\n\n* an item with {{two}}\n* [a link {{three}}](https://example.com)\n---\nBack {{four}}'

  it('renders each side as one Markdown text: hidden words inside bold, a list item and a link', () => {
    const el = renderNoteCard(text)
    const [front] = el.querySelectorAll('.note-card__side')
    expect(front.querySelector('strong')?.innerHTML).toBe('bold <span class="note-card__hidden" data-hidden="0"><span class="note-card__word">one</span></span> more')
    expect(front.querySelector('li .note-card__hidden')?.textContent).toBe('two')
    expect(front.querySelector('a[href="https://example.com"] .note-card__hidden')?.textContent).toBe('three')
    expect([...el.querySelectorAll('.note-card__hidden')].map((s) => s.textContent)).toEqual(['one', 'two', 'three', 'four'])
  })

  it('steps: `sides` shows the first sides, `shown` the first hidden words in page order; a word not shown is a blank', () => {
    const step = renderNoteCard(text, { sides: 1, shown: 1 })
    expect(step.querySelectorAll('.note-card__side')).toHaveLength(1)
    expect([...step.querySelectorAll('.note-card__hidden')].map((s) => s.textContent)).toEqual(['one'])
    const blanks = [...step.querySelectorAll<HTMLElement>('.note-card__blank')]
    expect(blanks.map((b) => b.dataset.hidden)).toEqual(['1', '2'])
    const last = renderNoteCard(text, { sides: 2, shown: 3 })
    expect([...last.querySelectorAll('.note-card__blank')].map((b) => (b as HTMLElement).dataset.hidden)).toEqual(['3'])
  })

  it('YAZ-5013: the blank and the shown word are the same two spans with the real word inside — only the class (and what a screen reader hears) changes — and a copy over a blank leaves the word out', () => {
    const outer = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-hidden="0"]')!
    const blank = outer(renderNoteCard('Capital of {{France}} today', { shown: 0 }))
    const shown = outer(renderNoteCard('Capital of {{France}} today', { shown: 1 }))
    // The word is inside the blank, so the blank is the word's width; nothing on the line moves when it shows.
    expect(blank.innerHTML).toBe('<span class="note-card__word" aria-hidden="true">France</span>')
    expect(shown.innerHTML).toBe('<span class="note-card__word">France</span>')
    expect([blank.className, blank.getAttribute('role'), blank.getAttribute('aria-label')]).toEqual(['note-card__blank', 'img', 'Hidden word'])
    expect([shown.className, shown.getAttribute('role'), shown.getAttribute('aria-label')]).toEqual(['note-card__hidden', null, null])
    expect(blank.style.width).toBe('')

    // A selection from "Capital" to "today", over the blank: the copy has no "France".
    const card = renderNoteCard('Capital of {{France}} today', { shown: 0 })
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
    const word = card.querySelector('.note-card__word')!.firstChild!
    range.setStart(word, 1)
    range.setEnd(word, 4)
    text.dispatchEvent(copy)
    expect(data.get('text/plain')).toBe('')
    card.remove()
  })

  it('YAZ-4974: a pill drawn through the page`s look keeps `wikilink` (and `wikilink--unresolved`) beside the icon`s class; a refresh draws the new look', () => {
    const source = vault(true)
    const linkLook = { icon: (path: string) => ({ class: 'file-icon file-icon--file', 'data-icon-path': path }) }
    const card = renderNoteCard('[[France]] and [[Gone]]', {}, noteCardLook(source, undefined, undefined, linkLook))
    const [found, gone] = [...card.querySelectorAll<HTMLElement>('[data-note-card-link]')]
    expect([...found.classList]).toEqual(['wikilink', 'file-icon', 'file-icon--file'])
    expect(found.getAttribute('data-icon-path')).toBe('/v/France.md')
    expect([...gone.classList]).toEqual(['wikilink', 'wikilink--unresolved'])
    // The index changes: "Gone" now resolves and "France" does not. Only the pills draw again.
    source.update((target) => (target === 'Gone' ? '/v/Gone.md' : null), [], [], true, ['WIKI'])
    const side = card.querySelector('.note-card__side')!
    refreshNoteCardLook(card, noteCardLook(source, undefined, undefined, linkLook))
    expect(card.querySelector('.note-card__side')).toBe(side)
    const [france, now] = [...card.querySelectorAll<HTMLElement>('[data-note-card-link]')]
    expect([...france.classList]).toEqual(['wikilink', 'wikilink--unresolved'])
    expect(france.hasAttribute('data-icon-path')).toBe(false)
    expect(now.getAttribute('data-icon-path')).toBe('/v/Gone.md')
  })

  it('sanitises: no script, no form control, and an image takes the vault URL from the look', () => {
    const el = renderNoteCard('<script>alert(1)</script><input value="x">\n\n![pic|300](images/a%20b.png)', {}, { image: (src) => `app://vault/x/${src}` })
    expect(el.querySelector('script, input')).toBeNull()
    const img = el.querySelector('img')!
    expect(img.getAttribute('src')).toBe('app://vault/x/images/a%20b.png')
    expect(img.getAttribute('alt')).toBe('pic')
    expect(img.getAttribute('width')).toBe('300')
  })
})
