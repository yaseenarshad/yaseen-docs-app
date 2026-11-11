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
import { resetExploreRecents } from './exploreRecents'
import { ExploreStack, FULL_NOTICE, type ExploreStackProps } from './ExploreStack'
import { MAX_LAYERS } from './layers'

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
}))

const rec = (path: string, title: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}
const RECORDS = [rec('/v/alpha.md', 'Alpha'), rec('/v/beta.md', 'Beta', { tags: ['greek'] }), rec('/v/conjecture.md', 'conjecture (vocab)')]
const watch: WatchSource = { subscribe: () => () => undefined }
const wikilinks = createWikilinkResolveSource()
const vaults: SearchVault[] = [{ root: '/v', watch, dirs: ['/v/sub'], files: [] }]
const candidates = { candidates: [], subscribe: () => () => undefined }

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
const rows = () => [...top().querySelectorAll<HTMLElement>('.search-results__row')].map((r) => r.querySelector('.search-results__label')?.textContent)
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
    vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: candidates }),
    nameOf: (path) => path.slice(3, -3),
    textVarsFor: () => ({}),
    renderEditor: (path): ReactNode => {
      editors.push(path)
      return <div className="editor" data-editor={path} />
    },
    createFolder: () => '',
    openInTab: vi.fn(),
    onNotice: vi.fn(),
    onClose: vi.fn(),
  }
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
