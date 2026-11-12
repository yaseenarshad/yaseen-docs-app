/**
 * The explore stack (YAZ-2571) in jsdom: ⌘⇧F opens a search with the caret in it; Enter opens the note ON TOP for
 * reading; E turns that layer into the editor; a link in a note adds a layer; Esc removes one layer at a time, and
 * a covered layer keeps its scroll place because it never unmounts; ⌘↵ opens the top note in a tab; 12 layers at most.
 * `createCrepe` and the bridge are stand-ins (the preview panel's test does the same): a read-only Crepe is built
 * per note layer with the stack's link doors, and nothing writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { CrepeFeature } from '../editor/crepe'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import type { SearchVault } from '../search/useSearchResults'
import { FindBar } from '../editor/find/FindBar'
import { createFindChannel } from '../editor/find/findChannel'
import { NO_FOLDER_PAGE_NOTICE } from './exploreMenu'
import { exploreRecents as exploreRecentsNow, moveExploreRecent, rememberExploreRecent, reloadExploreRecents, resetExploreRecents } from './exploreRecents'
import { onNoteWindowRequest } from '../views/noteWindowRequest'
import { registerRenameContinuity } from '../lib/renameContinuity'
import { requestZoom } from '../editor/zoomRequest'
import { ExploreStack, FULL_NOTICE, type ExploreStackProps } from './ExploreStack'
import { layerPlace, MAX_LAYERS } from './layers'
import { tileCells } from './tile'
import { ago } from './recentSections'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Crepe = { opts: Record<string, unknown> & { root: HTMLElement; defaultValue?: string; wikilinkNav?: { openCurrent: (path: string) => void }; markdownLinkNav?: { openPath: (path: string, where: string) => void } }; create: Mock; setReadonly: Mock; destroy: Mock }

const { readFile, index, openLink, crepes } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<{ path: string; content: string; mtime: number; size: number }>>(),
  index: vi.fn(),
  openLink: vi.fn(),
  crepes: [] as Crepe[],
}))

vi.mock('../api', () => ({ api: { readFile, index, shell: { openLink } } }))
vi.mock('../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: Crepe['opts']) => {
    const inst: Crepe = { opts, create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.textContent = opts.defaultValue ?? ''
    opts.root.appendChild(pm)
    crepes.push(inst)
    return inst
  }),
  // The fold-all button reads the view: the stand-in's document, a state the fold stand-ins below ignore.
  editorViewOf: (crepe: Crepe) => ({ dom: crepe.opts.root.firstChild, state: {}, dispatch: folds.dispatch }),
}))
const folds = vi.hoisted(() => ({ dispatch: vi.fn(), next: 'collapse' as 'collapse' | 'expand' | 'none', runs: [] as boolean[] }))
vi.mock('../editor/outline/foldAllHotkeys', () => ({
  FOLDS_CHANGED_EVENT: 'yaseendocs:folds-changed',
  nextDocumentFold: () => folds.next,
  setAllDocumentFolds: (collapse: boolean) => () => {
    folds.runs.push(collapse)
    return true
  },
}))
/** The board embed's window (YAZ-4943), stood in: each mount records its host; the handle records what the layer asks. */
type FakeBoard = { host: import('../editor/embed/types').BoardWindowHost; dom: HTMLElement; destroy: Mock; showPage: Mock; handleKey: Mock; setSelected: Mock }
const boards = vi.hoisted(() => ({ made: [] as FakeBoard[] }))
vi.mock('../editor/embed/types', () => ({
  loadBoardWindow: () =>
    Promise.resolve({
      mountBoardWindow: (host: FakeBoard['host']) => {
        const dom = document.createElement('div')
        dom.className = 'board-window board-window--fill'
        dom.tabIndex = -1
        const made: FakeBoard = { host, dom, destroy: vi.fn(), showPage: vi.fn(), handleKey: vi.fn(() => true), setSelected: vi.fn() }
        boards.made.push(made)
        return { dom, update: vi.fn(), setSelected: made.setSelected, handleKey: made.handleKey, setFolded: vi.fn(), setFoldable: vi.fn(), menuRows: () => [], fit: vi.fn(), showPage: made.showPage, flush: vi.fn(), destroy: made.destroy }
      },
    }),
}))
/** The comment stream and Linked mentions (round 1, item 3), stood in: each says what it was handed, and a mention click opens its note. */
const under = vi.hoisted(() => ({ comments: [] as Array<{ path: string; content: string; order: string }>, backlinks: [] as string[] }))
vi.mock('../comments/CommentsSection', () => ({
  CommentsSection: (p: { file: { path: string; content: string }; order: string }) => {
    under.comments.push({ path: p.file.path, content: p.file.content, order: p.order })
    return <section className="comments" data-path={p.file.path} />
  },
}))
vi.mock('../links/BacklinksSection', () => ({
  BacklinksSection: (p: { path: string; openCurrent: (path: string) => void }) => {
    under.backlinks.push(p.path)
    return (
      <section className="backlinks">
        <button type="button" className="mention" onClick={() => p.openCurrent('/v/beta.md')}>
          beta mentions it
        </button>
      </section>
    )
  },
}))

const rec = (path: string, title: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}
const RECORDS = [rec('/v/alpha.md', 'Alpha', { id: 'EMB-1' }), rec('/v/beta.md', 'Beta', { tags: ['greek'] }), rec('/v/conjecture.md', 'conjecture (vocab)')]
const watch: WatchSource = { subscribe: () => () => undefined }
const wikilinks = createWikilinkResolveSource()
const vaults: SearchVault[] = [{ root: '/v', watch, dirs: ['/v/sub'], files: [] }]
const candidates = { candidates: [], subscribe: () => () => undefined }
const viewOnly = { resolve: null, subscribe: () => () => undefined } as unknown as import('../editor/wikilink/viewOnlyLinkSource').ViewOnlyLinkSource

let root: Root | null = null
let el: HTMLElement
let props: ExploreStackProps
const editors: string[] = []

const flush = () => act(async () => await Promise.resolve())

function render(request: number) {
  act(() => root?.render(<ExploreStack {...props} request={request} />))
}
async function mount(request = 1) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  render(request)
  await flush()
  await flush()
}

const layers = () => [...el.querySelectorAll<HTMLElement>('.explore__layer')]
const live = () => layers().filter((l) => !l.classList.contains('explore__layer--out'))
const top = () => live()[live().length - 1]
const input = () => top().querySelector<HTMLInputElement>('.explore__input') as HTMLInputElement
const key = (target: Element, init: KeyboardEventInit) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))
const escape = () => key(document.activeElement ?? top(), { key: 'Escape' })

async function typeQuery(text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}
/** Each row's title, without its id (round 1, item 1: the id is its own span after the title). */
const rows = () => [...top().querySelectorAll<HTMLElement>('.search-results__row')].map((r) => [...(r.querySelector('.search-results__label')?.childNodes ?? [])].filter((n) => !(n instanceof HTMLElement && n.classList.contains('explore__id'))).map((n) => n.textContent).join(''))
async function openResult() {
  key(input(), { key: 'Enter' })
  await flush()
  await flush()
}

beforeEach(() => {
  resetExploreRecents()
  crepes.length = 0
  boards.made.length = 0
  editors.length = 0
  readFile.mockReset().mockImplementation(async (path) => ({ path, content: `# ${path}\n\nthe body of ${path}\n`, mtime: 1, size: 1 }))
  index.mockReset().mockResolvedValue({ root: '/v', records: RECORDS, folders: [], generatedAt: 1, ids: false, size: 3 })
  openLink.mockReset()
  // No motion in jsdom: a layer leaves at once. One test below puts the motion back.
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true }), configurable: true, writable: true })
  props = {
    request: 1,
    vaults,
    vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: candidates, viewOnlyLinks: viewOnly }),
    nameOf: (path) => path.slice(3, -3),
    textVarsFor: () => ({}),
    renderEditor: (path): ReactNode => {
      editors.push(path)
      return <div className="editor" data-editor={path} />
    },
    createFolder: () => '',
    openInTab: vi.fn(),
    onNotice: vi.fn(),
    onRenameFile: vi.fn(),
    linkActions: { showInSidebar: vi.fn(), openNewWindow: vi.fn(), reveal: vi.fn(), openVsCode: vi.fn(), listState: () => ({ focus: false, favorite: true }), toggleFocus: vi.fn(), toggleFavorite: vi.fn() },
    commentsOrder: 'oldest',
    onChangeCommentsOrder: vi.fn(),
    onClose: vi.fn(),
  }
  under.comments.length = 0
  under.backlinks.length = 0
  folds.runs.length = 0
  folds.next = 'collapse'
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

describe('the explore stack', () => {
  it('⌘⇧F: one search layer in the middle, the caret in its input; the stack is modal and reads the keys', async () => {
    await mount()
    expect(el.querySelector('.explore')?.getAttribute('aria-modal')).toBe('true')
    expect(layers()).toHaveLength(1)
    expect(top().dataset.kind).toBe('search')
    expect(document.activeElement).toBe(input())
    expect(top().querySelector('.explore__foot')?.textContent).toContain('open')
  })

  it('a query ranks the index rows: a typo finds conjecture, a tag finds its note with the tag as the snippet; Enter opens the note ON TOP for reading, the search stays under it', async () => {
    await mount()
    expect(index).toHaveBeenCalledExactlyOnceWith('/v')
    await typeQuery('conjeture')
    expect(rows()).toEqual(['conjecture (vocab)'])
    await typeQuery('greek')
    expect(rows()).toEqual(['Beta'])
    expect(top().querySelector('.explore__snippet')?.textContent).toBe('#greek')
    await typeQuery('alp')
    expect(rows()).toEqual(['Alpha'])
    await openResult()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note'])
    expect(top().querySelector('.explore__title')?.textContent).toBe('alpha')
    expect(top().querySelector('.explore__mode')).toBeNull()
    // The note's saved text, read once, in the read-only render: no editor, no caret.
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/v/alpha.md')
    expect(crepes).toHaveLength(1)
    expect(crepes[0].setReadonly).toHaveBeenCalledWith(true)
    expect(crepes[0].opts.features).toMatchObject({ [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false })
    expect(editors).toEqual([])
    // The search under it stays mounted with its text, covered: dimmed, out of assistive tech; a click brings it to the front (round 6).
    const search = layers()[0]
    expect(search.querySelector<HTMLInputElement>('.explore__input')?.value).toBe('alp')
    expect(search.hasAttribute('inert')).toBe(false)
    expect(search.getAttribute('aria-hidden')).toBe('true')
    expect(search.classList.contains('explore__layer--covered')).toBe(true)
    expect(top().hasAttribute('inert')).toBe(false)
    // The reading body has the focus, so E and Esc are heard.
    expect(document.activeElement).toBe(top().querySelector('.explore__body'))
  })

  it('E turns the SAME layer into the editor (the mini window editor with the stack\'s link door); in a field E types', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    const layer = top()
    key(document.activeElement as Element, { key: 'e' })
    await flush()
    expect(top()).toBe(layer)
    // `renderEditor` is a render prop: once per render here, once per mount in App (`RetainedEditor` is memo).
    expect([...new Set(editors)]).toEqual(['/v/alpha.md'])
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Editing')
    expect(top().querySelector('.explore__body--edit [data-editor="/v/alpha.md"]')).not.toBeNull()
    // The Edit button does the same from a click.
    render(2)
    await flush()
    await typeQuery('beta')
    await openResult()
    act(() => top().querySelector<HTMLButtonElement>('.explore__button')?.click())
    await flush()
    expect([...new Set(editors)]).toEqual(['/v/alpha.md', '/v/beta.md'])
    // E inside the editor's field is a letter, not the stack's key.
    render(3)
    await flush()
    expect(top().dataset.kind).toBe('search')
    const before = editors.length
    key(input(), { key: 'e' })
    expect(editors).toHaveLength(before)
    expect(top().dataset.kind).toBe('search')
  })

  it('a link in a reading note opens that note on top; a link to a file that is no note opens in a tab and closes the stack', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    act(() => crepes[0].opts.wikilinkNav?.openCurrent('/v/beta.md'))
    await flush()
    await flush()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note', 'note'])
    expect(top().querySelector('.explore__title')?.textContent).toBe('beta')
    expect(crepes).toHaveLength(2)
    act(() => crepes[1].opts.markdownLinkNav?.openPath('/v/paper.pdf', 'thisTab'))
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith('/v/paper.pdf')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('Esc removes ONE layer, the top one, in reverse order; the last Esc closes the stack; a pop-up that took Esc keeps it', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    render(2)
    await flush()
    await typeQuery('beta')
    await openResult()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note', 'search', 'note'])
    // A picker inside the top layer took this Esc (defaultPrevented, focus still inside): nothing closes.
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    taken.preventDefault()
    act(() => void (document.activeElement as Element).dispatchEvent(taken))
    expect(layers()).toHaveLength(4)
    escape()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note', 'search'])
    expect(document.activeElement).toBe(input())
    expect(input().value).toBe('beta')
    escape()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note'])
    expect(document.activeElement).toBe(top().querySelector('.explore__body'))
    escape()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search'])
    expect(props.onClose).not.toHaveBeenCalled()
    escape()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('the defining requirement: a covered note keeps its scroll place exactly, the same element, through a search and a note over it', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    const bodyA = top().querySelector<HTMLElement>('.explore__body') as HTMLElement
    bodyA.scrollTop = 333
    render(2)
    await flush()
    await typeQuery('beta')
    await openResult()
    const bodyB = top().querySelector<HTMLElement>('.explore__body') as HTMLElement
    bodyB.scrollTop = 50
    expect(bodyA.isConnected).toBe(true)
    expect(bodyA.scrollTop).toBe(333)
    // The note under was read one time: no re-read, no re-render of its text while covered.
    expect(readFile).toHaveBeenCalledTimes(2)
    escape()
    escape()
    expect(top().querySelector('.explore__body')).toBe(bodyA)
    expect(bodyA.scrollTop).toBe(333)
    expect(crepes[0].destroy).not.toHaveBeenCalled()
  })

  it('⌘↵ opens the top note in a tab and closes the stack: from a note, and from a search over a note', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    render(2)
    await flush()
    key(input(), { key: 'Enter', metaKey: true })
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith('/v/alpha.md')
    expect(props.onClose).toHaveBeenCalledOnce()
    // The head's ↗ does the same.
    vi.mocked(props.openInTab).mockClear()
    escape()
    act(() => top().querySelector<HTMLButtonElement>('button[aria-label="Open in a tab"]')?.click())
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith('/v/alpha.md')
  })

  it('12 layers at most: a 13th says so and opens nothing; the recent notes show with no query', async () => {
    await mount()
    for (let n = 2; n <= MAX_LAYERS; n++) {
      render(n)
      await flush()
    }
    expect(layers()).toHaveLength(MAX_LAYERS)
    render(MAX_LAYERS + 1)
    await flush()
    expect(layers()).toHaveLength(MAX_LAYERS)
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith(FULL_NOTICE)
    await typeQuery('alp')
    await openResult()
    expect(layers()).toHaveLength(MAX_LAYERS)
    expect(props.onNotice).toHaveBeenCalledTimes(2)
  })

  it('with no query the search lists the notes opened most recently, newest first', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    escape()
    await typeQuery('beta')
    await openResult()
    render(2)
    await flush()
    expect(rows()).toEqual(['Beta', 'Alpha'])
    expect(top().querySelector('.explore__group')?.textContent).toBe('Opened')
    await openResult()
    expect(top().querySelector('.explore__title')?.textContent).toBe('beta')
  })

  it('a folder of a vault (YAZ-4922 D3): the search finds only the notes under the folder, and its recents list only them', async () => {
    index.mockResolvedValue({ root: '/v', records: [...RECORDS, rec('/v/wiki/hooks.md', 'Hooks'), rec('/v/wiki/react.md', 'React hooks')], folders: [], generatedAt: 1, ids: false, size: 5 })
    rememberExploreRecent('/v/beta.md')
    rememberExploreRecent('/v/wiki/react.md')
    props = { ...props, vaults: [{ root: '/v', watch, dirs: ['/v/wiki'], files: [], folder: '/v/wiki' }] }
    await mount()
    // With no query: the recents under the folder only.
    expect(rows()).toEqual(['React hooks'])
    await typeQuery('hooks')
    expect(rows()).toEqual(['Hooks', 'React hooks'])
    // Alpha and Beta are notes of the vault, outside the folder: not found.
    await typeQuery('alp')
    expect(rows()).toEqual([])
    await typeQuery('beta')
    expect(rows()).toEqual([])
  })

  it('round 1: the id of a note in an ID vault shows after its title, small and muted; a note without one shows none', async () => {
    await mount()
    await typeQuery('alp')
    expect(top().querySelector('.search-results__row .explore__id')?.textContent).toBe('EMB-1')
    await typeQuery('bet')
    expect(top().querySelector('.search-results__row .explore__id')).toBeNull()
  })

  it('round 1: a reading note draws board embeds as windows and pills with icons, and under it the comment stream and Linked mentions; a mention opens on top; the head has the fold-all button', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    const opts = crepes[0].opts
    expect(opts.boardEmbeds).toEqual({ root: '/v' })
    // The vault's view-only catalog: a board embed resolves its drawing through it (else "Missing drawing").
    expect(opts.viewOnlyLinks).toBe(viewOnly)
    expect(typeof (opts.linkLook as { icon: unknown }).icon).toBe('function')
    expect(opts.image).toEqual({ root: '/v', notePath: '/v/alpha.md' })
    expect(under.comments.at(-1)).toMatchObject({ path: '/v/alpha.md', order: 'oldest' })
    expect(under.comments.at(-1)?.content).toContain('# /v/alpha.md')
    expect(under.backlinks).toContain('/v/alpha.md')
    expect(top().querySelector('.explore__under .comments')).not.toBeNull()
    // The fold-all button, the note tab's own, in the head: its command runs on this layer's view.
    const fold = top().querySelector<HTMLButtonElement>('.explore__head .fold-all__trigger')
    expect(fold).not.toBeNull()
    expect(fold?.nextElementSibling?.textContent).toContain('Edit')
    act(() => fold?.click())
    await flush()
    expect(folds.runs).toEqual([true])
    // A mention click: that note on top, the first layer still there.
    act(() => top().querySelector<HTMLButtonElement>('.mention')?.click())
    await flush()
    await flush()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note', 'note'])
    expect(top().querySelector('.explore__title')?.textContent).toBe('beta')
  })

  it('round 1, item 5: Esc in edit goes back to reading (the same layer, the note read again); Done does the same; ⌘E is no key of the stack; a second Esc closes the layer', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    const layer = top()
    expect(readFile).toHaveBeenCalledTimes(1)
    // ⌘E does nothing here (Yaseen's ⌘E is his emoji app's; in the editor it is Inline code): E alone edits.
    key(document.activeElement as Element, { key: 'e', metaKey: true })
    await flush()
    expect(top().querySelector('.explore__mode')).toBeNull()
    key(document.activeElement as Element, { key: 'e' })
    await flush()
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Editing')
    expect(top().querySelector('.explore__head .fold-all__trigger')).toBeNull()
    escape()
    await flush()
    await flush()
    expect(top()).toBe(layer)
    expect(layers()).toHaveLength(2)
    expect(top().querySelector('.explore__mode')).toBeNull()
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(top().querySelector('.explore__body'))
    // Done, from a click.
    act(() => top().querySelector<HTMLButtonElement>('.explore__button')?.click())
    await flush()
    const done = [...top().querySelectorAll<HTMLButtonElement>('.explore__button')].find((b) => b.textContent?.startsWith('Done'))
    expect(done).toBeDefined()
    act(() => done?.click())
    await flush()
    expect(top().querySelector('.explore__mode')).toBeNull()
    escape()
    expect(layers()).toHaveLength(1)
  })

  it('round 1, items 6 and 7: a right-click on a result and on a note head opens the note menu, Yaseen\'s rows in his order; an open, Show in sidebar and Rename file close the stack, Copy path keeps it; the mini window asks the folder page on screen', async () => {
    await mount()
    await typeQuery('alp')
    const row = top().querySelector<HTMLElement>('.search-results__row') as HTMLElement
    act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
    expect(items().map((b) => b.textContent)).toEqual(['Open in new tab', 'Open in new window', 'Open in mini window', 'Show in sidebar', 'Add to focus', 'Copy path', 'Rename file', 'Remove from favorites', 'Reveal in Finder', 'Open in VS Code'])
    // Not there: Set display name, Change icon, Delete, Cut, Paste.
    act(() => items().find((b) => b.textContent === 'Copy path')?.click())
    expect(props.onClose).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    act(() => void row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
    act(() => items().find((b) => b.textContent === 'Open in new window')?.click())
    expect(props.linkActions?.openNewWindow).toHaveBeenCalledExactlyOnceWith('/v/alpha.md')
    expect(props.onClose).toHaveBeenCalledTimes(1)
    // The head of a note layer: the same menu; Rename file takes the tab menu's path and closes the stack.
    await openResult()
    act(() => void top().querySelector('.explore__head')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
    expect(items()).toHaveLength(10)
    act(() => items().find((b) => b.textContent === 'Rename file')?.click())
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/alpha.md')
    expect(props.onClose).toHaveBeenCalledTimes(2)
    // Open in mini window: no folder page on screen says so; one that takes it opens its card.
    act(() => void top().querySelector('.explore__head')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
    act(() => items().find((b) => b.textContent === 'Open in mini window')?.click())
    expect(props.onNotice).toHaveBeenLastCalledWith(NO_FOLDER_PAGE_NOTICE)
    const took: string[] = []
    const off = onNoteWindowRequest((path) => {
      took.push(path)
      return true
    })
    act(() => void top().querySelector('.explore__head')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
    act(() => items().find((b) => b.textContent === 'Open in mini window')?.click())
    off()
    expect(took).toEqual(['/v/alpha.md'])
    expect(props.onClose).toHaveBeenCalledTimes(4)
    // Esc inside the open menu closes the menu alone.
    act(() => void top().querySelector('.explore__head')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })))
    const before = layers().length
    key(el.querySelector('.ctx-menu [role="menuitem"]') as Element, { key: 'Escape' })
    expect(layers()).toHaveLength(before)
  })

  it('leaving edit flushes the editor\'s pending save FIRST and reads after it: Esc at once shows the typed text; a close in edit flushes too', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    key(document.activeElement as Element, { key: 'e' })
    await flush()
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Editing')
    // The editor's autosave handle, as `useAutosave` registers it: the typed text reaches the disk only when flushed, a tick later.
    const disk = { content: '# /v/alpha.md\n\nthe body of /v/alpha.md\n' }
    readFile.mockImplementation(async (path) => ({ path, content: path === '/v/alpha.md' ? disk.content : `# ${path}\n`, mtime: 1, size: 1 }))
    const order: string[] = []
    const off = registerRenameContinuity('/v/alpha.md', {
      flush: async () => {
        await new Promise((r) => setTimeout(r, 0))
        disk.content = '# /v/alpha.md\n\ntyped at once\n'
        order.push('flushed')
      },
      capture: () => null,
      retire: () => undefined,
    })
    readFile.mockClear()
    escape()
    // Still editing while the save is on its way: no read yet.
    expect(readFile).not.toHaveBeenCalled()
    for (let i = 0; i < 4; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
    readFile.mock.calls.forEach(() => order.push('read'))
    expect(order).toEqual(['flushed', 'read'])
    expect(top().querySelector('.explore__mode')).toBeNull()
    expect(crepes.at(-1)?.opts.defaultValue).toContain('typed at once')
    expect(disk.content).toContain('typed at once')
    // A close while editing goes through the same flush door.
    key(document.activeElement as Element, { key: 'e' })
    await flush()
    const flushes = order.length
    escape()
    for (let i = 0; i < 3; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
    expect(order.filter((o) => o === 'flushed')).toHaveLength(2)
    expect(order.length).toBeGreaterThan(flushes)
    off()
  })

  it('YAZ-4925 + round 6: a trail of chips from two layers on, the front one bold; a click brings that layer to the front, every layer stays, each keeps its scroll', async () => {
    await mount()
    expect(el.querySelector('.explore__trail')).toBeNull()
    await typeQuery('alp')
    await openResult()
    const bodyA = top().querySelector<HTMLElement>('.explore__body') as HTMLElement
    bodyA.scrollTop = 210
    render(2)
    await flush()
    await typeQuery('beta')
    await openResult()
    const chips = () => [...el.querySelectorAll<HTMLButtonElement>('.explore__chip')]
    const bold = () => chips().map((c) => [c.textContent, c.classList.contains('explore__chip--top'), c.getAttribute('aria-current')])
    expect(bold()).toEqual([['Search', false, null], ['alpha', false, null], ['Search', false, null], ['beta', true, 'true']])
    act(() => chips()[1].click())
    await flush()
    // Nothing closes: alpha comes to the front, in its own place, at its scroll, with the keyboard.
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note', 'search', 'note'])
    const front = live().filter((l) => !l.classList.contains('explore__layer--covered'))
    expect(front).toEqual([layers()[1]])
    expect(bodyA.scrollTop).toBe(210)
    expect(document.activeElement).toBe(bodyA)
    expect(bold()).toEqual([['Search', false, null], ['alpha', true, 'true'], ['Search', false, null], ['beta', false, null]])
    // The front chip does nothing.
    act(() => chips()[1].click())
    expect(layers()).toHaveLength(4)
    expect(bodyA.scrollTop).toBe(210)
  })

  it('YAZ-4926: ⇧Esc closes every layer from any depth, a note in edit flushed first; plain Esc still goes back one', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    render(2)
    await flush()
    await typeQuery('beta')
    await openResult()
    key(document.activeElement as Element, { key: 'e' })
    await flush()
    expect(layers()).toHaveLength(4)
    const flushed: string[] = []
    const off = registerRenameContinuity('/v/beta.md', { flush: async () => void flushed.push('beta'), capture: () => null, retire: () => undefined })
    key(document.activeElement as Element, { key: 'Escape', shiftKey: true })
    off()
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(flushed).toEqual(['beta'])
    // The stack itself is App's to unmount: its layers are still here until then, none popped by the ⇧Esc.
    expect(layers()).toHaveLength(4)
  })

  it('check 22: Esc during an IME composition (Japanese input) cancels the composition only, never a layer', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    expect(layers()).toHaveLength(2)
    // A composing Esc: `isComposing` true (keyCode 229 on some keyboards): the IME takes it.
    const composing = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true })
    act(() => void (document.activeElement as Element).dispatchEvent(composing))
    expect(layers()).toHaveLength(2)
    expect(composing.defaultPrevented).toBe(false)
    const code229 = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, keyCode: 229 } as KeyboardEventInit)
    act(() => void (document.activeElement as Element).dispatchEvent(code229))
    expect(layers()).toHaveLength(2)
    escape()
    expect(layers()).toHaveLength(1)
  })

  it('check 21: a note open in a layer renamed elsewhere follows (its title, chip and read at the new path); deleted, the layer says it is gone', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    render(2)
    await flush()
    expect(top().dataset.kind).toBe('search')
    readFile.mockClear()
    // App's `file:renamed` door (the one the recents follow too).
    act(() => moveExploreRecent('/v/alpha.md', '/v/renamed.md'))
    await flush()
    await flush()
    const note = layers()[1]
    expect(note.querySelector('.explore__title')?.textContent).toBe('renamed')
    expect([...el.querySelectorAll('.explore__chip')].map((c) => c.textContent)).toEqual(['Search', 'renamed', 'Search'])
    expect(readFile).toHaveBeenCalledWith('/v/renamed.md')
    // Deleted: the read fails, and the layer says so.
    readFile.mockImplementation(async () => {
      throw new Error('ENOENT')
    })
    act(() => moveExploreRecent('/v/renamed.md', null))
    await flush()
    await flush()
    expect(note.querySelector('.editor-msg')?.textContent).toContain('no longer there')
  })

  it('check 11: ⌘F inside a reading layer finds in THAT note, and the tab\'s find bar behind the stack stays shut', async () => {
    // The tab behind: a note editor's find bar on its own mount, as `Editor.tsx` mounts it.
    const tabRoot = document.createElement('div')
    tabRoot.innerHTML = '<div class="editor-mount"><div class="ProseMirror"></div></div>'
    document.body.appendChild(tabRoot)
    const tabChannel = createFindChannel()
    const tabHost = { current: tabRoot.querySelector<HTMLElement>('.editor-mount') }
    const tab = createRoot(tabRoot)
    act(() => tab.render(<FindBar channel={tabChannel} scope="note" hostRef={tabHost} />))
    await mount()
    await typeQuery('alp')
    await openResult()
    expect(document.activeElement).toBe(top().querySelector('.explore__body'))
    act(() => void (document.activeElement as Element).dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true })))
    await flush()
    expect(tabChannel.getState().open).toBe(false)
    expect(top().querySelector('.find-bar')).not.toBeNull()
    expect(crepes[0].opts.find).toBeDefined()
    // Esc in the bar closes the bar alone (it takes the key with the focus still in the layer).
    const bar = top().querySelector<HTMLInputElement>('.find-bar__input') as HTMLInputElement
    expect(document.activeElement).toBe(bar)
    act(() => tab.unmount())
    tabRoot.remove()
  })

  it('YAZ-4936: an ask with a note opens it as a reading layer with no search under it; Esc closes the stack', async () => {
    props.requestNote = '/v/beta.md'
    await mount()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['note'])
    expect(top().querySelector('.explore__title')?.textContent).toBe('beta')
    expect(top().querySelector('.explore__mode')).toBeNull()
    escape()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('YAZ-4940: with "Only when the search matches the ID" the chip shows on a row found by its ID alone, and the title loses the "ID — " of its label; Always shows it on every row', async () => {
    const rule = { value: 'match' as 'match' | 'always' }
    props.vaults = [{ ...vaults[0], idsInSearch: () => rule.value }]
    await mount()
    await typeQuery('alp')
    expect(top().querySelector('.search-results__row .explore__id')).toBeNull()
    await typeQuery('emb-1')
    expect(top().querySelector('.search-results__row .explore__id')?.textContent).toBe('EMB-1')
    expect(rows()).toEqual(['Alpha'])
    rule.value = 'always'
    await typeQuery('alp')
    expect(top().querySelector('.search-results__row .explore__id')?.textContent).toBe('EMB-1')
    expect(rows()).toEqual(['Alpha'])
  })

  it('YAZ-4940: "Show IDs in the title" On draws the note ID after the layer head title; Off draws none', async () => {
    const withIds = createWikilinkResolveSource()
    withIds.update(() => null, RECORDS, [], true)
    props.vaultOf = () => ({ root: '/v', wikilinks: withIds, wikilinkCandidates: candidates, viewOnlyLinks: viewOnly })
    props.requestNote = '/v/alpha.md'
    props.vaults = [{ ...vaults[0], idsInTitle: () => true }]
    await mount()
    expect(top().querySelector('.explore__head .explore__title + .explore__id')?.textContent).toBe('EMB-1')
    props.vaults = [{ ...vaults[0], idsInTitle: () => false }]
    render(1)
    await flush()
    expect(top().querySelector('.explore__head .explore__id')).toBeNull()
  })

  it('with motion on, a leaving layer plays its exit (150 ms for a note) and is gone after it; the keys go on to the layer under it at once', async () => {
    Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false }), configurable: true, writable: true })
    vi.useFakeTimers()
    try {
      await mount()
      await typeQuery('alp')
      await openResult()
      expect(top().classList.contains('explore__layer--in')).toBe(true)
      expect(top().style.getPropertyValue('--explore-ms')).toBe('150ms')
      escape()
      expect(layers()).toHaveLength(2)
      expect(layers()[1].classList.contains('explore__layer--out')).toBe(true)
      expect(top().dataset.kind).toBe('search')
      act(() => void vi.advanceTimersByTime(160))
      expect(layers()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('round 3: ‹ › through the search, and layers that move like a cell note', () => {
  const TITLE_PATH: Record<string, string> = { Alpha: '/v/alpha.md', Beta: '/v/beta.md', 'conjecture (vocab)': '/v/conjecture.md' }
  const stepButtons = () => [...top().querySelectorAll<HTMLButtonElement>('.explore__step')]
  const count = () => top().querySelector('.explore__count')?.textContent
  const title = () => top().querySelector('.explore__title')?.textContent
  const body = () => top().querySelector<HTMLElement>('.explore__body') as HTMLElement
  const activeRow = () => layers()[0].querySelector('.search-results__row--active')?.getAttribute('aria-label')
  const mouse = (target: EventTarget, type: string, x: number, y: number) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })))
  /** A press on `handle`, `moves` pointer moves, then the drop. */
  const drag = (handle: Element, moves: ReadonlyArray<[number, number]>, drop = true) => {
    mouse(handle, 'mousedown', 100, 100)
    for (const [dx, dy] of moves) mouse(window, 'mousemove', 100 + dx, 100 + dy)
    if (drop) mouse(window, 'mouseup', 100 + (moves[moves.length - 1]?.[0] ?? 0), 100 + (moves[moves.length - 1]?.[1] ?? 0))
  }
  const px = (v: string) => parseInt(v, 10)
  beforeEach(() => {
    localStorage.removeItem('explore:box:search')
    localStorage.removeItem('explore:box:note')
  })

  it('a note opened from a search shows "n/m" and steps through the results in the search\'s order, in the SAME layer; Esc returns to the search with the row you stopped on selected', async () => {
    await mount()
    await typeQuery('a')
    const paths = rows().map((t) => TITLE_PATH[t])
    expect(paths).toHaveLength(3)
    await openResult()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note'])
    const layer = top()
    expect(count()).toBe('1/3')
    expect(stepButtons().map((b) => b.disabled)).toEqual([true, false])
    // → on the reading body: the next result, the same layer, read at once; the search's row follows.
    key(body(), { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    await flush()
    expect(top()).toBe(layer)
    expect(layers()).toHaveLength(2)
    expect(readFile).toHaveBeenLastCalledWith(paths[1])
    expect(title()).toBe(props.nameOf(paths[1]))
    expect(count()).toBe('2/3')
    expect(activeRow()).toContain(rows.call(null) === undefined ? '' : '')
    expect(layers()[0].querySelector('.search-results__row--active')?.getAttribute('title')).toBe(paths[1])
    // › by the button: the last one; then nothing further.
    act(() => stepButtons()[1].click())
    await flush()
    await flush()
    expect(readFile).toHaveBeenLastCalledWith(paths[2])
    expect(count()).toBe('3/3')
    expect(stepButtons().map((b) => b.disabled)).toEqual([false, true])
    key(body(), { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    expect(count()).toBe('3/3')
    // ← goes back; the trail's chip says the note now.
    key(body(), { key: 'ArrowLeft', code: 'ArrowLeft' })
    await flush()
    await flush()
    expect(count()).toBe('2/3')
    expect([...el.querySelectorAll('.explore__chip')].map((c) => c.textContent)).toEqual(['Search', props.nameOf(paths[1])])
    // Esc: back to the search, the row you stopped on selected, the caret in the input.
    await escape()
    expect(top().dataset.kind).toBe('search')
    expect(top().querySelector('.search-results__row--active')?.getAttribute('title')).toBe(paths[1])
    expect(document.activeElement).toBe(input())
  })

  it('← → step only while reading (the caret\'s keys in the editor or a field); ⌘⌥↓ / ⌘⌥↑ step in edit too, the pending save flushed first, the editor mounted on the next note', async () => {
    await mount()
    await typeQuery('a')
    const paths = rows().map((t) => TITLE_PATH[t])
    await openResult()
    // In a field, → is the field's.
    const field = document.createElement('input')
    body().appendChild(field)
    key(field, { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    expect(count()).toBe('1/3')
    field.remove()
    key(body(), { key: 'e' })
    await flush()
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Editing')
    expect(editors[editors.length - 1]).toBe(paths[0])
    const editor = () => top().querySelector('[data-editor]') as HTMLElement
    key(editor(), { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    expect(count()).toBe('1/3')
    const flushed: string[] = []
    const off = registerRenameContinuity(paths[0], { flush: async () => void flushed.push('flushed'), capture: () => null, retire: () => undefined })
    key(editor(), { key: 'ArrowDown', code: 'ArrowDown', metaKey: true, altKey: true })
    await flush()
    await flush()
    expect(flushed).toEqual(['flushed'])
    expect(count()).toBe('2/3')
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Editing')
    expect(editors[editors.length - 1]).toBe(paths[1])
    expect(top().querySelector(`[data-editor="${paths[1]}"]`)).not.toBeNull()
    key(editor(), { key: 'ArrowUp', code: 'ArrowUp', metaKey: true, altKey: true })
    await flush()
    await flush()
    expect(count()).toBe('1/3')
    off()
  })

  it('a note opened from a link has no ‹ ›; a new search on top: the next note\'s ‹ › follow that search', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    expect(top().querySelector('.explore__steps')).not.toBeNull()
    act(() => crepes[0].opts.wikilinkNav?.openCurrent('/v/beta.md'))
    await flush()
    await flush()
    expect(title()).toBe('beta')
    expect(top().querySelector('.explore__steps')).toBeNull()
    key(body(), { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    expect(layers()).toHaveLength(3)
    expect(title()).toBe('beta')
    render(2)
    await flush()
    await typeQuery('a')
    const paths = rows().map((t) => TITLE_PATH[t])
    await openResult()
    expect(count()).toBe('1/3')
    key(body(), { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    await flush()
    expect(title()).toBe(props.nameOf(paths[1]))
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note', 'note', 'search', 'note'])
  })

  it('drag the head: the layer follows by its style only (no render, the keyboard stays); the grips resize; a double click on the head puts it back', async () => {
    const nameOf = vi.fn((path: string) => path.slice(3, -3))
    props = { ...props, nameOf }
    await mount()
    await typeQuery('alp')
    await openResult()
    const note = top()
    const home = layerPlace('note', 1, window.innerWidth)
    const margin = Math.round(window.innerHeight * 0.1)
    expect([note.style.left, note.style.top, note.style.width]).toEqual([`${home.left}px`, `${margin + home.top}px`, `${home.width}px`])
    const renders = nameOf.mock.calls.length
    const head = note.querySelector('.explore__head') as HTMLElement
    drag(head, [[10, 5], [25, 20], [40, 30]], false)
    expect([note.style.left, note.style.top]).toEqual([`${home.left + 40}px`, `${margin + home.top + 30}px`])
    expect(el.querySelector('.explore')?.classList.contains('explore--tracking')).toBe(true)
    mouse(window, 'mouseup', 140, 130)
    expect(el.querySelector('.explore')?.classList.contains('explore--tracking')).toBe(false)
    expect(nameOf.mock.calls.length).toBe(renders)
    expect(document.activeElement).toBe(body())
    expect(note.style.height).toBe('')
    // The south-east grip: wider and taller, the height read once at the press.
    Object.defineProperty(note, 'offsetHeight', { value: 400, configurable: true })
    drag(note.querySelector('[data-grip="se"]') as Element, [[50, 60]])
    expect([note.style.left, note.style.width, note.style.height]).toEqual([`${home.left + 40}px`, '770px', '460px'])
    expect(note.hasAttribute('data-sized')).toBe(true)
    // The west grip moves the left edge and keeps the right one.
    drag(note.querySelector('[data-grip="w"]') as Element, [[-20, 0]])
    expect([note.style.left, note.style.width]).toEqual([`${home.left + 20}px`, '790px'])
    expect(nameOf.mock.calls.length).toBe(renders)
    // Double-click the head: back to its stack place and size.
    act(() => void head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect([note.style.left, note.style.top, note.style.width, note.style.height]).toEqual([`${home.left}px`, `${margin + home.top}px`, `${home.width}px`, ''])
    expect(note.hasAttribute('data-sized')).toBe(false)
    // A press on a head button is the button's, not a drag.
    drag(note.querySelector('.explore__button') as Element, [[30, 30]])
    expect(note.style.left).toBe(`${home.left}px`)
    // The note is the second layer: nothing kept for it.
    expect(localStorage.getItem('explore:box:note')).toBeNull()
  })

  it('the first layer\'s place and size are kept for this window: the next stack opens it there, with the layer over it next to it; a double click forgets it', async () => {
    await mount()
    const search = top()
    const start = { left: px(search.style.left), top: px(search.style.top) }
    expect(start).toEqual({ left: layerPlace('search', 0, window.innerWidth).left, top: Math.round(window.innerHeight * 0.1) })
    drag(search.querySelector('.explore__grab') as Element, [[30, 20]])
    expect(JSON.parse(localStorage.getItem('explore:box:search') ?? 'null')).toEqual({ x: start.left + 30, y: start.top + 20, width: 500, height: null })
    expect(document.activeElement).toBe(input())
    act(() => root?.unmount())
    el.remove()
    await mount()
    expect([top().style.left, top().style.top]).toEqual([`${start.left + 30}px`, `${start.top + 20}px`])
    await typeQuery('alp')
    await openResult()
    const home = layerPlace('note', 1, window.innerWidth)
    expect([top().style.left, top().style.top]).toEqual([`${home.left + 30}px`, `${Math.round(window.innerHeight * 0.1) + home.top + 20}px`])
    await escape()
    act(() => void (top().querySelector('.explore__grab') as Element).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect([top().style.left, top().style.top]).toEqual([`${start.left}px`, `${start.top}px`])
    expect(localStorage.getItem('explore:box:search')).toBeNull()
  })

  /** Six notes opened before, newest first: `/v/n1.md` … `/v/n6.md`, the empty search's list. */
  const SIX = ['/v/n1.md', '/v/n2.md', '/v/n3.md', '/v/n4.md', '/v/n5.md', '/v/n6.md']
  const rememberSix = () => [...SIX].reverse().forEach((p) => rememberExploreRecent(p))

  it('YAZ-2571 bug: from the Recent list (no query) the ‹ n/m › count follows each step: 2/6 → 3/6 → 4/6, ‹ back to 3/6; the list does not move under the note', async () => {
    rememberSix()
    await mount()
    expect(rows()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    key(input(), { key: 'ArrowDown' })
    await openResult()
    expect(title()).toBe('n2')
    expect(count()).toBe('2/6')
    key(body(), { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    await flush()
    expect(title()).toBe('n3')
    expect(count()).toBe('3/6')
    act(() => stepButtons()[1].click())
    await flush()
    await flush()
    expect(title()).toBe('n4')
    expect(count()).toBe('4/6')
    key(body(), { key: 'ArrowLeft', code: 'ArrowLeft' })
    await flush()
    await flush()
    expect(title()).toBe('n3')
    expect(count()).toBe('3/6')
    // The list under it kept its order; Esc returns to the row you stopped on.
    await escape()
    expect(rows()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    expect(top().querySelector('.search-results__row--active')?.getAttribute('title')).toBe('/v/n3.md')
    // A new search lists the notes opened most recently, the stepped ones first.
    render(2)
    await flush()
    expect(rows().slice(0, 3)).toEqual(['n3', 'n4', 'n2'])
  })

  const TITLE_PATH_QUERY: Record<string, string> = { '/v/alpha.md': 'alp', '/v/beta.md': 'beta', '/v/conjecture.md': 'conj' }
  it('YAZ-2571 bug: the count follows a change of the rows under the note (the search raised and typed in): it is never one render late', async () => {
    await mount()
    await typeQuery('a')
    const paths = rows().map((t) => TITLE_PATH[t])
    key(input(), { key: 'ArrowDown' })
    key(input(), { key: 'ArrowDown' })
    await openResult()
    const note = top()
    expect(count()).toBe('3/3')
    // The search to the front, a query that keeps only the note: its count reads 1/1 at once.
    const search = layers()[0]
    act(() => void search.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })))
    await flush()
    const field = search.querySelector('.explore__input') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, TITLE_PATH_QUERY[paths[2]])
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    const shown = [...search.querySelectorAll('.search-results__row')].map((r) => r.getAttribute('title'))
    expect(shown.length).toBeLessThan(3)
    expect(note.querySelector('.explore__count')?.textContent).toBe(`${shown.indexOf(paths[2]) + 1}/${shown.length}`)
  })
})

describe('round 4: zoom in a note layer', () => {
  const pill = (layer: HTMLElement = top()) => layer.querySelector<HTMLElement>('.explore__head .document-zoom')
  const value = () => pill()?.querySelector('.document-zoom__value')?.textContent
  const bodyZoom = () => top().querySelector<HTMLElement>('.explore__body')?.style.getPropertyValue('--document-zoom')
  const setInput = (field: HTMLInputElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  beforeEach(() => localStorage.removeItem('explore:zoom'))

  it('the page zoom\'s pill sits in a note head (not a search head): − steps the ladder, a typed value applies, and the body carries --document-zoom', async () => {
    await mount()
    expect(pill()).toBeNull()
    await typeQuery('alp')
    await openResult()
    expect(pill()).not.toBeNull()
    expect(value()).toBe('100%')
    expect(bodyZoom()).toBe('1')
    const buttons = () => [...(pill()?.querySelectorAll<HTMLButtonElement>('.document-zoom__step') ?? [])]
    act(() => buttons()[0].click())
    expect(value()).toBe('90%')
    expect(bodyZoom()).toBe('0.9')
    act(() => buttons()[1].click())
    act(() => buttons()[1].click())
    expect(value()).toBe('125%')
    // The menu: a typed value.
    act(() => pill()?.querySelector<HTMLButtonElement>('.document-zoom__trigger')?.click())
    const field = pill()?.querySelector('input') as HTMLInputElement
    act(() => setInput(field, '75%'))
    key(field, { key: 'Enter' })
    expect(value()).toBe('75%')
    expect(bodyZoom()).toBe('0.75')
    expect(localStorage.getItem('explore:zoom')).toBe('75')
    // Editing: the edit body carries the same value.
    key(top().querySelector('.explore__body') as HTMLElement, { key: 'e' })
    await flush()
    expect(top().querySelector<HTMLElement>('.explore__body--edit')?.style.getPropertyValue('--document-zoom')).toBe('0.75')
    expect(value()).toBe('75%')
  })

  it('one zoom for every note layer, kept across stacks; ⌘+ / ⌘− / ⌘0 zoom the top note layer only and never reach the tab behind', async () => {
    const tab = vi.fn()
    document.body.addEventListener('yaseendocs:zoom', tab)
    const unclaimed = vi.fn()
    await mount()
    // A search on top: the keys do nothing, to the stack or to the tab behind.
    act(() => requestZoom(1, unclaimed))
    expect(unclaimed).not.toHaveBeenCalled()
    expect(localStorage.getItem('explore:zoom')).toBeNull()
    await typeQuery('alp')
    await openResult()
    act(() => requestZoom(1, unclaimed))
    expect(value()).toBe('125%')
    act(() => requestZoom(1, unclaimed))
    expect(value()).toBe('150%')
    act(() => requestZoom(-1, unclaimed))
    expect(value()).toBe('125%')
    // A note over it, from a link, opens at the same zoom; a step there is the one value.
    act(() => crepes[0].opts.wikilinkNav?.openCurrent('/v/beta.md'))
    await flush()
    await flush()
    expect(value()).toBe('125%')
    act(() => requestZoom(0, unclaimed))
    expect(value()).toBe('100%')
    await escape()
    expect(value()).toBe('100%')
    act(() => requestZoom(-1, unclaimed))
    expect(value()).toBe('90%')
    expect(unclaimed).not.toHaveBeenCalled()
    expect(tab).not.toHaveBeenCalled()
    expect(localStorage.getItem('explore:zoom')).toBe('90')
    // The next stack of this window opens its notes at 90%; with the stack gone the keys are the page's again.
    act(() => root?.unmount())
    el.remove()
    act(() => requestZoom(1, unclaimed))
    expect(unclaimed).toHaveBeenCalledOnce()
    expect(localStorage.getItem('explore:zoom')).toBe('90')
    await mount()
    await typeQuery('alp')
    await openResult()
    expect(value()).toBe('90%')
    expect(bodyZoom()).toBe('0.9')
    document.body.removeEventListener('yaseendocs:zoom', tab)
  })
})

describe('round 5: find a note by a short ID number (YAZ-2571)', () => {
  const EMB = [
    rec('/v/emb-5.md', '04 Resize04 Resize04 Resize04 Resize04 Resize04 Resize04', { id: 'EMB-5' }),
    rec('/v/emb-6.md', '05 The view is remembered', { id: 'EMB-6' }),
    rec('/v/emb-16.md', '15 Read-only note', { id: 'EMB-16' }),
    rec('/v/emb-3.md', 'Three', { id: 'EMB-3' }),
    rec('/v/emb-37.md', '25 Table subheader rows', { id: 'EMB-37' }),
  ]
  const chips = () => [...top().querySelectorAll('.search-results__row')].map((r) => r.querySelector('.explore__id')?.innerHTML ?? null)
  beforeEach(() => {
    index.mockResolvedValue({ root: '/v', records: EMB, folders: [], generatedAt: 1, ids: true, size: EMB.length })
  })

  it('`#5` shows EMB-5 alone, its chip with the 5 marked; `#3` shows EMB-3, then EMB-37', async () => {
    await mount()
    await typeQuery('#5')
    expect(rows()).toEqual(['04 Resize04 Resize04 Resize04 Resize04 Resize04 Resize04'])
    expect(chips()).toEqual(['EMB-<mark class="tree__mark">5</mark>'])
    await typeQuery('#3')
    expect(chips()).toEqual(['EMB-<mark class="tree__mark">3</mark>', 'EMB-<mark class="tree__mark">3</mark>7'])
  })

  it('a bare `5` shows EMB-5 first, its 5 marked; a row found by its title keeps a plain chip', async () => {
    await mount()
    await typeQuery('5')
    expect(rows()[0]).toBe('04 Resize04 Resize04 Resize04 Resize04 Resize04 Resize04')
    expect(chips()).toEqual(['EMB-<mark class="tree__mark">5</mark>', 'EMB-6', 'EMB-16', 'EMB-37'])
    for (const typed of ['emb-5', 'EMB5', 'emb 5']) {
      await typeQuery(typed)
      expect(chips()[0]).toBe('EMB-<mark class="tree__mark">5</mark>')
    }
  })

  it('with "Only when the search matches the ID" the chip of `#5` shows too', async () => {
    props.vaults = [{ ...vaults[0], idsInSearch: () => 'match' }]
    await mount()
    await typeQuery('#5')
    expect(chips()).toEqual(['EMB-<mark class="tree__mark">5</mark>'])
  })

  it('a long name is cut on its own: the chip stands outside the part that is cut', async () => {
    await mount()
    await typeQuery('#5')
    const label = top().querySelector('.search-results__row .search-results__label') as HTMLElement
    expect([...label.children].map((c) => c.className)).toEqual(['explore__name', 'explore__id'])
    expect(label.querySelector('.explore__name .explore__id')).toBeNull()
  })

  it('a vault without IDs is unchanged: `#5` reads as text', async () => {
    index.mockResolvedValue({ root: '/v', records: [rec('/v/release.md', 'Release #5'), rec('/v/plan.md', 'Plan 5')], folders: [], generatedAt: 1, ids: false, size: 2 })
    await mount()
    await typeQuery('#5')
    expect(rows()).toEqual(['Release #5', 'Plan 5'])
    expect(chips()).toEqual([null, null])
  })
})

describe('round 6: layers act like windows (YAZ-2571): a click on a layer behind brings it to the front', () => {
  const TITLE_PATH: Record<string, string> = { Alpha: '/v/alpha.md', Beta: '/v/beta.md', 'conjecture (vocab)': '/v/conjecture.md' }
  /** The front layer: the one live layer that is not covered. */
  const front = () => {
    const shown = live().filter((l) => !l.classList.contains('explore__layer--covered'))
    expect(shown).toHaveLength(1)
    return shown[0]
  }
  const press = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })))
  const z = (layer: HTMLElement) => Number(layer.style.zIndex)
  const titleOf = (layer: HTMLElement) => layer.querySelector('.explore__title')?.textContent
  const countOf = (layer: HTMLElement) => layer.querySelector('.explore__count')?.textContent
  const activeRowOf = (layer: HTMLElement) => layer.querySelector('.search-results__row--active')?.getAttribute('title')
  const mouse = (target: EventTarget, type: string, x: number, y: number) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })))
  /** Search › alpha › Search › beta: two searches, each with the note it opened. */
  async function fourLayers() {
    await mount()
    await typeQuery('alp')
    await openResult()
    render(2)
    await flush()
    await typeQuery('beta')
    await openResult()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note', 'search', 'note'])
  }
  beforeEach(() => {
    localStorage.removeItem('explore:box:search')
    localStorage.removeItem('explore:box:note')
    localStorage.removeItem('explore:zoom')
  })

  it('a press on the search behind brings it to the front with the keyboard; it keeps its query, selection and list scroll; the note keeps its box, scroll, zoom and mode; a press on the note brings it back', async () => {
    await mount()
    await typeQuery('a')
    const paths = rows().map((t) => TITLE_PATH[t])
    key(input(), { key: 'ArrowDown' })
    await openResult()
    const [search, note] = layers()
    expect(countOf(note)).toBe('2/3')
    const body = note.querySelector('.explore__body') as HTMLElement
    body.scrollTop = 120
    const list = search.querySelector('.explore__results') as HTMLElement
    list.scrollTop = 40
    const box = [note.style.left, note.style.top, note.style.width]
    const zoomed = body.style.getPropertyValue('--document-zoom')
    // No layer is inert: every layer you can see takes the pointer.
    expect(layers().some((l) => l.hasAttribute('inert'))).toBe(false)
    expect(z(note)).toBeGreaterThan(z(search))
    press(list)
    await flush()
    expect(front()).toBe(search)
    expect(z(search)).toBeGreaterThan(z(note))
    expect(note.classList.contains('explore__layer--covered')).toBe(true)
    expect(note.getAttribute('aria-hidden')).toBe('true')
    expect(search.getAttribute('aria-hidden')).not.toBe('true')
    expect(document.activeElement).toBe(search.querySelector('.explore__input'))
    expect((search.querySelector('.explore__input') as HTMLInputElement).value).toBe('a')
    expect(activeRowOf(search)).toBe(paths[1])
    expect(list.scrollTop).toBe(40)
    // The list keeps its meaning: the same elements in the same order; the note did not move.
    expect(layers()).toEqual([search, note])
    expect([note.style.left, note.style.top, note.style.width]).toEqual(box)
    expect(body.scrollTop).toBe(120)
    // The keys go to the front layer only: E types in the search, ← → are the field's.
    key(search.querySelector('.explore__input') as HTMLElement, { key: 'e' })
    expect(note.querySelector('.explore__mode')).toBeNull()
    press(body)
    await flush()
    expect(front()).toBe(note)
    expect(document.activeElement).toBe(body)
    expect(body.scrollTop).toBe(120)
    expect(body.style.getPropertyValue('--document-zoom')).toBe(zoomed)
    // In edit, raised away and back: still in edit, the same editor.
    key(body, { key: 'e' })
    await flush()
    const editor = note.querySelector('[data-editor]')
    expect(editor).not.toBeNull()
    press(list)
    await flush()
    expect(front()).toBe(search)
    press(note.querySelector('.explore__head') as HTMLElement)
    await flush()
    expect(front()).toBe(note)
    expect(note.querySelector('.explore__mode')?.textContent).toBe('Editing')
    expect(note.querySelector('[data-editor]')).toBe(editor)
  })

  it('× on a layer behind closes that layer only; the next layer in the front order comes to the front', async () => {
    await fourLayers()
    const [s, alpha, s2, beta] = layers()
    const close = alpha.querySelector('[aria-label="Close this layer"]') as HTMLButtonElement
    press(close)
    act(() => close.click())
    await flush()
    expect(layers()).toEqual([s, s2, beta])
    expect(front()).toBe(beta)
    expect(document.activeElement).toBe(beta.querySelector('.explore__body'))
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('Esc closes the front layer, then the next in the front order; ⇧Esc still closes all', async () => {
    await fourLayers()
    const [s, alpha, s2, beta] = layers()
    press(alpha.querySelector('.explore__body') as HTMLElement)
    await flush()
    expect(front()).toBe(alpha)
    escape()
    await flush()
    expect(layers()).toEqual([s, s2, beta])
    expect(front()).toBe(beta)
    expect(document.activeElement).toBe(beta.querySelector('.explore__body'))
    // The first search to the front, then Esc: it closes, and beta (used before it) is the front again.
    press(s.querySelector('.explore__results') as HTMLElement)
    await flush()
    expect(front()).toBe(s)
    escape()
    await flush()
    expect(layers()).toEqual([s2, beta])
    expect(front()).toBe(beta)
    expect(props.onClose).not.toHaveBeenCalled()
    key(document.activeElement as Element, { key: 'Escape', shiftKey: true })
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('‹ › still follow the search that opened the note, after a raise; a second note from the same search marks its row there', async () => {
    await mount()
    await typeQuery('a')
    const paths = rows().map((t) => TITLE_PATH[t])
    await openResult()
    render(2)
    await flush()
    await typeQuery('beta')
    await openResult()
    const [s, n1, , n2] = layers()
    expect(countOf(n1)).toBe('1/3')
    expect(countOf(n2)).toBe('1/1')
    // The first note to the front: → steps through ITS search, the first one.
    const body = n1.querySelector('.explore__body') as HTMLElement
    press(body)
    await flush()
    key(body, { key: 'ArrowRight', code: 'ArrowRight' })
    await flush()
    await flush()
    expect(titleOf(n1)).toBe(props.nameOf(paths[1]))
    expect(countOf(n1)).toBe('2/3')
    expect(countOf(n2)).toBe('1/1')
    expect(activeRowOf(s)).toBe(paths[1])
    // The first search to the front: ↓ ↵ opens the next row as a new note in front, from that search.
    press(s.querySelector('.explore__results') as HTMLElement)
    await flush()
    key(s.querySelector('.explore__input') as HTMLElement, { key: 'ArrowDown' })
    key(s.querySelector('.explore__input') as HTMLElement, { key: 'Enter' })
    await flush()
    await flush()
    const n3 = layers()[4]
    expect(front()).toBe(n3)
    expect(countOf(n3)).toBe('3/3')
    expect(activeRowOf(s)).toBe(paths[2])
    key(n3.querySelector('.explore__body') as HTMLElement, { key: 'ArrowLeft', code: 'ArrowLeft' })
    await flush()
    await flush()
    expect(countOf(n3)).toBe('2/3')
    expect(activeRowOf(s)).toBe(paths[1])
  })

  it('a drag on a layer behind: the press brings it to the front, then it moves by its style only; a double click puts it back', async () => {
    const nameOf = vi.fn((path: string) => path.slice(3, -3))
    props = { ...props, nameOf }
    await mount()
    await typeQuery('alp')
    await openResult()
    const [search, note] = layers()
    const noteBox = [note.style.left, note.style.top]
    const start = { left: parseInt(search.style.left, 10), top: parseInt(search.style.top, 10) }
    const grab = search.querySelector('.explore__grab') as HTMLElement
    press(grab)
    await flush()
    expect(front()).toBe(search)
    const renders = nameOf.mock.calls.length
    mouse(grab, 'mousedown', 100, 100)
    for (const [dx, dy] of [[10, 5], [-200, 30], [-300, 40]]) mouse(window, 'mousemove', 100 + dx, 100 + dy)
    mouse(window, 'mouseup', -200, 140)
    expect([search.style.left, search.style.top]).toEqual([`${Math.max(0, start.left - 300)}px`, `${start.top + 40}px`])
    expect(nameOf.mock.calls.length).toBe(renders)
    expect([note.style.left, note.style.top]).toEqual(noteBox)
    act(() => void grab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect([search.style.left, search.style.top]).toEqual([`${start.left}px`, `${start.top}px`])
    // The note over it never followed: it was not moved, and it stays where it stood.
    expect([note.style.left, note.style.top]).toEqual(noteBox)
    expect(front()).toBe(search)
  })

  it('a press on a blank part of a layer (the search\'s footer) brings it to the front and keeps the keyboard in it: the mousedown takes no focus away', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    const [search] = layers()
    const foot = search.querySelector('.explore__foot') as HTMLElement
    press(foot)
    await flush()
    expect(front()).toBe(search)
    expect(document.activeElement).toBe(search.querySelector('.explore__input'))
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    act(() => void foot.dispatchEvent(down))
    expect(down.defaultPrevented).toBe(true)
    // A press on something that takes the focus keeps its own way: the input, the reading body.
    const inField = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    act(() => void (search.querySelector('.explore__input') as HTMLElement).dispatchEvent(inField))
    expect(inField.defaultPrevented).toBe(false)
  })

  it('Tab stays in the front layer and the trail: it never lands in a layer behind', async () => {
    await mount()
    await typeQuery('alp')
    await openResult()
    const [search, note] = layers()
    ;(note.querySelector('[aria-label="Close this layer"]') as HTMLElement).focus()
    const seen = new Set<Element>()
    for (let i = 0; i < 40; i++) {
      key(document.activeElement as Element, { key: 'Tab' })
      const at = document.activeElement as Element
      seen.add(at)
      expect(search.contains(at)).toBe(false)
      expect(note.contains(at) || at.closest('.explore__trail') !== null).toBe(true)
    }
    // It went round: the trail and the note's own buttons both had it.
    expect([...seen].some((e) => e.closest('.explore__trail') !== null)).toBe(true)
    expect([...seen].some((e) => note.contains(e))).toBe(true)
    key(document.activeElement as Element, { key: 'Tab', shiftKey: true })
    expect(search.contains(document.activeElement)).toBe(false)
  })
})

describe('YAZ-4943: drawings and diagrams open as reading layers', () => {
  const SKETCH = '/v/alpha-sketch.excalidraw'
  const FLOW = '/v/beta-flow.drawio'
  /** The board pills resolve here: a note and a board by name. */
  const boardLinks = createWikilinkResolveSource()
  const BY_NAME: Record<string, string> = { beta: '/v/beta.md', flow: FLOW }
  boardLinks.update((name) => BY_NAME[name] ?? null)
  const head = () => top().querySelector('.explore__head') as HTMLElement
  const buttons = () => [...head().querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)
  const press = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })))
  const board = (i = boards.made.length - 1) => boards.made[i]
  beforeEach(() => {
    localStorage.removeItem('explore:box:board')
    localStorage.removeItem('explore:box:search')
    props = { ...props, nameOf: (p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.(md|excalidraw|drawio)$/, ''), vaults: [{ ...vaults[0], files: [SKETCH, FLOW, '/v/paper.pdf'] }], vaultOf: () => ({ root: '/v', wikilinks: boardLinks, wikilinkCandidates: candidates, viewOnlyLinks: viewOnly }) }
  })

  it('a search result opens a drawing as a board layer (↵) and a diagram (a click): the view-only window fills it, read only, writing nothing', async () => {
    await mount()
    await typeQuery('sketch')
    expect(rows()).toContain('alpha-sketch.excalidraw')
    await openResult()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'board'])
    expect(props.openInTab).not.toHaveBeenCalled()
    const host = board().host
    expect(host).toMatchObject({ ref: { root: '/v', path: SKETCH, kind: 'drawing', name: 'alpha-sketch', vault: null }, options: null, editable: false, fill: true })
    expect(host.onOptions).toBeUndefined()
    expect(top().querySelector('[data-explore-board] .explore__board')?.firstChild).toBe(board().dom)
    // The board is never read as text: no file read for it.
    expect(readFile).not.toHaveBeenCalledWith(SKETCH)
    await escape()
    await typeQuery('flow')
    act(() => (top().querySelector('.search-results__row') as HTMLElement).click())
    await flush()
    await flush()
    expect(top().dataset.kind).toBe('board')
    expect(board().host.ref).toMatchObject({ path: FLOW, kind: 'diagram' })
    // A PDF still opens in a tab.
    await escape()
    await typeQuery('paper')
    await openResult()
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith('/v/paper.pdf')
  })

  it('the head: title, ‹ n/m ›, ↗, × — no Reading label (YAZ-4944), no Edit and no zoom pill; E does nothing; ⌘↵ and ↗ open the board in a tab', async () => {
    await mount()
    await typeQuery('sketch')
    await openResult()
    expect(head().querySelector('.explore__title')?.textContent).toBe('alpha-sketch')
    expect(head().querySelector('.explore__count')?.textContent).toBe('1/1')
    expect(head().querySelector('.explore__mode')).toBeNull()
    expect(buttons()).toEqual(['Previous search result', 'Next search result', 'Open in a tab', 'Close this layer'])
    expect(head().querySelector('.document-zoom')).toBeNull()
    expect(head().textContent).not.toContain('Edit')
    key(board().dom, { key: 'e' })
    await flush()
    expect(top().dataset.kind).toBe('board')
    expect(editors).toEqual([])
    expect(top().querySelector('.explore__mode')).toBeNull()
    key(board().dom, { key: 'Enter', metaKey: true })
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith(SKETCH)
    expect(props.onClose).toHaveBeenCalledOnce()
    act(() => (head().querySelector('[aria-label="Open in a tab"]') as HTMLElement).click())
    expect(props.openInTab).toHaveBeenLastCalledWith(SKETCH)
  })

  it('‹ › step through notes AND boards in the search`s order, in the SAME layer; the count follows (a board row in the list)', async () => {
    await mount()
    await typeQuery('a')
    const all = [...top().querySelectorAll('.search-results__row')].map((r) => r.getAttribute('title'))
    const shown = all.filter((p) => p !== '/v/paper.pdf' && p !== '/v/sub')
    expect(shown).toEqual(expect.arrayContaining(['/v/alpha.md', SKETCH, FLOW]))
    await openResult()
    const layer = top()
    for (let n = 1; n < shown.length; n++) {
      key(layer.querySelector('.explore__body, [data-explore-board]') as HTMLElement, { key: 'ArrowRight', code: 'ArrowRight' })
      await flush()
      await flush()
      expect(top()).toBe(layer)
      expect(layer.dataset.kind).toBe(shown[n]!.endsWith('.md') ? 'note' : 'board')
      expect(layer.querySelector('.explore__title')?.textContent).toBe(props.nameOf(shown[n]!))
      // The count is among the rows ‹ › step to (YAZ-2571 nit): the folder and the PDF are not counted.
      expect(layer.querySelector('.explore__count')?.textContent).toBe(`${n + 1}/${shown.length}`)
    }
    // And back, through the boards, to the first.
    for (let n = shown.length - 2; n >= 0; n--) {
      key(layer.querySelector('.explore__body, [data-explore-board]') as HTMLElement, { key: 'ArrowLeft', code: 'ArrowLeft' })
      await flush()
      await flush()
      expect(layer.querySelector('.explore__title')?.textContent).toBe(props.nameOf(shown[n]!))
    }
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note'])
  })

  it('from Explore`s recents and from a link pill in a note layer; a board pill opens a note or a board on top, an address goes to the system', async () => {
    rememberExploreRecent(FLOW)
    await mount()
    expect(rows()).toEqual(['beta-flow.drawio'])
    await openResult()
    expect(top().dataset.kind).toBe('board')
    // A pill on the board, to a note: a note layer on top; to a board: a board layer.
    const spot = { x: 0, y: 0, width: 1, height: 1 }
    act(() => board().host.onLink?.({ ...spot, inner: 'beta', wiki: true }, { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }))
    await flush()
    await flush()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'board', 'note'])
    expect(top().querySelector('.explore__title')?.textContent).toBe('beta')
    // A link pill in that note to a board: a board layer.
    act(() => crepes[crepes.length - 1].opts.wikilinkNav?.openCurrent(SKETCH))
    await flush()
    await flush()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'board', 'note', 'board'])
    act(() => board().host.onLink?.({ ...spot, inner: 'flow', wiki: true }, { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }))
    await flush()
    await flush()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'board', 'note', 'board', 'board'])
    act(() => board().host.onLink?.({ ...spot, inner: 'https://example.com', wiki: false }, { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }))
    expect(openLink).toHaveBeenCalledWith({ href: 'https://example.com', sourcePath: FLOW })
    act(() => board().host.onLink?.({ ...spot, inner: 'Nowhere', wiki: true }, { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }))
    expect(props.onNotice).toHaveBeenLastCalledWith('"Nowhere" is not in this vault')
    // Each board loaded its window once; covered boards keep theirs.
    expect(boards.made).toHaveLength(3)
    expect(boards.made.every((b) => b.destroy.mock.calls.length === 0)).toBe(true)
    // The recents now list the boards too.
    // A push from outside React's events is counted at once: no false "12 layers" notice (the gotcha of YAZ-4943).
    expect(props.onNotice).not.toHaveBeenCalledWith(FULL_NOTICE)
    expect(exploreRecentsNow().slice(0, 3).map((e) => e.path)).toEqual([FLOW, SKETCH, '/v/beta.md'])
  })

  it('a diagram`s page tabs: the pages the window tells, the page shown selected; a click shows that page', async () => {
    rememberExploreRecent(FLOW)
    await mount()
    await openResult()
    expect(top().querySelector('.explore__pages')).toBeNull()
    act(() => board().host.onPages?.([{ id: 'p0', name: 'Overview' }, { id: 'p1', name: 'Detail' }], 'p0'))
    const tabs = () => [...top().querySelectorAll<HTMLButtonElement>('.explore__page')]
    expect(tabs().map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([
      ['Overview', 'true'],
      ['Detail', 'false'],
    ])
    act(() => tabs()[1].click())
    expect(board().showPage).toHaveBeenCalledWith('p1')
  })

  it('board layers act like windows: × closes it only, Esc closes the front one, a press raises it, its trail chip; the menu`s ⌘+ zooms the board, not the note zoom', async () => {
    await mount()
    await typeQuery('sketch')
    await openResult()
    render(2)
    await flush()
    await typeQuery('flow')
    await openResult()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'board', 'search', 'board'])
    expect([...el.querySelectorAll('.explore__chip')].map((c) => c.textContent)).toEqual(['Search', 'alpha-sketch', 'Search', 'beta-flow'])
    const [, first, , second] = layers()
    // A press on the first board brings it to the front.
    press(first.querySelector('.explore__board') as Element)
    await flush()
    expect(Number(first.style.zIndex)).toBeGreaterThan(Number(second.style.zIndex))
    // ⌘+ from the menu: the front board's own zoom; the note zoom is untouched.
    act(() => requestZoom(1, vi.fn()))
    expect(boards.made[0].handleKey).toHaveBeenCalledTimes(1)
    expect(boards.made[0].handleKey.mock.calls[0][0]).toMatchObject({ key: '=', metaKey: true })
    expect(localStorage.getItem('explore:zoom')).toBeNull()
    // × on the second board closes it alone; its window goes.
    act(() => (second.querySelector('[aria-label="Close this layer"]') as HTMLElement).click())
    await flush()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'board', 'search'])
    expect(boards.made[1].destroy).toHaveBeenCalledOnce()
    // Esc closes the front layer (the first board, raised), then the next.
    await escape()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'search'])
    expect(boards.made[0].destroy).toHaveBeenCalledOnce()
  })

  it('a board opened as the first layer keeps its own box: a drag of its head is saved under the board`s kind', async () => {
    props = { ...props, requestNote: FLOW }
    await mount()
    expect(layers().map((l) => l.dataset.kind)).toEqual(['board'])
    const mouse = (target: EventTarget, type: string, x: number, y: number) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })))
    mouse(head(), 'mousedown', 100, 100)
    mouse(window, 'mousemove', 130, 120)
    mouse(window, 'mouseup', 130, 120)
    expect(JSON.parse(localStorage.getItem('explore:box:board') ?? 'null')).toMatchObject({ width: expect.any(Number) })
    expect(localStorage.getItem('explore:box:note')).toBeNull()
  })
})

describe('YAZ-4944: Tile arranges the Explore windows', () => {
  const W = window.innerWidth
  const H = window.innerHeight
  const area = { x: 0, y: 0, width: W, height: H }
  const boxOf = (layer: HTMLElement) => ({ x: parseFloat(layer.style.left), y: parseFloat(layer.style.top), width: parseFloat(layer.style.width), height: parseFloat(layer.style.height) })
  const tileButton = () => el.querySelector<HTMLButtonElement>('.explore__tile') as HTMLButtonElement
  const notes = () => layers().filter((l) => l.dataset.kind === 'note')
  const titleOf = (layer: HTMLElement) => layer.querySelector('.explore__title')?.textContent
  const near = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number | null }) => {
    expect(a.x).toBeCloseTo(b.x, 3)
    expect(a.y).toBeCloseTo(b.y, 3)
    expect(a.width).toBeCloseTo(b.width, 3)
    expect(a.height).toBeCloseTo(b.height ?? NaN, 3)
  }
  const tileKey = (digit: number, target: Element = top()) => key(target, { key: String(digit), code: `Digit${digit}`, metaKey: true, altKey: true })
  /** A search, then `n` notes: alpha from the search, the rest by links (n2, n3, …), the newest in front. */
  async function withNotes(n: number) {
    await mount()
    await typeQuery('alp')
    await openResult()
    for (let i = 2; i <= n; i++) {
      act(() => crepes[crepes.length - 1].opts.wikilinkNav?.openCurrent(`/v/n${i}.md`))
      await flush()
      await flush()
    }
    expect(notes()).toHaveLength(n)
  }
  beforeEach(() => {
    localStorage.removeItem('explore:box:search')
    localStorage.removeItem('explore:box:note')
  })

  it('the head has no "Reading" label (a note reading, a board); edit keeps Editing and Done', async () => {
    await withNotes(1)
    expect(top().querySelector('.explore__head')?.textContent).not.toContain('Reading')
    key(top().querySelector('.explore__body') as HTMLElement, { key: 'e' })
    await flush()
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Editing')
  })

  it('▦ Tile picks the layout by count: 2 side by side, 3 across, 4 a grid, 5 a grid + centre (the newest in the middle, on top); the search stays where it is', async () => {
    await withNotes(1)
    expect(tileButton().disabled).toBe(true)
    act(() => crepes[0].opts.wikilinkNav?.openCurrent('/v/n2.md'))
    await flush()
    await flush()
    const search = layers()[0]
    const searchBox = { left: search.style.left, top: search.style.top }
    expect(tileButton().disabled).toBe(false)
    act(() => tileButton().click())
    // Most recent first: n2 (front) takes the first cell.
    const two = tileCells('two', area)
    near(boxOf(notes()[1]), two[0])
    near(boxOf(notes()[0]), two[1])
    expect({ left: search.style.left, top: search.style.top }).toEqual(searchBox)
    for (const n of [3, 4, 5]) {
      act(() => crepes[crepes.length - 1].opts.wikilinkNav?.openCurrent(`/v/n${n}.md`))
      await flush()
      await flush()
      act(() => tileButton().click())
      const layout = n === 3 ? 'three' : n === 4 ? 'grid' : 'gridCentre'
      const cells = tileCells(layout, area)
      const byNewest = [...notes()].reverse()
      if (layout === 'gridCentre') {
        near(boxOf(byNewest[0]), cells[4])
        byNewest.slice(1).forEach((layer, i) => near(boxOf(layer), cells[i]))
        expect(Math.max(...layers().map((l) => Number(l.style.zIndex)))).toBe(Number(byNewest[0].style.zIndex))
      } else byNewest.forEach((layer, i) => near(boxOf(layer), cells[i]))
    }
    // Tiling keeps the first layer's kept box as it was.
    expect(localStorage.getItem('explore:box:search')).toBeNull()
  })

  it('more than 5: the 5 used last; the oldest stays where it was, behind', async () => {
    await withNotes(6)
    const oldest = notes()[0]
    const before = { left: oldest.style.left, top: oldest.style.top, width: oldest.style.width }
    act(() => tileButton().click())
    expect({ left: oldest.style.left, top: oldest.style.top, width: oldest.style.width }).toEqual(before)
    const tiled = notes().slice(1).map(boxOf)
    const cells = tileCells('gridCentre', area)
    near(tiled[4], cells[4])
    expect(Number(oldest.style.zIndex)).toBeLessThan(Math.min(...notes().slice(1).map((l) => Number(l.style.zIndex))))
  })

  it('the keys: ⌥⌘2 tiles the two used last; ⌥⌘0 puts every window back in its stack place; a key the editor took is left to it', async () => {
    await withNotes(3)
    const stack = layers().map((l) => ({ left: l.style.left, top: l.style.top, width: l.style.width, height: l.style.height }))
    tileKey(2, top().querySelector('.explore__body') as HTMLElement)
    const two = tileCells('two', area)
    near(boxOf(notes()[2]), two[0])
    near(boxOf(notes()[1]), two[1])
    tileKey(0, top().querySelector('.explore__body') as HTMLElement)
    expect(layers().map((l) => ({ left: l.style.left, top: l.style.top, width: l.style.width, height: l.style.height }))).toEqual(stack)
    // In edit the editor's ⌥⌘digit (a heading) wins: the stack leaves a key it took.
    const body = top().querySelector('.explore__body') as HTMLElement
    const taken = (e: Event) => e.preventDefault()
    body.addEventListener('keydown', taken)
    tileKey(3, body)
    body.removeEventListener('keydown', taken)
    expect(layers().map((l) => ({ left: l.style.left, top: l.style.top, width: l.style.width, height: l.style.height }))).toEqual(stack)
  })

  it('▾ Arrange: five layouts; the windows most recent first, the first places checked, the rest greyed when full; Include searches; ↵ applies; Esc closes it alone', async () => {
    await withNotes(6)
    act(() => (el.querySelector('.explore__tile-more') as HTMLElement).click())
    const pop = () => el.querySelector('.explore__arrange') as HTMLElement
    expect([...pop().querySelectorAll('.explore__layout-name')].map((n) => n.textContent)).toEqual(['Side by side', 'Three', 'Grid', 'Grid + centre', 'Stack'])
    expect(pop().querySelector('[aria-pressed="true"] .explore__layout-name')?.textContent).toBe('Grid + centre')
    const rows = () => [...pop().querySelectorAll<HTMLElement>('.explore__arrange-row')]
    const boxes = () => rows().map((r) => r.querySelector('input') as HTMLInputElement)
    expect(rows().map((r) => r.querySelector('.explore__arrange-name')?.textContent)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2', 'alpha'])
    expect(boxes().map((b) => [b.checked, b.disabled])).toEqual([[true, false], [true, false], [true, false], [true, false], [true, false], [false, true]])
    // Side by side: the two newest checked; pick n3 and alpha instead.
    act(() => (pop().querySelector('.explore__layout') as HTMLElement).click())
    expect(boxes().map((b) => b.checked)).toEqual([true, true, false, false, false, false])
    act(() => boxes()[0].click())
    act(() => boxes()[1].click())
    act(() => boxes()[3].click())
    act(() => boxes()[5].click())
    expect(pop().querySelector('.explore__arrange-count')?.textContent).toBe('2/2')
    // Include searches: the search joins the list.
    act(() => (pop().querySelector('.explore__arrange-searches input') as HTMLElement).click())
    expect(rows().some((r) => r.textContent?.includes('Search'))).toBe(true)
    act(() => (pop().querySelector('.explore__arrange-searches input') as HTMLElement).click())
    act(() => boxes()[0].click())
    act(() => boxes()[1].click())
    act(() => boxes()[0].click())
    act(() => boxes()[0].click())
    act(() => boxes()[3].click())
    act(() => boxes()[5].click())
    expect(boxes().map((b) => b.checked)).toEqual([false, false, false, true, false, true])
    // Esc in the popover closes it, never a layer.
    const count = layers().length
    key(pop(), { key: 'Escape' })
    expect(el.querySelector('.explore__arrange')).toBeNull()
    expect(layers()).toHaveLength(count)
    // Again, then ↵ applies the picked two: n3 first (the list order), then alpha.
    act(() => (el.querySelector('.explore__tile-more') as HTMLElement).click())
    act(() => (pop().querySelector('.explore__layout') as HTMLElement).click())
    act(() => boxes()[0].click())
    act(() => boxes()[1].click())
    act(() => boxes()[3].click())
    act(() => boxes()[5].click())
    key(pop(), { key: 'Enter' })
    expect(el.querySelector('.explore__arrange')).toBeNull()
    const two = tileCells('two', area)
    const byTitle = (t: string) => notes().find((l) => titleOf(l) === t) as HTMLElement
    near(boxOf(byTitle('n3')), two[0])
    near(boxOf(byTitle('alpha')), two[1])
  })

  it('tiled windows stay windows: a drag moves one by its style, × closes one; with motion they glide (200 ms), with reduced motion not', async () => {
    Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false }), configurable: true, writable: true })
    await withNotes(2)
    act(() => tileButton().click())
    expect(el.querySelector('.explore')?.classList.contains('explore--gliding')).toBe(true)
    await act(async () => await new Promise((r) => setTimeout(r, 300)))
    expect(el.querySelector('.explore')?.classList.contains('explore--gliding')).toBe(false)
    const moved = notes()[0]
    const from = boxOf(moved)
    const mouse = (target: EventTarget, type: string, x: number, y: number) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })))
    mouse(moved.querySelector('.explore__head') as Element, 'mousedown', 100, 100)
    mouse(window, 'mousemove', 130, 110)
    mouse(window, 'mouseup', 130, 110)
    expect(boxOf(moved).x).toBeCloseTo(Math.min(from.x + 30, W - from.width), 3)
    Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true }), configurable: true, writable: true })
    tileKey(0, moved)
    expect(el.querySelector('.explore')?.classList.contains('explore--gliding')).toBe(false)
    act(() => (notes()[1].querySelector('[aria-label="Close this layer"]') as HTMLElement).click())
    await flush()
    expect(notes()).toHaveLength(1)
  })
})

describe('YAZ-4945: the empty box shows Opened and Edited', () => {
  const groups = () => [...top().querySelectorAll('.explore__group')].map((g) => g.textContent)
  const titles = () => [...top().querySelectorAll('.search-results__row')].map((r) => r.getAttribute('title'))
  const times = () => [...top().querySelectorAll('.search-results__row .explore__time')].map((t) => t.textContent)
  const NOW = Date.now()
  const edits: Record<string, number> = { '/v/e1.md': NOW - 3 * 3_600_000, '/v/alpha.md': NOW - 60_000, '/v/e2.excalidraw': NOW - 5 * 3_600_000, '/v/p.pdf': NOW - 1 }
  beforeEach(() => {
    props = { ...props, opensOf: () => ({ '/v/t1.md': { score: 1, last: NOW - 2 * 60_000 } }), editsOf: () => edits }
  })

  it('two sections, newest first, each row with its muted time; a file under Opened is not repeated under Edited; PDFs are left out', async () => {
    rememberExploreRecent('/v/alpha.md', NOW - 10 * 60_000)
    rememberExploreRecent('/v/beta.md', NOW - 30_000)
    await mount()
    expect(groups()).toEqual(['Opened', 'Edited'])
    expect(titles()).toEqual(['/v/beta.md', '/v/t1.md', '/v/alpha.md', '/v/e1.md', '/v/e2.excalidraw'])
    expect(times()).toEqual(['now', '2 min', '10 min', ago(edits['/v/e1.md'], Date.now()), ago(edits['/v/e2.excalidraw'], Date.now())])
    // The row reads as a result row: its title from the index.
    expect(rows().slice(0, 1)).toEqual(['Beta'])
  })

  it('8 at most in each section', async () => {
    for (let i = 0; i < 12; i++) rememberExploreRecent(`/v/o${i}.md`, NOW - i * 1000)
    props = { ...props, editsOf: () => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/v/s${i}.md`, NOW - i * 1000])) }
    await mount()
    const all = titles()
    expect(all.filter((p) => p?.includes('/o'))).toHaveLength(8)
    expect(all.filter((p) => p?.includes('/s'))).toHaveLength(8)
  })

  it('↑ ↓ go through both sections as one list; ↵ opens an Edited row; typing shows results instead', async () => {
    rememberExploreRecent('/v/beta.md', NOW)
    await mount()
    // Opened: beta, t1; Edited: alpha, e1, e2. Two ↓ from beta: the first Edited row.
    for (let i = 0; i < 2; i++) key(input(), { key: 'ArrowDown' })
    expect(top().querySelector('.search-results__row--active')?.getAttribute('title')).toBe('/v/alpha.md')
    key(input(), { key: 'Enter' })
    await flush()
    await flush()
    expect(top().querySelector('.explore__title')?.textContent).toBe('alpha')
    await escape()
    await typeQuery('alp')
    expect(groups()).toEqual([])
    expect(rows()).toEqual(['Alpha'])
  })

  it('kept after a restart; a rename and a delete follow', async () => {
    rememberExploreRecent('/v/beta.md', NOW - 1000)
    rememberExploreRecent('/v/gamma.md', NOW)
    props = { ...props, opensOf: () => ({}), editsOf: () => ({}) }
    reloadExploreRecents()
    await mount()
    expect(titles()).toEqual(['/v/gamma.md', '/v/beta.md'])
    act(() => moveExploreRecent('/v/gamma.md', '/v/sub/gamma.md'))
    act(() => moveExploreRecent('/v/beta.md', null))
    expect(titles()).toEqual(['/v/sub/gamma.md'])
    act(() => root?.unmount())
    el.remove()
    reloadExploreRecents()
    await mount()
    expect(titles()).toEqual(['/v/sub/gamma.md'])
  })

  it('a folder-of-a-vault window lists only files under its folder, in both sections', async () => {
    rememberExploreRecent('/v/wiki/a.md', NOW)
    rememberExploreRecent('/v/b.md', NOW)
    props = { ...props, vaults: [{ root: '/v', watch, dirs: ['/v/wiki'], files: [], folder: '/v/wiki' }], opensOf: () => ({}), editsOf: () => ({ '/v/wiki/c.md': NOW, '/v/d.md': NOW }) }
    await mount()
    expect(titles()).toEqual(['/v/wiki/a.md', '/v/wiki/c.md'])
  })
})
