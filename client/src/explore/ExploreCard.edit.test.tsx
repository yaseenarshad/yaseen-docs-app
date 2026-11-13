/**
 * Edit card in the card window (YAZ-5003), against the real page card editor (`createCrepe`, the card view, Crepe's
 * code block): E enters it, Done (⌘↵ here) writes the new text into the page, a window opened in Edit card (the
 * Inbox's E) reads on Done (YAZ-5009), and a read-only vault blocks E but not the Inbox's E.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { ExploreCard } from './ExploreCard'
import type { ExploreVault } from './ExploreNote'

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

async function mount(opts: { startInEdit?: boolean; readOnly?: boolean } = {}) {
  disk.set(PATH, PAGE)
  // A vault that gives IDs: a ```card block is a card there (D8).
  const wikilinks = createWikilinkResolveSource()
  wikilinks.update(() => null, [], [], true, ['WIKI'])
  const vault: ExploreVault = { root: '/v', wikilinks, wikilinkCandidates: { candidates: [], subscribe: () => () => undefined } as never, readOnly: opts.readOnly }
  const onClose = vi.fn()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root?.render(<ExploreCard path={PATH} cardId="WIKI-9" index={0} startInEdit={opts.startInEdit} pageName="Cards" vault={vault} onOpenPage={vi.fn()} onOpenLink={vi.fn()} onOpenTab={vi.fn()} onOpenInTab={vi.fn()} onNotice={vi.fn()} onClose={onClose} active />))
  await vi.waitFor(() => expect(el.querySelector('.note-card__hidden, .cm-content')).not.toBeNull())
  return { onClose, body: el.querySelector<HTMLElement>('[data-explore-card]')! }
}

const key = (target: Element, init: KeyboardEventInit) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))
const codeMirror = async () => {
  await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit] .cm-content')).not.toBeNull())
  return el.querySelector<HTMLElement>('[data-explore-card-edit] .cm-content')!
}

describe('Edit card in the card window (YAZ-5003)', () => {
  it('E edits only the card in the page card`s own editor; ⌘↵ is Done: the new text lands in the page, the rest of the file the same, and the window reads again', async () => {
    const { body, onClose } = await mount()
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    key(body, { key: 'e' })
    const cm = await codeMirror()
    expect(cm.textContent).toContain('Capital of {{France}}')
    // The card's head keeps Done and its keys (the window's head has the ID).
    expect(el.querySelector('[data-explore-card-edit] .note-card__edit')?.textContent).toBe('DoneEscCmd + Enter')
    const view = CodeMirrorView.findFromDOM(cm)!
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' (Seine)' } }))
    key(cm, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.get(PATH)).toBe(PAGE.replace('Paris\n```', 'Paris (Seine)\n```')))
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    await vi.waitFor(() => expect(el.querySelector('.note-card-screen')?.textContent).toContain('Paris (Seine)'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('YAZ-5009: opened in Edit card (the Inbox`s E): the editor shows at once; Esc is Done and the window READS (it stays open); the same text writes nothing', async () => {
    const { onClose } = await mount({ startInEdit: true })
    const cm = await codeMirror()
    key(cm, { key: 'Escape' })
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    expect(el.querySelector('.note-card-screen')?.textContent).toContain('Paris')
    expect(onClose).not.toHaveBeenCalled()
    expect(disk.get(PATH)).toBe(PAGE)
  })

  it('YAZ-5009: in a READ-ONLY vault the Inbox`s E opens Edit card at once, with no "Allow edits?" box; Esc saves into the file and reads; then the card is locked again (E does nothing)', async () => {
    const { body, onClose } = await mount({ readOnly: true, startInEdit: true })
    const cm = await codeMirror()
    expect(document.querySelector('[role="dialog"], .read-only-ask')).toBeNull()
    const view = CodeMirrorView.findFromDOM(cm)!
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' (Seine)' } }))
    key(cm, { key: 'Escape' })
    await vi.waitFor(() => expect(disk.get(PATH)).toBe(PAGE.replace('Paris\n```', 'Paris (Seine)\n```')))
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    await vi.waitFor(() => expect(el.querySelector('.note-card-screen')?.textContent).toContain('Paris (Seine)'))
    expect(onClose).not.toHaveBeenCalled()
    // Locked again: the window's own E is the read-only vault's, blocked as in the page.
    key(body, { key: 'e' })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })

  it('a read-only vault blocks the card window`s own E, as the page does', async () => {
    const { body } = await mount({ readOnly: true })
    key(body, { key: 'e' })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })
})
