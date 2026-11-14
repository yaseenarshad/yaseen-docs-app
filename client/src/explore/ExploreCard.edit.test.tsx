/**
 * Edit card in the card window (YAZ-5003), against the real page card editor (`createCrepe`, the card view, Crepe's
 * code block): E enters it, Done (⌘↵ here) writes the new text into the page, and a read-only vault blocks E. The
 * Inbox no longer opens the card window (YAZ-5145: its E edits in Explore's own page layer).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { ExploreCard } from './ExploreCard'
import { cardBlockViewOfDom, setCardEditorKind } from '../editor/card/cardBlockView'
import type { ExploreVault } from './ExplorePage'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/v/cards.md'
const PAGE = '# Cards\n\nAbove.\n\n```card\nCapital of {{France}}\n---\nParis\n```\n<!-- card: WIKI-9, 2026-11-01T09:00Z good -->\n\nBelow.\n'
const disk = vi.hoisted(() => new Map<string, string>())

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return { ...real, api: { ...real.api, readFile: vi.fn(async (path: string) => ({ path, content: disk.get(path) ?? '', mtime: 1, size: 1 })), shell: { openLink: vi.fn() } } }
})
vi.mock('../views/writeProperty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../views/writeProperty')>()),
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const next = transform(disk.get(path) ?? '')
    disk.set(path, next)
    return { mtime: 2, content: next }
  }),
}))

let root: Root | null = null
let el: HTMLElement

afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

async function mount(opts: { readOnly?: boolean } = {}) {
  disk.set(PATH, PAGE)
  // A vault that gives IDs: a ```card block is a card there (D8).
  const wikilinks = createWikilinkResolveSource()
  wikilinks.update(() => null, [], [], true, ['WIKI'])
  const vault: ExploreVault = { root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never, readOnly: opts.readOnly }
  const onClose = vi.fn()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root?.render(<ExploreCard path={PATH} cardId="WIKI-9" index={0} pageName="Cards" vault={vault} onOpenPage={vi.fn()} onOpenLink={vi.fn()} onOpenTab={vi.fn()} onOpenInTab={vi.fn()} onNotice={vi.fn()} onClose={onClose} active />))
  await vi.waitFor(() => expect(el.querySelector('.card__hidden, .cm-content')).not.toBeNull())
  return { onClose, body: el.querySelector<HTMLElement>('[data-explore-card]')! }
}

const key = (target: Element, init: KeyboardEventInit) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))
const codeMirror = async () => {
  await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit] .cm-content')).not.toBeNull())
  return el.querySelector<HTMLElement>('[data-explore-card-edit] .cm-content')!
}

describe('Edit card in the card window (YAZ-5003)', () => {
  // The raw-text fallback (YAZ-5026); the page's editor is the next block.
  beforeAll(() => setCardEditorKind('code'))
  afterAll(() => setCardEditorKind('page'))
  it('E edits only the card in the page card`s own editor; ⌘↵ is Done: the new text lands in the page, the rest of the file the same, and the window reads again', async () => {
    const { body, onClose } = await mount()
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    key(body, { key: 'e' })
    const cm = await codeMirror()
    expect(cm.textContent).toContain('Capital of {{France}}')
    // The card's head keeps Done and its keys (the window's head has the ID).
    expect(el.querySelector('[data-explore-card-edit] .card__edit')?.textContent).toBe('DoneEscCmd + Enter')
    const view = CodeMirrorView.findFromDOM(cm)!
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' (Seine)' } }))
    key(cm, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.get(PATH)).toBe(PAGE.replace('Paris\n```', 'Paris (Seine)\n```')))
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    await vi.waitFor(() => expect(el.querySelector('.card-screen')?.textContent).toContain('Paris (Seine)'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a read-only vault blocks the card window`s own E, as the page does', async () => {
    const { body } = await mount({ readOnly: true })
    key(body, { key: 'e' })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })
})

/** The card editor in the card window, once it holds the card's text (YAZ-5026). */
const pageEditor = async () => {
  await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit] .card__editor .ProseMirror')).not.toBeNull())
  const dom = el.querySelector<HTMLElement>('[data-explore-card-edit] .card__editor .ProseMirror')!
  await vi.waitFor(() => expect(dom.textContent).toContain('Paris'))
  return dom
}

describe('Edit card in the card window with the page`s editor (YAZ-5026)', () => {
  it('E shows the card in the page`s editor (a hidden word marked, the side line); ⌘↵ is Done: the new text lands in the page, the rest of the file the same', async () => {
    const { body, onClose } = await mount()
    key(body, { key: 'e' })
    const dom = await pageEditor()
    expect(dom.querySelector('.card__cloze')?.textContent).toBe('France')
    expect(dom.querySelector('.card__side-break')).not.toBeNull()
    expect(el.querySelector('[data-explore-card-edit] .cm-content')).toBeNull()
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.get(PATH)).toBe(PAGE.replace('Paris\n```', 'Paris (Seine)\n```')))
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    await vi.waitFor(() => expect(el.querySelector('.card-screen')?.textContent).toContain('Paris (Seine)'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
