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
import { moveExploreRecent, rememberExploreRecent, resetExploreRecents } from './exploreRecents'
import { onNoteWindowRequest } from '../views/noteWindowRequest'
import { registerRenameContinuity } from '../lib/renameContinuity'
import { ExploreStack, FULL_NOTICE, type ExploreStackProps } from './ExploreStack'
import { layerPlace, MAX_LAYERS } from './layers'

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
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Reading')
    // The note's saved text, read once, in the read-only render: no editor, no caret.
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/v/alpha.md')
    expect(crepes).toHaveLength(1)
    expect(crepes[0].setReadonly).toHaveBeenCalledWith(true)
    expect(crepes[0].opts.features).toMatchObject({ [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false })
    expect(editors).toEqual([])
    // The search under it stays mounted with its text, covered: no click and no key reach it.
    const search = layers()[0]
    expect(search.querySelector<HTMLInputElement>('.explore__input')?.value).toBe('alp')
    expect(search.hasAttribute('inert')).toBe(true)
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
    act(() => crepes[1].opts.markdownLinkNav?.openPath('/v/sketch.excalidraw', 'thisTab'))
    expect(props.openInTab).toHaveBeenCalledExactlyOnceWith('/v/sketch.excalidraw')
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
    expect(rows()).toEqual(['beta', 'alpha'])
    expect(top().querySelector('.explore__group')?.textContent).toBe('Recent')
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
    expect(rows()).toEqual(['wiki/react'])
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
    // The fold-all button, the note tab's own, left of "Reading": its command runs on this layer's view.
    const fold = top().querySelector<HTMLButtonElement>('.explore__head .fold-all__trigger')
    expect(fold).not.toBeNull()
    expect(fold?.nextElementSibling?.className).toBe('explore__mode')
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
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Reading')
    key(document.activeElement as Element, { key: 'e' })
    await flush()
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Editing')
    expect(top().querySelector('.explore__head .fold-all__trigger')).toBeNull()
    escape()
    await flush()
    await flush()
    expect(top()).toBe(layer)
    expect(layers()).toHaveLength(2)
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Reading')
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(top().querySelector('.explore__body'))
    // Done, from a click.
    act(() => top().querySelector<HTMLButtonElement>('.explore__button')?.click())
    await flush()
    const done = [...top().querySelectorAll<HTMLButtonElement>('.explore__button')].find((b) => b.textContent?.startsWith('Done'))
    expect(done).toBeDefined()
    act(() => done?.click())
    await flush()
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Reading')
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
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Reading')
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

  it('YAZ-4925: a trail of chips from two layers on, the top one bold; a click goes back to that layer, the layers above close, and the ones below keep their scroll', async () => {
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
    expect(chips().map((c) => [c.textContent, c.classList.contains('explore__chip--top')])).toEqual([['Search', false], ['alpha', false], ['Search', false], ['beta', true]])
    act(() => chips()[1].click())
    expect(layers().map((l) => l.dataset.kind)).toEqual(['search', 'note'])
    expect(top().querySelector('.explore__body')).toBe(bodyA)
    expect(bodyA.scrollTop).toBe(210)
    expect(chips().map((c) => c.textContent)).toEqual(['Search', 'alpha'])
    expect(chips()[1].classList.contains('explore__chip--top')).toBe(true)
    // The top chip does nothing; the first search alone shows no trail.
    act(() => chips()[1].click())
    expect(layers()).toHaveLength(2)
    escape()
    expect(el.querySelector('.explore__trail')).toBeNull()
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
    expect(top().querySelector('.explore__mode')?.textContent).toBe('Reading')
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
})
