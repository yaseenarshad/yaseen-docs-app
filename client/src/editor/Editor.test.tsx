/**
 * CrepeHost external-change handling (GRO-2186): a property write from a base (GRO-2141)
 * rewrites only the frontmatter block on disk; the open editor must absorb it silently —
 * no replaceAll, no conflict bar, unsaved body edits kept. Mounted with react-dom in jsdom;
 * `api` is mocked so every read / write is observable, `./createCrepe` is replaced by a fake
 * whose markdown state the tests drive by hand (the real editor is covered by
 * roundtrip.test.ts / the outline suites), and the watcher is a fake `WatchSource` whose
 * subscribers are captured so tests can push `change` events by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { ZOOM_EVENT } from './zoomRequest'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { FileResponse, IndexRecord, PageView, TableOfContents, TocSource, TreeNode, WatchEvent } from '@shared/types'
import { resolverFor } from '../views/engine'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { Editor } from './Editor'
import { createWikilinkResolveSource, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource, type ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import * as frontmatter from '@shared/frontmatter'
import { announceTwinSave } from '../lib/twinEditors'
import { readPageView } from '../lib/pageView'

/**
 * Render counters for the note's heavy sections (YAZ-2196): each is the REAL component, called
 * through a counting wrapper, so every other test sees it render exactly as before.
 */
const renders = vi.hoisted(() => ({ frontmatter: 0, comments: 0, backlinks: 0, reviews: 0 }))
vi.mock('./FrontmatterPanel', async (importOriginal) => {
  const real = await importOriginal<typeof import('./FrontmatterPanel')>()
  return { ...real, FrontmatterPanel: (props: Parameters<typeof real.FrontmatterPanel>[0]) => (renders.frontmatter++, real.FrontmatterPanel(props)) }
})
vi.mock('../comments/CommentsSection', async (importOriginal) => {
  const real = await importOriginal<typeof import('../comments/CommentsSection')>()
  return { ...real, CommentsSection: (props: Parameters<typeof real.CommentsSection>[0]) => (renders.comments++, real.CommentsSection(props)) }
})
vi.mock('../links/BacklinksSection', async (importOriginal) => {
  const real = await importOriginal<typeof import('../links/BacklinksSection')>()
  return { ...real, BacklinksSection: (props: Parameters<typeof real.BacklinksSection>[0]) => (renders.backlinks++, real.BacklinksSection(props)) }
})
vi.mock('../review/ReviewsSection', async (importOriginal) => {
  const real = await importOriginal<typeof import('../review/ReviewsSection')>()
  return { ...real, ReviewsSection: (props: Parameters<typeof real.ReviewsSection>[0]) => (renders.reviews++, real.ReviewsSection(props)) }
})

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, tree: vi.fn(), readFile: vi.fn(), readPdf: vi.fn(), readImage: vi.fn(), writeFile: vi.fn(), shell: { openLink: vi.fn() }, index: vi.fn(), properties: { get: vi.fn(), onChange: vi.fn() } } }
})

vi.mock('./createCrepe', () => {
  interface FakeCrepe {
    md: string
    onMarkdownUpdated?: (md: string) => void
    create: () => Promise<void>
    destroy: () => Promise<void>
  }
  return {
    createCrepe: vi.fn((opts: { defaultValue?: string; onMarkdownUpdated?: (md: string) => void }): FakeCrepe => ({
      md: opts.defaultValue ?? '',
      onMarkdownUpdated: opts.onMarkdownUpdated,
      create: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    })),
    getMarkdownForSave: vi.fn((crepe: FakeCrepe) => crepe.md),
    setMarkdown: vi.fn((crepe: FakeCrepe, md: string) => {
      crepe.md = md
    }),
    focusEditor: vi.fn(),
    // The fake's "plain text" is its markdown: enough to see WHICH editor the page settings menu counts.
    getPlainText: vi.fn((crepe: FakeCrepe) => crepe.md),
    // The fake has no zoom plugin: a page view test says which bullet it is drilled into.
    getZoomKeyOf: vi.fn((): string | null => null),
  }
})

// Line numbers (YAZ-2643): jsdom has no Worker and the fake Crepe has no view. The request answers
// with the real block index, in line; what the host SENDS to the editor is the thing under test.
vi.mock('./lineNumbers/lineNumbers', async () => {
  const { blockLines } = await import('./lineNumbers/blockLines')
  return { requestBlockLines: vi.fn(async (text: string) => blockLines(text)), showLineNumbers: vi.fn() }
})

// Section indent (YAZ-2709): the fake Crepe has no view to send the switch to. The real plugin is
// covered by outline/sectionIndent.test.ts; what the host SENDS is the thing under test here.
vi.mock('./outline/sectionIndent', () => ({ showSectionIndent: vi.fn() }))

// External edits apply as diffs (YAZ-1347): the fake lands the body the way the real apply would.
vi.mock('./external/applyExternalMarkdown', () => ({
  applyExternalMarkdown: vi.fn((crepe: { md: string }, md: string) => {
    crepe.md = md
    return 'applied'
  }),
}))

import { api, BridgeRequestError } from '../api'
import { storage } from '../lib/storage'
import { fetchTree } from '../lib/treeFeed'
import { createCrepe, focusEditor, getPlainText, getZoomKeyOf, setMarkdown, type CreateCrepeOptions } from './createCrepe'
import { applyExternalMarkdown } from './external/applyExternalMarkdown'
import type { BlockLines } from './lineNumbers/blockLines'
import { requestBlockLines, showLineNumbers, type ShownLines } from './lineNumbers/lineNumbers'
import { showSectionIndent } from './outline/sectionIndent'

interface FakeCrepe {
  md: string
  onMarkdownUpdated?: (md: string) => void
}

const readFile = vi.mocked(api.readFile)
const tree = vi.mocked(api.tree)
const readPdf = vi.mocked(api.readPdf)
const readImage = vi.mocked(api.readImage)
const writeFile = vi.mocked(api.writeFile)
const openLink = vi.mocked(api.shell.openLink)
const createCrepeMock = vi.mocked(createCrepe)
const setMarkdownMock = vi.mocked(setMarkdown)
const applyExternalMock = vi.mocked(applyExternalMarkdown)
const requestBlockLinesMock = vi.mocked(requestBlockLines)
const showLineNumbersMock = vi.mocked(showLineNumbers)
const openFile = vi.fn()

// React's act() refuses to run outside a test renderer unless this flag is set.
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/note.md'
const FM = '---\nstatus: draft\n---\n'
const FM2 = '---\nstatus: done\n---\n'
const BODY = '# Hello\n\nsome text\n'

let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []

const watch: WatchSource = {
  subscribe: (l) => {
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  },
}

const noop = (): void => undefined

/** Mounts <Editor> and settles useFile's load + the fake crepe.create() so autosave is attached. */
async function mount(content: string, mtime = 1, extra: { path?: string; wikilinks?: WikilinkResolveSource; reviewSettings?: ReviewSettings; viewOnlyLinks?: ViewOnlyLinkSource; onRetitle?: (path: string, title: string, kind: 'file' | 'dir') => void; onOpenFileBackground?: (path: string) => void; newNoteFolderFor?: (sourcePath: string) => string; onUserEdit?: (path: string) => void; onNotice?: (message: string) => void; tableOfContents?: TableOfContents; onChangeTableOfContents?: (mode: TableOfContents) => void; tableOfContentsWidth?: number; onChangeTableOfContentsWidth?: (width: number) => void; startView?: PageView } = {}): Promise<HTMLElement> {
  const path = extra.path ?? PATH
  const file: FileResponse = { path, content, mtime, size: content.length }
  readFile.mockResolvedValueOnce(file)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Editor root="/vault" path={path} watch={watch} onOpenFile={openFile} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={extra.wikilinks ?? createWikilinkResolveSource()} reviewSettings={extra.reviewSettings} viewOnlyLinks={extra.viewOnlyLinks} onRetitle={extra.onRetitle ?? noop} onOpenFileBackground={extra.onOpenFileBackground} newNoteFolderFor={extra.newNoteFolderFor} onUserEdit={extra.onUserEdit} onNotice={extra.onNotice} tableOfContents={extra.tableOfContents} onChangeTableOfContents={extra.onChangeTableOfContents} tableOfContentsWidth={extra.tableOfContentsWidth} onChangeTableOfContentsWidth={extra.onChangeTableOfContentsWidth} startView={extra.startView} />))
  await settle()
  await settle()
  return container
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

function crepe(): FakeCrepe {
  const fake = createCrepeMock.mock.results.at(-1)?.value as FakeCrepe | undefined
  if (fake === undefined) throw new Error('no crepe instance')
  return fake
}

/** "Types" into the editor: updates the fake's markdown and fires the (debounced-in-real-life) listener. */
function type(md: string): void {
  const fake = crepe()
  act(() => {
    fake.md = md
    fake.onMarkdownUpdated?.(md)
  })
}

async function emit(ev: WatchEvent): Promise<void> {
  await act(async () => {
    listeners.forEach((l) => l(ev))
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function pastDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
}

/** The next external read of PATH (the watcher handler's fresh read, and reload's). */
function diskHas(content: string, mtime: number): void {
  readFile.mockResolvedValueOnce({ path: PATH, content, mtime, size: content.length })
}

let flushListeners: Array<() => Promise<void> | void> = []
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: vi.fn(async () => ({ width: 16, height: 9, close: vi.fn() })),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), clearRect: vi.fn() } as never)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:editor-pdf') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  writeFile.mockImplementation(async (body) => ({ path: body.path, mtime: 99, size: body.content.length }))
  // The dispatch asks the Files tree which paths are folders (YAZ-2290 D3): none, in this vault.
  tree.mockImplementation(async (root) => ({ root, tree: [], generatedAt: 1 }))
  Object.defineProperty(window, 'yaseenDocs', {
    value: {
      window: {
        onFlush: (l: () => Promise<void> | void) => {
          flushListeners.push(l)
          return () => {
            flushListeners = flushListeners.filter((x) => x !== l)
          }
        },
      },
    },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  flushListeners = []
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  delete (globalThis as unknown as Record<string, unknown>).createImageBitmap
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  // reset (not clear): a failing test must not leak queued mockResolvedValueOnce reads into the next mount.
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('Editor file-kind dispatch (YAZ-1299)', () => {
  it('threads the navigation-only source only into the Markdown Crepe owner', async () => {
    const viewOnlyLinks = createViewOnlyLinkSource()
    await mount(BODY, 1, { viewOnlyLinks })
    expect((createCrepeMock.mock.calls.at(-1)?.[0] as CreateCrepeOptions | undefined)?.viewOnlyLinks).toBe(viewOnlyLinks)
  })

  it("binds wikilinkNav.createFolder to THIS editor's own path, not the active tab (YAZ-1643)", async () => {
    const newNoteFolderFor = vi.fn((sourcePath: string) => (sourcePath === '/vault/Panels/Side.md' ? 'Panels' : 'WRONG'))
    await mount(BODY, 1, { path: '/vault/Panels/Side.md', onOpenFileBackground: noop, newNoteFolderFor })
    const nav = (createCrepeMock.mock.calls.at(-1)?.[0] as CreateCrepeOptions | undefined)?.wikilinkNav
    if (nav === undefined) throw new Error('wikilinkNav was not wired')
    expect(newNoteFolderFor).not.toHaveBeenCalled() // a getter: resolved at click time, not at mount
    expect(nav.createFolder()).toBe('Panels')
    expect(newNoteFolderFor).toHaveBeenCalledExactlyOnceWith('/vault/Panels/Side.md')
  })

  it('routes mixed-case view-only text around every Markdown-only owner', async () => {
    const source = createWikilinkResolveSource()
    const subscribe = vi.spyOn(source, 'subscribe')
    const split = vi.spyOn(frontmatter, 'splitFrontmatter')
    const rename = vi.fn()
    const el = await mount('---\nstatus: idea\n---\nraw\r\n\ttext\r\n', 1, { path: '/vault/data.JSON', wikilinks: source, onRetitle: rename })

    expect(readFile).toHaveBeenCalledExactlyOnceWith('/vault/data.JSON')
    expect(createCrepeMock).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(flushListeners).toHaveLength(0) // no autosave owner
    expect(split).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled() // no backlinks/home semantic feed
    expect(rename).not.toHaveBeenCalled()
    expect(el.querySelector('.page-title')).toBeNull()
    expect(el.querySelector('.frontmatter-panel')).toBeNull()
    expect(el.querySelector('.folder-view')).toBeNull()
    expect(el.querySelector('.backlinks')).toBeNull()
    expect(el.querySelector('.text-viewer')).not.toBeNull()

    split.mockRestore()
    subscribe.mockRestore()
  })

  it('routes mixed-case PDFs through the dedicated bridge and native viewer without mounting either text or editor stack', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    readPdf.mockResolvedValueOnce({ path: '/vault/report.PDF', data: bytes, mtime: 1, size: bytes.byteLength })
    const el = await mount('%PDF-1.7', 1, { path: '/vault/report.PDF' })

    expect(readFile).not.toHaveBeenCalled()
    expect(readPdf).toHaveBeenCalledExactlyOnceWith('/vault/report.PDF')
    expect(createCrepeMock).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(flushListeners).toHaveLength(0)
    expect(el.querySelector('iframe.pdf-viewer__frame')?.getAttribute('title')).toBe('report.PDF')
  })

  it('routes mixed-case raster images through the exact binary viewer without mounting the Markdown stack', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    readImage.mockResolvedValueOnce({ path: '/vault/photo.PNG', data: bytes, mime: 'image/png', mtime: 1, size: bytes.byteLength })
    const el = await mount('not text', 1, { path: '/vault/photo.PNG' })

    expect(readFile).not.toHaveBeenCalled()
    expect(readPdf).not.toHaveBeenCalled()
    expect(readImage).toHaveBeenCalledExactlyOnceWith('/vault/photo.PNG')
    expect(createCrepeMock).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(flushListeners).toHaveLength(0)
    expect(el.querySelector('canvas.image-viewer__canvas')).not.toBeNull()
    expect(el.querySelector('.page-title, .frontmatter-panel, .folder-view, .backlinks')).toBeNull()
  })
})

/** The table of contents channel the host handed the faked `createCrepe` (YAZ-2700): the seam to the engine in the three suites below. */
const tocOf = (): NonNullable<CreateCrepeOptions['toc']> => {
  const toc = (createCrepeMock.mock.calls.at(-1)?.[0] as CreateCrepeOptions | undefined)?.toc
  if (toc === undefined) throw new Error('no table of contents channel was handed to createCrepe')
  return toc
}
/** Two rows, as the real engine would publish them (toc/tocPlugin.test.ts): enough for a table of contents. */
const TWO = [
  { level: 1, text: 'Hello' },
  { level: 2, text: 'More' },
] as const

/**
 * The table of contents (YAZ-2700) is wired by CrepeHost: ONE channel goes to `createCrepe` and to
 * the component mounted beside the scroller, and the setting comes down as a prop. The fake Crepe
 * has no engine, so the test publishes the rows the real one would.
 */
describe('CrepeHost table of contents (YAZ-2700)', () => {
  it('hands createCrepe its channel, and draws that channel\'s headings beside the scroller, after the find bar', async () => {
    const el = await mount(BODY, 1, { tableOfContents: 'auto' })
    expect(el.querySelector('nav.toc')).toBeNull() // one heading so far: nothing to show
    act(() => tocOf().publish(TWO))
    const section = el.querySelector('section.editor')
    expect([...(section?.children ?? [])].map((c) => c.className)).toEqual(['status-chips', 'editor-host', 'find-bar-dock find-bar-dock--note', 'toc'])
    expect(el.querySelector('nav.toc')?.getAttribute('aria-label')).toBe('Table of contents')
    expect(el.querySelectorAll('.toc__line')).toHaveLength(2)
    // Chrome, not content: outside the scroller, so the document zoom never reaches it.
    expect(el.querySelector('.editor-host nav.toc')).toBeNull()
  })

  it('a mount that threads no setting shows none (the default is off)', async () => {
    const el = await mount(BODY)
    act(() => tocOf().publish(TWO))
    expect(el.querySelector('nav.toc')).toBeNull()
  })

  it('the width setting of the names column comes down as a prop too, 200px where none is threaded, and a drag of the column\'s edge goes back up through its door (YAZ-2752)', async () => {
    /** The names column of a 1400px note: jsdom lays nothing out, so the section gets its width before the rows arrive and the first measure runs. */
    const pinnedNames = (el: HTMLElement): HTMLElement => {
      const section = el.querySelector<HTMLElement>('section.editor')
      if (section === null) throw new Error('no section.editor')
      Object.defineProperty(section, 'clientWidth', { configurable: true, value: 1400 })
      act(() => tocOf().publish(TWO))
      return section
    }
    expect(pinnedNames(await mount(BODY, 1, { tableOfContents: 'pinned' })).style.getPropertyValue('--toc-width')).toBe('200px')
    act(() => root?.unmount())
    container?.remove()

    const onChangeTableOfContentsWidth = vi.fn()
    const el = await mount(BODY, 1, { tableOfContents: 'pinned', tableOfContentsWidth: 320, onChangeTableOfContentsWidth })
    const section = pinnedNames(el)
    expect(section.style.getPropertyValue('--toc-width')).toBe('320px')
    act(() => {
      el.querySelector('.toc__resize')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 1000 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 960 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(section.style.getPropertyValue('--toc-width')).toBe('360px')
    expect(onChangeTableOfContentsWidth).toHaveBeenCalledExactlyOnceWith(360)
  })

  it('Esc inside it hands the caret back to THIS note\'s editor', async () => {
    const el = await mount(BODY, 1, { tableOfContents: 'auto' })
    act(() => tocOf().publish(TWO))
    act(() => el.querySelector<HTMLButtonElement>('.toc__rail')?.click())
    const name = el.querySelector<HTMLButtonElement>('.toc__name')
    if (name === null) throw new Error('the card did not open')
    vi.mocked(focusEditor).mockClear()
    act(() => {
      name.focus()
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(vi.mocked(focusEditor)).toHaveBeenCalledExactlyOnceWith(crepe())
    // A closed card stays mounted for its fade-out (`data-leaving`): no OPEN card is left.
    expect(el.querySelector('.toc__card:not([data-leaving])')).toBeNull()
  })

  it('the channel keeps its identity across a save cycle: the editor is not built again', async () => {
    await mount(BODY, 1, { tableOfContents: 'auto' })
    const before = tocOf()
    const built = createCrepeMock.mock.calls.length
    type(BODY + 'more\n')
    await pastDebounce()
    expect(createCrepeMock.mock.calls.length).toBe(built)
    expect(tocOf()).toBe(before)
  })
})

/**
 * "TOC made from" (YAZ-2700 D14): what THIS note's table of contents is built from, saved with the
 * note in the app state as its folds are. `storage` is spied, as in the fold tests below; the seam
 * to the engine is the channel the faked `createCrepe` was handed.
 */
describe('CrepeHost table of contents source (YAZ-2700 D14)', () => {
  let saved: TocSource | null

  beforeEach(() => {
    saved = null
    vi.spyOn(storage, 'getTocSource').mockImplementation(() => saved)
    vi.spyOn(storage, 'setTocSource').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.mocked(storage.getTocSource).mockRestore()
    vi.mocked(storage.setTocSource).mockRestore()
  })

  const choices = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.page-settings__choices button')]
  const pressed = (el: HTMLElement) => choices(el).map((button) => `${button.textContent}:${button.getAttribute('aria-pressed')}`)

  it('seeds from the app state: the saved source is in the channel when createCrepe gets it, before any scan, and pressed in the cog', async () => {
    saved = 'bullets'
    let atCreate: TocSource | null | undefined
    // The module fake's own editor, with one look at the channel at the moment the host hands it over.
    createCrepeMock.mockImplementationOnce((options) => {
      atCreate = options.toc?.getSource()
      return { md: options.defaultValue ?? '', onMarkdownUpdated: options.onMarkdownUpdated, create: () => Promise.resolve(), destroy: () => Promise.resolve() } as never
    })
    const el = await mount(BODY, 1, { tableOfContents: 'auto' })
    expect(storage.getTocSource).toHaveBeenCalledWith('/vault', PATH)
    expect(atCreate).toBe('bullets')
    expect(tocOf().getSource()).toBe('bullets')
    clickCog(el)
    expect(pressed(el)).toEqual(['Auto:false', 'Headings:false', 'Bullets:true'])
    expect(storage.setTocSource).not.toHaveBeenCalled()
  })

  it('a note with no saved source is on Auto', async () => {
    const el = await mount(BODY, 1, { tableOfContents: 'auto' })
    expect(tocOf().getSource()).toBeNull()
    clickCog(el)
    expect(pressed(el)).toEqual(['Auto:true', 'Headings:false', 'Bullets:false'])
  })

  it('a choice is written for THIS note and handed to the engine at once; Auto is written as null; the editor is not built again', async () => {
    const el = await mount(BODY, 1, { tableOfContents: 'auto' })
    const built = createCrepeMock.mock.calls.length
    const rescan = vi.fn()
    tocOf().bind({ jump: vi.fn(), current: vi.fn(() => -1), rescan })
    clickCog(el)
    act(() => choices(el)[1].click())
    expect(storage.setTocSource).toHaveBeenLastCalledWith('/vault', PATH, 'headings')
    expect(tocOf().getSource()).toBe('headings')
    expect(rescan).toHaveBeenCalledTimes(1)
    expect(pressed(el)).toEqual(['Auto:false', 'Headings:true', 'Bullets:false'])
    act(() => choices(el)[0].click())
    expect(storage.setTocSource).toHaveBeenLastCalledWith('/vault', PATH, null)
    expect(tocOf().getSource()).toBeNull()
    expect(rescan).toHaveBeenCalledTimes(2)
    expect(createCrepeMock.mock.calls.length).toBe(built)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled() // the note's own file never hears of it
  })

  it('the control shows only where this page shows a table of contents: not with the app setting off, and not once the page turned its own off', async () => {
    saved = 'headings'
    const off = await mount(BODY)
    clickCog(off)
    expect(off.querySelector('.page-settings__menu')).not.toBeNull()
    expect(off.querySelector('.page-settings__choices')).toBeNull()
    act(() => root?.unmount())
    container?.remove()
    const el = await mount(BODY, 1, { tableOfContents: 'pinned' })
    clickCog(el)
    expect(pressed(el)).toEqual(['Auto:false', 'Headings:true', 'Bullets:false'])
    const row = [...el.querySelectorAll<HTMLButtonElement>('.page-settings__menu > button')].find((button) => button.textContent?.includes('Table of contents'))
    if (row === undefined) throw new Error('no "Table of contents" row')
    act(() => row.click())
    expect(el.querySelector('.page-settings__choices')).toBeNull()
    // Back on: the choice is still the saved one — hiding the control changed nothing.
    act(() => row.click())
    expect(pressed(el)).toEqual(['Auto:false', 'Headings:true', 'Bullets:false'])
    expect(storage.setTocSource).not.toHaveBeenCalled()
  })
})

/**
 * The two page switches of YAZ-2700 in the cog: "Heading levels" (D12) and "Table of contents"
 * (D15). Both are "Line numbers" again — this page's, kept by CrepeHost for as long as its editor
 * lives, and stored nowhere.
 */
describe('CrepeHost page switches: Heading levels and Table of contents (YAZ-2700 D12, D15)', () => {
  const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.page-settings__menu > button')]
  const row = (el: HTMLElement, name: string): HTMLButtonElement => {
    const found = rows(el).find((button) => button.textContent?.startsWith(name))
    if (found === undefined) throw new Error(`no "${name}" row`)
    return found
  }
  /** Every `set…` door of the app state and the browser's own store, as the line-numbers case spies them. */
  const watchStores = () => {
    const spies = [...(Object.keys(storage) as Array<keyof typeof storage>).filter((key) => key.startsWith('set')).map((key) => vi.spyOn(storage, key)), vi.spyOn(Storage.prototype, 'setItem')]
    return {
      untouched: () => {
        for (const spy of spies) expect(spy, spy.getMockName()).not.toHaveBeenCalled()
      },
      restore: () => spies.forEach((spy) => spy.mockRestore()),
    }
  }
  /** The note opens again under a new path: a new editor, as after a rename or a closed tab. */
  const reopen = async (props: Partial<Parameters<typeof Editor>[0]> = {}): Promise<void> => {
    const renamed = '/vault/renamed.md'
    readFile.mockResolvedValueOnce({ path: renamed, content: BODY, mtime: 1, size: BODY.length })
    act(() => root!.render(<Editor root="/vault" path={renamed} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={createWikilinkResolveSource()} {...props} />))
    await settle()
    await settle()
  }
  const pressCmdJ = (): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true })
    act(() => void document.body.dispatchEvent(event))
    return event
  }

  it('"Heading levels" sets `data-heading-levels` on the scroller and clears it again, beside "Line numbers" and apart from it; nothing is stored, the Crepe is never recreated, and the note opened again starts with it off (D12)', async () => {
    const el = await mount(BODY)
    const host = el.querySelector<HTMLElement>('.editor-host')!
    const built = createCrepeMock.mock.calls.length
    const stores = watchStores()
    clickCog(el)
    expect(row(el, 'Heading levels').getAttribute('aria-pressed')).toBe('false')
    expect(host.hasAttribute('data-heading-levels')).toBe(false)
    act(() => row(el, 'Heading levels').click())
    expect(host.hasAttribute('data-heading-levels')).toBe(true)
    expect(row(el, 'Heading levels').getAttribute('aria-pressed')).toBe('true')
    expect(host.hasAttribute('data-line-numbers')).toBe(false)
    act(() => row(el, 'Heading levels').click())
    expect(host.hasAttribute('data-heading-levels')).toBe(false)
    act(() => row(el, 'Heading levels').click())
    stores.untouched()
    stores.restore()
    expect(createCrepeMock).toHaveBeenCalledTimes(built)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
    await reopen()
    expect(el.querySelector('.page-title__text')?.textContent).toBe('renamed')
    expect(el.querySelector('.editor-host')!.hasAttribute('data-heading-levels')).toBe(false)
  })

  it('"Table of contents" is on for a page until the reader turns THIS page’s off: then no lines, no names and no ⌘J; nothing is stored, and the note opened again shows it again (D15)', async () => {
    const el = await mount(BODY, 1, { tableOfContents: 'auto' })
    act(() => tocOf().publish(TWO))
    expect(el.querySelector('nav.toc')).not.toBeNull()
    expect(pressCmdJ().defaultPrevented).toBe(true)
    const stores = watchStores()
    clickCog(el)
    expect(rows(el).map((button) => `${button.textContent}:${button.getAttribute('aria-pressed')}`)).toEqual(['Line numbers:false', 'Section indent:false', 'Heading levels:false', 'Table of contents✓:true'])
    act(() => row(el, 'Table of contents').click())
    expect(row(el, 'Table of contents').getAttribute('aria-pressed')).toBe('false')
    expect(el.querySelector('nav.toc')).toBeNull()
    expect(pressCmdJ().defaultPrevented).toBe(false)
    // On again: the same list, from the same channel — the editor was never told.
    act(() => row(el, 'Table of contents').click())
    expect(el.querySelectorAll('.toc__line')).toHaveLength(2)
    act(() => row(el, 'Table of contents').click())
    expect(el.querySelector('nav.toc')).toBeNull()
    stores.untouched()
    stores.restore()
    await reopen({ tableOfContents: 'auto' })
    act(() => tocOf().publish(TWO))
    expect(el.querySelector('nav.toc')).not.toBeNull()
  })

  it('with the app-wide setting Off the cog has no "Table of contents" row — there is nothing to turn off — and "Heading levels" is still there', async () => {
    const el = await mount(BODY, 1, { tableOfContents: 'off' })
    clickCog(el)
    expect(rows(el).map((button) => button.textContent)).toEqual(['Line numbers', 'Section indent', 'Heading levels'])
    expect(el.querySelector('.page-settings__choices')).toBeNull()
  })
})

describe('CrepeHost frontmatter-only external changes (GRO-2186)', () => {
  it('absorbs a property write while clean: no reload, no conflict bar, next save carries the new frontmatter and mtime', async () => {
    const el = await mount(FM + BODY)
    diskHas(FM2 + BODY, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(setMarkdownMock).not.toHaveBeenCalled()
    expect(el.querySelector('.conflict-bar')).toBeNull()
    // The refreshed frontmatter + baseline mtime show up in the next save.
    type('# Hello\n\nedited\n')
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: `${FM2}# Hello\n\nedited\n`, expectedMtime: 2 })
  })

  it('absorbs a property write while dirty: body edits kept, no conflict bar, save uses the new frontmatter and mtime', async () => {
    const el = await mount(FM + BODY)
    type('# Hello\n\nunsaved edit\n')
    diskHas(FM2 + BODY, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(setMarkdownMock).not.toHaveBeenCalled()
    expect(crepe().md).toBe('# Hello\n\nunsaved edit\n')
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: `${FM2}# Hello\n\nunsaved edit\n`, expectedMtime: 2 })
  })

  it('a real body change on disk while dirty still shows the conflict bar', async () => {
    const el = await mount(FM + BODY)
    type('# Hello\n\nunsaved edit\n')
    diskHas(FM + '# Someone else\n', 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(el.querySelector('.conflict-bar')?.textContent).toContain('File changed on disk.')
    expect(setMarkdownMock).not.toHaveBeenCalled()
    expect(crepe().md).toBe('# Hello\n\nunsaved edit\n')
  })

  it('a real body change on disk while clean still reloads the document', async () => {
    const el = await mount(FM + BODY)
    const next = FM + '# Someone else\n'
    diskHas(next, 2)
    diskHas(next, 2) // reload() re-reads
    await emit({ type: 'change', path: PATH, mtime: 2 })
    // A reload is a DIFF apply, never a rebuild (YAZ-1347).
    expect(applyExternalMock).toHaveBeenCalledWith(expect.anything(), '# Someone else\n')
    expect(setMarkdownMock).not.toHaveBeenCalled()
    expect(el.querySelector('.conflict-bar')).toBeNull()
    // The applied body IS the new baseline: no dirty state, no echo save back to disk (YAZ-1352).
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("only the user's own edit says onUserEdit (YAZ-2648 D2, S23, S24): a body reloaded from disk, a property write and a comment the user posts do not, the first typed change does, once per save cycle", async () => {
    const onUserEdit = vi.fn()
    await mount(FM + BODY, 1, { onUserEdit })
    // A property write from outside: absorbed, the body untouched.
    diskHas(FM2 + BODY, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    // A body change from outside: reloaded as a diff, and the listener then reports the new text as any change.
    const next = FM2 + '# Someone else\n'
    diskHas(next, 3)
    diskHas(next, 3) // reload() re-reads
    await emit({ type: 'change', path: PATH, mtime: 3 })
    expect(applyExternalMock).toHaveBeenCalledWith(expect.anything(), '# Someone else\n')
    type('# Someone else\n')
    await pastDebounce()
    expect(onUserEdit).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()

    // A comment the user posts is a write of the properties block, not an edit of the page (S24).
    act(() => container!.querySelector<HTMLButtonElement>('.comments__header')?.click())
    const box = container!.querySelector<HTMLTextAreaElement>('.comments textarea.comments__textarea')!
    diskHas(next, 3)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, 'A remark')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('.comments .btn--primary')?.click()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: PATH, content: expect.stringContaining('A remark') }))
    expect(onUserEdit).not.toHaveBeenCalled()
    writeFile.mockClear()

    // The user types: the note turns unsaved, and that is the signal.
    type('# Someone else\n\nmine\n')
    expect(onUserEdit).toHaveBeenCalledExactlyOnceWith(PATH)
    type('# Someone else\n\nmine too\n')
    expect(onUserEdit).toHaveBeenCalledTimes(1)
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    type('# Someone else\n\nmine three\n')
    expect(onUserEdit).toHaveBeenCalledTimes(2)
  })

  it('absorbs frontmatter added to a note that had none', async () => {
    const el = await mount(BODY)
    type('# Hello\n\nunsaved edit\n')
    diskHas(FM + BODY, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(setMarkdownMock).not.toHaveBeenCalled()
    await pastDebounce()
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: `${FM}# Hello\n\nunsaved edit\n`, expectedMtime: 2 })
  })

  it('absorbs a property write after an autosave: the saved body is the comparison key', async () => {
    await mount(FM + BODY)
    type('# Hello\n\nsaved edit\n')
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1) // mtime 99 now on disk
    const el = container as HTMLElement
    diskHas(`${FM2}# Hello\n\nsaved edit\n`, 100)
    await emit({ type: 'change', path: PATH, mtime: 100 })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(setMarkdownMock).not.toHaveBeenCalled()
    type('# Hello\n\nsaved edit two\n')
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(writeFile.mock.calls[1]?.[0]).toEqual({ path: PATH, content: `${FM2}# Hello\n\nsaved edit two\n`, expectedMtime: 100 })
  })

  it('a CRLF note: frontmatter-only change is matched byte-for-byte and absorbed', async () => {
    const fmCrlf = '---\r\nstatus: draft\r\n---\r\n'
    const fm2Crlf = '---\r\nstatus: done\r\n---\r\n'
    const bodyCrlf = '# Hello\r\n\r\nsome text\r\n'
    const el = await mount(fmCrlf + bodyCrlf)
    diskHas(fm2Crlf + bodyCrlf, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(setMarkdownMock).not.toHaveBeenCalled()
    type('edited\r\n')
    await pastDebounce()
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: `${fm2Crlf}edited\r\n`, expectedMtime: 2 })
  })
})

/**
 * A page starts from a page view (YAZ-2951 D1, D4): a duplicated tab, or the active tab of a new
 * window, opens with its source's drill-in, live folds, scroll spot and text size. And each editor
 * answers `readPageView` for its tab with its own page view now.
 */
describe('a page starts from a page view, and tells its own (YAZ-2951)', () => {
  const VIEW: PageView = { scrollTop: 420, zoomKey: 'l2 a:1', folds: ['abc:0', 'h:def:0'], magnification: 125 }
  /** The caret grab moves the scroller to 5, as a real focus can. */
  const grabScrolls = () =>
    vi.mocked(focusEditor).mockImplementation(() => {
      const host = container?.querySelector<HTMLElement>('.editor-host')
      if (host) host.scrollTop = 5
    })
  const crepeOptions = (): CreateCrepeOptions => createCrepeMock.mock.calls.at(-1)![0] as unknown as CreateCrepeOptions
  beforeEach(() => {
    vi.spyOn(storage, 'getFolds').mockReturnValue(['stored:0'])
    vi.spyOn(storage, 'setFolds').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.mocked(focusEditor).mockReset()
    vi.mocked(getZoomKeyOf).mockReset()
    vi.mocked(storage.getFolds).mockRestore()
    vi.mocked(storage.setFolds).mockRestore()
  })

  it('starts with the view\'s folds (not the stored ones), drill-in and text size; the seed is not written until a fold changes (S2, S5, S10)', async () => {
    const el = await mount(FM + BODY, 1, { startView: VIEW })
    const opts = crepeOptions()
    expect([...(opts.folding?.seedCollapsedKeys?.() ?? [])]).toEqual(['abc:0'])
    expect([...(opts.headingFolding?.seedCollapsedKeys?.() ?? [])]).toEqual(['h:def:0'])
    expect(storage.getFolds).not.toHaveBeenCalled()
    expect(opts.zoom?.startKey).toBe('l2 a:1')
    expect(el.querySelector<HTMLElement>('.editor-host')!.style.getPropertyValue('--document-zoom')).toBe('1.25')
    expect(el.querySelector('.document-zoom__value')!.textContent).toBe('125%')
    // Each plugin reports its keys once as the editor opens: that is the seed, not a change.
    opts.folding?.onCollapsedKeysChange?.(['abc:0'])
    opts.headingFolding?.onCollapsedKeysChange?.(['h:def:0'])
    expect(storage.setFolds).not.toHaveBeenCalled()
    // A fold in the copy writes, as before: the last writer wins.
    opts.folding?.onCollapsedKeysChange?.(['abc:0', 'new:0'])
    expect(storage.setFolds).toHaveBeenLastCalledWith('/vault', PATH, ['abc:0', 'new:0', 'h:def:0'])
  })

  it('a mount with no view reads the stored folds, starts not drilled in at 100%, and writes the mount report as before', async () => {
    const el = await mount(FM + BODY)
    const opts = crepeOptions()
    expect([...(opts.folding?.seedCollapsedKeys?.() ?? [])]).toEqual(['stored:0'])
    expect(opts.zoom?.startKey ?? null).toBeNull()
    expect(el.querySelector('.document-zoom__value')!.textContent).toBe('100%')
    opts.folding?.onCollapsedKeysChange?.(['stored:0'])
    expect(storage.setFolds).toHaveBeenLastCalledWith('/vault', PATH, ['stored:0'])
  })

  it('sets the scroller\'s scrollTop once the content lands, after the caret grab that may scroll; a later prop is never applied (S6)', async () => {
    grabScrolls() // it runs before the start is applied
    const el = await mount(FM + BODY, 1, { startView: VIEW })
    const host = el.querySelector<HTMLElement>('.editor-host')!
    expect(focusEditor).toHaveBeenCalled()
    expect(host.scrollTop).toBe(420)
    // A new index source builds the editor again: the start is spent, and a new prop is not read.
    vi.mocked(focusEditor).mockReset()
    host.scrollTop = 0
    const built = createCrepeMock.mock.calls.length
    await act(async () => root?.render(<Editor root="/vault" path={PATH} watch={watch} onOpenFile={openFile} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={createWikilinkResolveSource()} onRetitle={noop} startView={{ ...VIEW, scrollTop: 999, zoomKey: 'other:0' }} />))
    await settle()
    expect(createCrepeMock.mock.calls.length).toBe(built + 1)
    expect(host.scrollTop).toBe(0)
    expect(crepeOptions().zoom?.startKey ?? null).toBeNull()
  })

  it('a mount with no start leaves the scroller where the caret grab put it', async () => {
    grabScrolls()
    const el = await mount(FM + BODY)
    expect(el.querySelector<HTMLElement>('.editor-host')!.scrollTop).toBe(5)
  })

  it('answers readPageView for its tab with the LIVE view: folds, drill-in, scroll and text size now (D4)', async () => {
    const el = await mount(FM + BODY)
    el.dataset.tab = 't1'
    const opts = crepeOptions()
    opts.folding?.onCollapsedKeysChange?.(['b:0'])
    opts.headingFolding?.onCollapsedKeysChange?.(['h:c:0'])
    vi.mocked(getZoomKeyOf).mockReturnValue('l1 a:0')
    el.querySelector<HTMLElement>('.editor-host')!.scrollTop = 77
    act(() => { el.querySelector('.editor-mount')!.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: 1, bubbles: true, cancelable: true })) })
    expect(readPageView('t1')).toEqual({ scrollTop: 77, zoomKey: 'l1 a:0', folds: ['b:0', 'h:c:0'], magnification: 125 })
    // Unmounted: the tab has no editor to ask.
    act(() => root?.unmount())
    root = null
    expect(readPageView('t1')).toBeUndefined()
  })
})

/**
 * Copies of one file (YAZ-2940 D4, S23): a save tells the file's other editors in this window at
 * once, through `twinEditors.ts`, without waiting for the watcher. They answer with the same
 * code the watcher drives: a clean copy reloads as a diff, a dirty copy shows the conflict bar,
 * and the editor that saved skips its own announce by the echo check.
 */
describe('copies of one file hear a save at once (YAZ-2940 D4, S23)', () => {
  const NEXT = '# Hello\n\nfrom the other copy\n'

  it('a dirty copy shows the conflict bar and keeps its text', async () => {
    const el = await mount(FM + BODY)
    type('# Hello\n\nmy unsaved edit\n')
    diskHas(FM + NEXT, 7)
    await act(async () => {
      announceTwinSave(PATH, 7)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(el.querySelector('.conflict-bar')?.textContent).toContain('File changed on disk.')
    expect(applyExternalMock).not.toHaveBeenCalled()
    expect(crepe().md).toBe('# Hello\n\nmy unsaved edit\n')
  })

  it('two editors on one path: the one that saves skips its own announce, the twin reloads before any watcher event', async () => {
    const file: FileResponse = { path: PATH, content: FM + BODY, mtime: 1, size: (FM + BODY).length }
    readFile.mockResolvedValueOnce(file)
    readFile.mockResolvedValueOnce(file)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const props = { root: '/vault', path: PATH, watch, onOpenFile: openFile, commentsOrder: 'oldest' as const, onChangeCommentsOrder: noop, wikilinks: createWikilinkResolveSource(), onRetitle: noop }
    act(() =>
      root?.render(
        <>
          <Editor {...props} />
          <Editor {...props} />
        </>,
      ),
    )
    await settle()
    await settle()
    const [a, b] = createCrepeMock.mock.results.map((r) => r.value as FakeCrepe)
    expect(createCrepeMock).toHaveBeenCalledTimes(2)
    const reads = readFile.mock.calls.length
    // Type in copy A; its save lands with mtime 99 (beforeEach's writeFile).
    act(() => {
      a.md = NEXT
      a.onMarkdownUpdated?.(NEXT)
    })
    diskHas(FM + NEXT, 99) // B's read of the change
    diskHas(FM + NEXT, 99) // B's reload() re-reads
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    // Only B read the disk (twice: the change check and the reload); A took its announce as an echo.
    expect(readFile.mock.calls.length).toBe(reads + 2)
    expect(applyExternalMock).toHaveBeenCalledExactlyOnceWith(b, NEXT)
    expect(b.md).toBe(NEXT)
    expect(container.querySelector('.conflict-bar')).toBeNull()
    // The watcher's event for that write is an echo for both copies now.
    await emit({ type: 'change', path: PATH, mtime: 99 })
    expect(readFile.mock.calls.length).toBe(reads + 2)
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1) // B's reloaded text is its baseline: no save back
  })
})

/**
 * The other half of the decision table above (YAZ-1356): absorbing a frontmatter-only write keeps
 * the EDITOR still, but the properties panel must still SHOW the new keys. `useFile` never
 * refetches and a fresh `file` would remount Crepe, so the host keeps its own disk bytes and hands
 * the panel those. The raw fallback is read here because it shows those bytes literally.
 */
describe('the frontmatter panel follows the disk (YAZ-1356)', () => {
  const FM3 = '---\nstatus: shipped\n---\n'

  /** Opens the panel's raw fallback: its textarea IS the panel's belief about what is on disk. */
  function openRawPanel(el: HTMLElement): void {
    act(() => el.querySelector<HTMLButtonElement>('.frontmatter-panel__header')?.click())
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.frontmatter-panel__btn')].find((b) => b.textContent === 'Edit as YAML')?.click())
  }

  function panelYaml(el: HTMLElement): string {
    const area = el.querySelector<HTMLTextAreaElement>('.frontmatter-panel__text')
    if (area === null) throw new Error('the properties textarea is not open')
    return area.value
  }

  it('an absorbed property write reaches the panel without disturbing the editor', async () => {
    const el = await mount(FM + BODY)
    openRawPanel(el)
    const instance = el.querySelector('.editor-instance')
    diskHas(FM2 + BODY, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(panelYaml(el)).toBe('status: done')
    // Still absorbed, not reloaded: the same one Crepe instance, on the same DOM node.
    expect(createCrepeMock).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.editor-instance')).toBe(instance)
    expect(applyExternalMock).not.toHaveBeenCalled()
    expect(setMarkdownMock).not.toHaveBeenCalled()
    expect(el.querySelector('.conflict-bar')).toBeNull()
  })

  it('a body change while clean reloads the document AND moves the panel to the new bytes', async () => {
    const el = await mount(FM + BODY)
    openRawPanel(el)
    const next = FM2 + '# Someone else\n'
    diskHas(next, 2)
    diskHas(next, 2) // reload() re-reads
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(applyExternalMock).toHaveBeenCalledWith(expect.anything(), '# Someone else\n')
    expect(panelYaml(el)).toBe('status: done')
  })

  it("the panel's own write echoing back through the watcher does not bounce it to the old value", async () => {
    const el = await mount(FM + BODY)
    openRawPanel(el)
    const area = el.querySelector<HTMLTextAreaElement>('.frontmatter-panel__text')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    act(() => {
      setter?.call(area, 'status: done')
      area?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    diskHas(FM + BODY, 1) // the panel's save reads fresh, then writes (mock mtime 99)
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.frontmatter-panel__btn')].find((b) => b.textContent === 'Save')?.click())
    await settle()
    await settle()
    expect(writeFile).toHaveBeenCalledWith({ path: PATH, content: FM2 + BODY, expectedMtime: 1 })
    // Its own bytes come back round the watcher: the panel's `content` already ran ahead of `seen`,
    // so following the disk here must be a no-op rather than a revert.
    diskHas(FM2 + BODY, 99)
    await emit({ type: 'change', path: PATH, mtime: 99 })
    expect(panelYaml(el)).toBe('status: done')
  })

  it('two successive property writes both land: the second is not swallowed', async () => {
    const el = await mount(FM + BODY)
    openRawPanel(el)
    diskHas(FM2 + BODY, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    diskHas(FM3 + BODY, 3)
    await emit({ type: 'change', path: PATH, mtime: 3 })
    expect(panelYaml(el)).toBe('status: shipped')
  })
})

describe('CrepeHost empty frontmatter block (GRO-2216)', () => {
  const EMPTY_FM = '---\n---\n'

  it('loading a file with an empty block: the fences never reach the editor body', async () => {
    await mount(EMPTY_FM + BODY)
    expect(crepe().md).toBe(BODY)
  })

  it('absorbs a delete-last-key property write while dirty: body edits kept, no conflict bar', async () => {
    const el = await mount(FM + BODY)
    type('# Hello\n\nunsaved edit\n')
    diskHas(EMPTY_FM + BODY, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(setMarkdownMock).not.toHaveBeenCalled()
    expect(crepe().md).toBe('# Hello\n\nunsaved edit\n')
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: `${EMPTY_FM}# Hello\n\nunsaved edit\n`, expectedMtime: 2 })
  })
})

/**
 * Links D (GRO-2193): the "Linked mentions" section is part of the MARKDOWN editor's scrollable
 * content — appended after the Crepe mount inside `.editor-host`, so it scrolls with the note —
 * and a page with no wikilink feed gets none.
 *
 * The scroller's own block ORDER is pinned here too, and YAZ-918 changed it: the title and the
 * properties panel now share ONE `.page-header` row, so the host's children read
 * `page-header, editor-mount, …` where they used to read `page-title, frontmatter-panel, …`.
 * The header's two halves are pinned inside it, so nothing the old order said is given up.
 * YAZ-1472 slid the comment stream in before the backlinks (🔒 D4): always present, since its
 * composer is the door to the first comment. YAZ-2322 put "Reviews" after "Linked mentions",
 * as the LAST block — there once the vault's review settings are handed down.
 */
describe('Editor backlinks section (Links D, GRO-2193)', () => {
  const record = (path: string, links: string[] = [], properties: Record<string, unknown> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return {
      path,
      name,
      basename: name.replace(/\.(md|base)$/, ''),
      title: name.replace(/\.(md|base)$/, ''),
      folder: '',
      ext: 'md',
      size: 1,
      ctime: 1,
      mtime: 1,
      properties,
      aliases: [],
      tags: [],
      links,
      embeds: [],
    }
  }

  /** One ready snapshot into the App-owned source, wrapped exactly like WikilinkIndexBridge does. */
  function feed(source: ReturnType<typeof createWikilinkResolveSource>, records: IndexRecord[]): void {
    const resolve = resolverFor(records, '/vault')
    act(() => source.update((target) => resolve(target)?.record.path ?? null, records))
  }

  it('a markdown note renders the section after the Crepe mount, inside the scroller', async () => {
    const source = createWikilinkResolveSource()
    const el = await mount(BODY, 1, { wikilinks: source })
    expect(el.querySelector('.backlinks')).toBeNull() // no snapshot yet → nothing at all
    feed(source, [record('/vault/other.md', ['note']), record(PATH)])
    const host = el.querySelector('.editor-host')
    expect([...(host?.children ?? [])].map((c) => c.className)).toEqual(['page-header', 'editor-mount', 'comments', 'backlinks'])
    // …and block zero is ONE row of two (YAZ-918): the title with the properties panel beside it.
    expect([...(host?.querySelector('.page-header')?.children ?? [])].map((c) => c.className)).toEqual(['page-title', 'frontmatter-panel'])
    expect(host?.querySelector('.editor-mount .editor-instance')).not.toBeNull()
    expect(host?.querySelector('.backlinks__header')?.textContent).toBe('Linked mentions (1)')
  })

  it('E: the page title shows the note\'s title once the index has it (YAZ-2420 D14)', async () => {
    const source = createWikilinkResolveSource()
    const el = await mount(BODY, 1, { wikilinks: source })
    expect(el.querySelector('.page-title__text')?.textContent).toBe('note')
    feed(source, [{ ...record(PATH), title: 'UP-001 - Abdul' }])
    expect(el.querySelector('.page-title__text')?.textContent).toBe('UP-001 - Abdul')
    // The outline-zoom breadcrumb's first crumb reads the same title; the file name is only its history key.
    const zoom = (createCrepeMock.mock.calls.at(-1)?.[0] as CreateCrepeOptions | undefined)?.zoom
    expect([zoom?.title(), zoom?.fileName]).toEqual(['UP-001 - Abdul', 'note.md'])
  })

  it('with the review settings, "Reviews" is the last block, after "Linked mentions" (YAZ-2322)', async () => {
    const source = createWikilinkResolveSource()
    const el = await mount(BODY, 1, { wikilinks: source, reviewSettings: { ...DEFAULT_REVIEW_SETTINGS, enabled: true } })
    feed(source, [record('/vault/other.md', ['note']), record(PATH)])
    expect([...(el.querySelector('.editor-host')?.children ?? [])].map((c) => c.className)).toEqual(['page-header', 'editor-mount', 'comments', 'backlinks', 'reviews'])
  })

  it('upkeep off: App hands no review settings, and the page has no Reviews section — even for a note with a log', async () => {
    const source = createWikilinkResolveSource()
    const el = await mount(`---\nreview: true\nreviews:\n  - {at: 2026-10-04T14:02:11Z, rating: keep, text: 9f3a1c2e}\n---\n${BODY}`, 1, { wikilinks: source })
    feed(source, [record('/vault/other.md', ['note']), record(PATH)])
    expect(el.querySelector('.reviews')).toBeNull()
    expect([...(el.querySelector('.editor-host')?.children ?? [])].map((c) => c.className)).toEqual(['page-header', 'editor-mount', 'comments', 'backlinks'])
  })
})

/**
 * The folder itself is a tab (YAZ-2290 D3). Which path is a folder is the Files tree's answer,
 * never the extension's — so each case here stands in its own root, with its own tree.
 */
describe('Editor folder dispatch (YAZ-2290 D3)', () => {
  const dir = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })

  async function open(vault: string, path: string): Promise<HTMLElement> {
    const source = createWikilinkResolveSource()
    act(() => source.update(() => null, [], [])) // the first index snapshot: an empty vault, no folder settings
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<Editor root={vault} path={path} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={source} />))
    await settle()
    await settle()
    return container
  }

  it('E: a folder\'s page is titled with the folder\'s title (YAZ-2420 D14)', async () => {
    tree.mockImplementation(async (r) => ({ root: r, tree: [dir(`${r}/upwork-2026`)], generatedAt: 1 }))
    readFile.mockResolvedValue({ path: '/titled/upwork-2026/.folder.md', content: '---\ntitle: Upwork 2026\n---\n', mtime: 1, size: 27 })
    const source = createWikilinkResolveSource()
    act(() => source.update(() => null, [], [{ path: '/titled/upwork-2026/.folder.md', folder: 'upwork-2026', title: 'Upwork 2026', mtime: 1, properties: {} } as IndexRecord]))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<Editor root="/titled" path="/titled/upwork-2026" watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={source} />))
    await settle()
    await settle()
    expect(container.querySelector('.page-title__text')?.textContent).toBe('Upwork 2026')
  })

  it.each(['Projects', 'Notes.md', 'v1.2'])('a folder named %s renders the folder view — nothing is read as a file, no editor mounts', async (name) => {
    tree.mockImplementation(async (r) => ({ root: r, tree: [dir(`${r}/${name}`, [file(`${r}/${name}/a.md`)])], generatedAt: 1 }))
    const el = await open(`/folders-${name}`, `/folders-${name}/${name}`)
    expect(el.querySelector('.folder-view')).not.toBeNull()
    expect(el.querySelector('.page-title__text')?.textContent).toBe(name)
    expect(readFile).not.toHaveBeenCalled()
    expect(createCrepeMock).not.toHaveBeenCalled()
  })

  it('a markdown FILE beside it still gets the markdown editor', async () => {
    tree.mockImplementation(async (r) => ({ root: r, tree: [dir(`${r}/Notes.md`), file(`${r}/a.md`)], generatedAt: 1 }))
    readFile.mockResolvedValueOnce({ path: '/files/a.md', content: BODY, mtime: 1, size: BODY.length })
    const el = await open('/files', '/files/a.md')
    expect(el.querySelector('.folder-view')).toBeNull()
    expect(createCrepeMock).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.editor-mount')).not.toBeNull()
  })

  it('a folder the tree does not show YET (an in-app rename) says nothing until a fresh tree answers, then renders the folder view', async () => {
    let answer: (nodes: TreeNode[]) => void = () => undefined
    tree
      .mockImplementationOnce(async (r) => ({ root: r, tree: [dir(`${r}/Old`)], generatedAt: 1 })) // the tree before the rename
      .mockImplementationOnce((r) => new Promise((resolve) => (answer = (nodes) => resolve({ root: r, tree: nodes, generatedAt: 2 }))))
    await fetchTree('/renamed') // the window already holds that older tree
    const el = await open('/renamed', '/renamed/New')
    expect(el.innerHTML).toBe('<section class="editor"></section>')
    expect(tree).toHaveBeenCalledTimes(2)
    answer([dir('/renamed/New')])
    await settle()
    expect(el.querySelector('.folder-view')).not.toBeNull()
    expect(el.textContent).not.toContain('Unsupported file type.')
  })

  it('a folder named `Notes.md` that the tree does not show yet is never read as a file', async () => {
    let answer: (nodes: TreeNode[]) => void = () => undefined
    tree
      .mockImplementationOnce(async (r) => ({ root: r, tree: [], generatedAt: 1 })) // the tree before the folder was made
      .mockImplementationOnce((r) => new Promise((resolve) => (answer = (nodes) => resolve({ root: r, tree: nodes, generatedAt: 2 }))))
    await fetchTree('/behind')
    const el = await open('/behind', '/behind/Notes.md')
    expect(el.innerHTML).toBe('<section class="editor"></section>')
    answer([dir('/behind/Notes.md')])
    await settle()
    expect(el.querySelector('.folder-view')).not.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(createCrepeMock).not.toHaveBeenCalled()
  })

  it('a folder deleted outside the app keeps its tab on the message a missing file gets', async () => {
    tree.mockImplementation(async (r) => ({ root: r, tree: [], generatedAt: 1 }))
    const el = await open('/deleted', '/deleted/Projects')
    expect(el.querySelector('.editor-msg--error')?.textContent).toBe('NOT_FOUND: path does not exist')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('The vault’s top level has no page: the root path, as a tab, is never opened as a folder page — whatever its folders — and nothing is read', async () => {
    tree.mockImplementation(async (r) => ({ root: r, tree: [dir(`${r}/Projects`, [file(`${r}/Projects/a.md`)]), file(`${r}/b.md`)], generatedAt: 1 }))
    const el = await open('/toplevel', '/toplevel')
    expect(el.querySelector('.folder-view')).toBeNull()
    expect(el.querySelector('.page-title__text')).toBeNull()
    expect(el.querySelector('.editor-msg--error')?.textContent).toBe('Unsupported file type.') // what the pane says instead: the root is no folder of its own tree
    expect(readFile).not.toHaveBeenCalled()
    expect(createCrepeMock).not.toHaveBeenCalled()
  })

  it('a FILE of the tree with no viewer still says so', async () => {
    tree.mockImplementation(async (r) => ({ root: r, tree: [{ type: 'file', name: 'a.zip', path: `${r}/a.zip`, size: 1, mtime: 1, kind: null }], generatedAt: 1 }))
    const el = await open('/zips', '/zips/a.zip')
    expect(el.querySelector('.editor-msg--error')?.textContent).toBe('Unsupported file type.')
  })

  it('until the tree is known an in-root path renders the empty editor section: nothing is guessed, nothing is read', async () => {
    tree.mockReturnValue(new Promise(() => undefined))
    const el = await open('/pending', '/pending/Notes.md')
    expect(el.innerHTML).toBe('<section class="editor"></section>')
    expect(readFile).not.toHaveBeenCalled()
  })
})

/**
 * One stored fold bucket, two plugins (YAZ-1140, 3A). `storage` is spied here (not mocked at the
 * module level) so only these tests see it; the seam is the options object the faked `createCrepe`
 * was called with, since neither fold plugin actually runs behind that fake.
 */
describe('CrepeHost fold persistence: bullets and headings share one bucket (YAZ-1140)', () => {
  /** A mixed bucket as it comes off disk: a bullet key and a heading key ('h:'-prefixed by the plugin). */
  const STORED = ['abc:0', 'h:def:0']

  beforeEach(() => {
    vi.spyOn(storage, 'getFolds').mockReturnValue([...STORED])
    vi.spyOn(storage, 'setFolds').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.mocked(storage.getFolds).mockRestore()
    vi.mocked(storage.setFolds).mockRestore()
  })

  /** The options the host handed the (faked) editor factory. */
  function crepeOptions(): CreateCrepeOptions {
    const call = createCrepeMock.mock.calls.at(-1)
    if (call === undefined) throw new Error('createCrepe was not called')
    return call[0] as unknown as CreateCrepeOptions
  }

  it('seeds each plugin with its own kind of key', async () => {
    await mount(BODY)
    const opts = crepeOptions()
    expect([...(opts.folding?.seedCollapsedKeys?.() ?? [])]).toEqual(['abc:0'])
    expect([...(opts.headingFolding?.seedCollapsedKeys?.() ?? [])]).toEqual(['h:def:0'])
  })

  it('writes the union on every report, so neither plugin pruning its keys can drop the other kind', async () => {
    await mount(BODY)
    const opts = crepeOptions()
    opts.folding?.onCollapsedKeysChange?.(['zzz:1'])
    expect(vi.mocked(storage.setFolds)).toHaveBeenLastCalledWith('/vault', PATH, ['zzz:1', 'h:def:0'])
    // …and the other way round: the heading plugin dropping to none keeps the bullet key.
    opts.headingFolding?.onCollapsedKeysChange?.([])
    expect(vi.mocked(storage.setFolds)).toHaveBeenLastCalledWith('/vault', PATH, ['zzz:1'])
  })
})

describe('CrepeHost standard Markdown link routing (YAZ-1309)', () => {
  it('binds every href to the mounted note path before crossing the bridge', async () => {
    await mount(BODY)
    const call = createCrepeMock.mock.calls.at(-1)
    if (call === undefined) throw new Error('createCrepe was not called')
    const opts = call[0] as unknown as CreateCrepeOptions

    await opts.markdownLinkNav?.open('../assets/report.pdf')

    expect(openLink).toHaveBeenCalledWith({ href: '../assets/report.pdf', sourcePath: PATH })
  })
})

function enterZoom(host: ParentNode, text: string): void {
  act(() => host.querySelector<HTMLButtonElement>('.document-zoom__trigger')!.click())
  const input = host.querySelector<HTMLInputElement>('.document-zoom__custom input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

describe('document magnification (YAZ-1410)', () => {
  it('scales only the document without recreating Crepe, changing Markdown or saving', async () => {
    const el = await mount(BODY)
    const count = createCrepeMock.mock.calls.length
    enterZoom(el, '115%')
    // The scroller carries the number only (D14); CSS zooms the content blocks, never the scroller.
    const host = el.querySelector<HTMLElement>('.editor-host')!
    expect(host.style.getPropertyValue('--document-zoom')).toBe('1.15')
    expect(host.style.zoom).toBe('')
    expect(el.querySelector('.editor-host')!.contains(el.querySelector('.document-zoom'))).toBe(false)
    expect(createCrepeMock).toHaveBeenCalledTimes(count)
    expect(crepe().md).toBe(BODY)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('⌘+ / ⌘− / ⌘0 step this note while focus is inside its section, along the pill ladder (YAZ-1710)', async () => {
    const el = await mount(BODY)
    const value = () => el.querySelector('.document-zoom__value')!.textContent
    const send = (from: Element, step: -1 | 0 | 1) => {
      const event = new CustomEvent(ZOOM_EVENT, { detail: step, bubbles: true, cancelable: true })
      act(() => { from.dispatchEvent(event) })
      return event.defaultPrevented
    }
    expect(send(el.querySelector('.editor-mount')!, 1)).toBe(true)
    expect(value()).toBe('125%')
    expect(send(el.querySelector('.document-zoom__trigger')!, 1)).toBe(true)
    expect(value()).toBe('150%')
    enterZoom(el, '117')
    expect(send(el.querySelector('.editor-mount')!, -1)).toBe(true)
    expect(value()).toBe('100%')
    expect(send(el.querySelector('.editor-mount')!, 0)).toBe(true)
    expect(value()).toBe('100%')
    enterZoom(el, '200')
    // Above 200 the keys step 25 at a time (D16) while the pill keeps the ladder (D12).
    expect(send(el.querySelector('.editor-mount')!, 1)).toBe(true)
    expect(value()).toBe('225%')
    act(() => el.querySelector<HTMLButtonElement>('.document-zoom__step[aria-label="Zoom in"]')!.click())
    expect(value()).toBe('300%')
    enterZoom(el, '400')
    expect(send(el.querySelector('.editor-mount')!, 1)).toBe(true)
    expect(value()).toBe('400%')
    // Outside the section nobody claims it — that is the app's cue.
    expect(send(document.body, 1)).toBe(false)
    expect(value()).toBe('400%')
  })

  it('anchors the caret line on screen through a zoom change; an off-screen caret is centered; a caret elsewhere is ignored (D11)', async () => {
    const el = await mount(BODY)
    const scroller = el.querySelector<HTMLElement>('.editor-host')!
    scroller.getBoundingClientRect = () => ({ top: 0, height: 500 } as DOMRect)
    const zoomOf = () => Number(scroller.style.getPropertyValue('--document-zoom') || 1)
    // The caret line sits at 100px unzoomed and moves with the zoom, like a real layout would.
    let offScreen = false
    const originalRange = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = () => ({ top: offScreen ? 900 : 100 * zoomOf(), height: 20 } as DOMRect)
    const step = (from: Element) => act(() => { from.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: 1, bubbles: true, cancelable: true })) })
    const caretIn = (p: HTMLParagraphElement) => {
      const range = document.createRange()
      range.setStart(p.firstChild!, 1)
      const selection = document.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    }
    try {
      const line = document.createElement('p')
      line.textContent = 'a line'
      el.querySelector('.editor-mount')!.append(line)
      caretIn(line)
      scroller.scrollTop = 40

      step(line) // 100 → 125: the line would move from 100 to 125 on screen; the scroller absorbs the 25
      expect(scroller.style.getPropertyValue('--document-zoom')).toBe('1.25')
      expect(scroller.scrollTop).toBe(65)

      offScreen = true
      // 125 → 150 with the caret below the fold, at 900: the CARET comes to the middle of the 500px
      // window, at (500 − 20) / 2 = 240 — not its block, which can be many windows tall (YAZ-2691).
      step(line)
      expect(scroller.scrollTop).toBe(65 + 900 - 240)

      const outside = document.createElement('p')
      outside.textContent = 'elsewhere'
      document.body.append(outside)
      caretIn(outside)
      step(el.querySelector('.editor-mount')!) // this note zooms, but the caret is not its business
      expect(scroller.scrollTop).toBe(65 + 900 - 240)
      outside.remove()
    } finally {
      Range.prototype.getBoundingClientRect = originalRange
    }
  })

  it('measures the sideways slack from the deepest bullet: exactly what the zoom added, none at 100% (D15)', async () => {
    const el = await mount(BODY)
    const scroller = el.querySelector<HTMLElement>('.editor-host')!
    const zoomOf = () => Number(scroller.style.getPropertyValue('--document-zoom') || 1)
    const body = document.createElement('div')
    body.className = 'ProseMirror'
    body.getBoundingClientRect = () => ({ left: 0 } as DOMRect)
    for (const indent of [34, 102]) {
      const item = document.createElement('li')
      item.className = 'list-item'
      const children = document.createElement('div')
      children.className = 'children'
      children.getBoundingClientRect = () => ({ left: indent * zoomOf() } as DOMRect)
      item.append(children)
      body.append(item)
    }
    el.querySelector('.editor-mount')!.append(body)

    enterZoom(el, '200')
    expect(scroller.style.getPropertyValue('--zoom-slack')).toBe('102px') // 204 at 200% − 102 at 100%
    enterZoom(el, '400')
    expect(scroller.style.getPropertyValue('--zoom-slack')).toBe('306px')
    enterZoom(el, '100')
    expect(scroller.style.getPropertyValue('--zoom-slack')).toBe('0px')
  })

  it('skips the per-bullet walk at 100%, where the slack is 0 by definition (YAZ-2196 P9)', async () => {
    const el = await mount(BODY)
    const scroller = el.querySelector<HTMLElement>('.editor-host')!
    const body = document.createElement('div')
    body.className = 'ProseMirror'
    body.getBoundingClientRect = () => ({ left: 0 } as DOMRect)
    const item = document.createElement('li')
    item.className = 'list-item'
    const children = document.createElement('div')
    children.className = 'children'
    const rect = vi.fn(() => ({ left: 34 * Number(scroller.style.getPropertyValue('--document-zoom') || 1) } as DOMRect))
    children.getBoundingClientRect = rect
    item.append(children)
    body.append(item)
    el.querySelector('.editor-mount')!.append(body)

    enterZoom(el, '200')
    expect(rect).toHaveBeenCalled()
    rect.mockClear()
    enterZoom(el, '100')
    expect(scroller.style.getPropertyValue('--zoom-slack')).toBe('0px')
    expect(rect).not.toHaveBeenCalled()
  })

  it('keeps retained editors independent and resets a closed/reopened instance', async () => {
    await mount(BODY)
    readFile.mockImplementation(async (path) => ({ path, content: BODY, mtime: 1, size: BODY.length }))
    const other = '/vault/other.md'
    const links = createWikilinkResolveSource()
    const render = (active: string, firstOpen = true) => {
      act(() => root!.render(<>
        {firstOpen && <div key={PATH} data-pane="first" hidden={active !== PATH}><Editor root="/vault" path={PATH} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={links} /></div>}
        <div key={other} data-pane="second" hidden={active !== other}><Editor root="/vault" path={other} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={links} /></div>
      </>))
    }
    render(PATH); await settle(); await settle()
    enterZoom(container!.querySelector('[data-pane="first"]')!, '125')
    render(other)
    expect(container!.querySelector('[data-pane="second"] .document-zoom__value')!.textContent).toBe('100%')
    enterZoom(container!.querySelector('[data-pane="second"]')!, '75')
    render(PATH)
    expect(container!.querySelector('[data-pane="first"] .document-zoom__value')!.textContent).toBe('125%')
    render(other, false)
    render(PATH); await settle(); await settle()
    expect(container!.querySelector('[data-pane="first"] .document-zoom__value')!.textContent).toBe('100%')
    expect(container!.querySelector('[data-pane="second"] .document-zoom__value')!.textContent).toBe('75%')
  })
})

describe('a save repaints only the chips (YAZ-2196 P6)', () => {
  it('the properties panel, comments, backlinks and reviews do not re-render through a whole unsaved → saving → saved cycle', async () => {
    const source = createWikilinkResolveSource()
    const el = await mount(FM + BODY, 1, { wikilinks: source })
    expect(renders.frontmatter).toBeGreaterThan(0)
    expect(renders.comments).toBeGreaterThan(0)
    expect(renders.backlinks).toBeGreaterThan(0)
    expect(renders.reviews).toBeGreaterThan(0)
    renders.frontmatter = renders.comments = renders.backlinks = renders.reviews = 0

    type('# Hello\n\nedited\n')
    expect(el.querySelector('.save-indicator--unsaved')).not.toBeNull()
    await pastDebounce()
    await settle()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.save-indicator--saved')).not.toBeNull()
    expect(renders).toEqual({ frontmatter: 0, comments: 0, backlinks: 0, reviews: 0 })
  })
})

/** One click on the page settings cog: opens the menu, or closes it. */
const clickCog = (host: ParentNode): void => act(() => host.querySelector<HTMLButtonElement>('.page-settings__trigger')!.click())

/** The menu's one switch, through the real cog: opens the menu, clicks "Line numbers", closes the menu. */
function switchLineNumbers(host: ParentNode): void {
  clickCog(host)
  act(() => host.querySelector<HTMLButtonElement>('.page-settings__menu button[aria-pressed]')!.click())
  clickCog(host)
}

describe('the page settings cog (YAZ-2643)', () => {
  /** Mounts <Editor> on `path` with whatever the case adds; the shared `mount` has no door for these props. */
  async function open(path: string, props: Partial<Parameters<typeof Editor>[0]> = {}): Promise<HTMLElement> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<Editor root="/vault" path={path} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={createWikilinkResolveSource()} {...props} />))
    await settle()
    await settle()
    return container
  }

  it('is the first chip of a Markdown note: cog, zoom pill, sync chip, save chip (S1)', async () => {
    readFile.mockResolvedValueOnce({ path: PATH, content: BODY, mtime: 1, size: BODY.length })
    await open(PATH, { sync: { root: '/vault', state: 'synced' }, onSyncNow: noop })
    const chips = [...container!.querySelector('.status-chips')!.children].map((chip) => chip.className.split(' ')[0])
    expect(chips).toEqual(['page-settings', 'document-zoom', 'sync-indicator', 'save-indicator'])
    expect(container!.querySelector('.editor-host')!.contains(container!.querySelector('.page-settings'))).toBe(false)
  })

  it('a text file has no cog (S11)', async () => {
    const el = await mount('{"a": 1}', 1, { path: '/vault/data.json' })
    expect(el.querySelector('.text-viewer')).not.toBeNull()
    expect(el.querySelector('.page-settings')).toBeNull()
  })

  it('a PDF has no cog (S11)', async () => {
    readPdf.mockResolvedValueOnce({ path: '/vault/report.pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mtime: 1, size: 4 })
    const el = await open('/vault/report.pdf')
    expect(el.querySelector('.pdf-viewer__frame')).not.toBeNull()
    expect(el.querySelector('.page-settings')).toBeNull()
  })

  it('an image has no cog (S11)', async () => {
    readImage.mockResolvedValueOnce({ path: '/vault/photo.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png', mtime: 1, size: 4 })
    const el = await open('/vault/photo.png')
    expect(el.querySelector('.image-viewer__canvas')).not.toBeNull()
    expect(el.querySelector('.page-settings')).toBeNull()
  })

  it('a folder page has no cog (S11)', async () => {
    tree.mockImplementation(async (r) => ({ root: r, tree: [{ type: 'dir', name: 'Projects', path: `${r}/Projects`, children: [] }], generatedAt: 1 }))
    const source = createWikilinkResolveSource()
    act(() => source.update(() => null, [], [])) // the first index snapshot: an empty vault, no folder settings
    const el = await open('/cog-folders/Projects', { root: '/cog-folders', wikilinks: source })
    expect(el.querySelector('.folder-view')).not.toBeNull()
    expect(el.querySelector('.page-settings')).toBeNull()
  })

  it('the switch sets `data-line-numbers` on the scroller and clears it again; the Crepe is never recreated (S6)', async () => {
    const el = await mount(BODY)
    const host = el.querySelector<HTMLElement>('.editor-host')!
    const count = createCrepeMock.mock.calls.length
    expect(host.hasAttribute('data-line-numbers')).toBe(false)
    switchLineNumbers(el)
    expect(host.hasAttribute('data-line-numbers')).toBe(true)
    switchLineNumbers(el)
    expect(host.hasAttribute('data-line-numbers')).toBe(false)
    expect(createCrepeMock).toHaveBeenCalledTimes(count)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('stores nothing: the switch calls no writer of the app state, and a renamed note (a new path, so a new editor) starts off (S9, S10)', async () => {
    const el = await mount(BODY)
    // Every `set…` door of the app state (main's `yaseendocs.json` and this window's identity), and the browser's own store.
    const writers = (Object.keys(storage) as Array<keyof typeof storage>).filter((key) => key.startsWith('set')).map((key) => vi.spyOn(storage, key))
    const stored = vi.spyOn(Storage.prototype, 'setItem')
    expect(writers.length).toBeGreaterThan(5)
    switchLineNumbers(el)
    expect(el.querySelector('.editor-host')!.hasAttribute('data-line-numbers')).toBe(true)
    for (const writer of writers) expect(writer, writer.getMockName()).not.toHaveBeenCalled()
    expect(stored).not.toHaveBeenCalled()
    for (const spy of [...writers, stored]) spy.mockRestore()
    const renamed = '/vault/renamed.md'
    readFile.mockResolvedValueOnce({ path: renamed, content: BODY, mtime: 1, size: BODY.length })
    act(() => root!.render(<Editor root="/vault" path={renamed} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={createWikilinkResolveSource()} />))
    await settle()
    await settle()
    expect(el.querySelector('.page-title__text')?.textContent).toBe('renamed')
    expect(el.querySelector('.editor-host')!.hasAttribute('data-line-numbers')).toBe(false)
  })

  it('counts THIS editor’s body when the menu opens: the title, the properties and the comments are not in it (S16)', async () => {
    const el = await mount(`${FM}one two\n`)
    clickCog(el)
    const menu = el.querySelector('.page-settings__menu')!
    expect(menu.textContent).toContain('2 words')
    expect(menu.textContent).toContain('8 characters')
  })

  it('each mounted editor has its own switch, a hidden tab keeps it, and a reopened one starts off (S7–S9)', async () => {
    await mount(BODY)
    readFile.mockImplementation(async (path) => ({ path, content: BODY, mtime: 1, size: BODY.length }))
    const other = '/vault/other.md'
    const links = createWikilinkResolveSource()
    const render = (active: string, firstOpen = true) => {
      act(() => root!.render(<>
        {firstOpen && <div key={PATH} data-pane="first" hidden={active !== PATH}><Editor root="/vault" path={PATH} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={links} /></div>}
        <div key={other} data-pane="second" hidden={active !== other}><Editor root="/vault" path={other} watch={watch} onOpenFile={openFile} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={links} /></div>
      </>))
    }
    const on = (pane: string) => container!.querySelector(`[data-pane="${pane}"] .editor-host`)!.hasAttribute('data-line-numbers')
    render(PATH); await settle(); await settle()
    switchLineNumbers(container!.querySelector('[data-pane="first"]')!)
    expect([on('first'), on('second')]).toEqual([true, false])
    render(other)
    render(PATH)
    expect([on('first'), on('second')]).toEqual([true, false])
    render(other, false)
    render(PATH); await settle(); await settle()
    expect([on('first'), on('second')]).toEqual([false, false])
  })
})

describe('line numbers follow the file on disk (YAZ-2643)', () => {
  /** What the host last sent to the editor: the blocks, or null for "off". */
  const sent = (): ShownLines | null | undefined => showLineNumbersMock.mock.calls.at(-1)?.[1]

  it('nothing is asked and nothing is sent while the numbers are off, through a whole save (S58, S59)', async () => {
    await mount(FM + BODY)
    type('# Hello\n\nedited\n')
    await pastDebounce()
    await settle()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(requestBlockLinesMock).not.toHaveBeenCalled()
    expect(showLineNumbersMock).not.toHaveBeenCalled()
  })

  it('turn-on builds them from the disk file, the frontmatter lines counted (S22, S24)', async () => {
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    expect(requestBlockLinesMock).toHaveBeenCalledExactlyOnceWith(BODY)
    expect(showLineNumbersMock).toHaveBeenCalledExactlyOnceWith(crepe(), { lines: [4, 6], ends: [4, 6], kinds: 'hp' })
  })

  it('sends where each block ENDS too, as a line of the file: the frontmatter lines counted, and a blank line the load added taken out (S66)', async () => {
    // Under 3 lines of frontmatter: a wrapped paragraph (4–6), a bullet (8), a bare nested marker (9), a wrapped bullet (10–11), a code block (13–16).
    const body = 'one\ntwo\nthree\n\n* a\n  *\n  * b\n    wrapped\n\n```\nx\ny\n```\n'
    const el = await mount(FM + body)
    switchLineNumbers(el)
    await settle()
    expect(sent()).toEqual({ lines: [4, 8, 9, 10, 13], ends: [6, 8, 9, 11, 16], kinds: 'ppppc' })
  })

  it('never builds them on a keystroke or while a save is in flight; the settled save builds them from the saved file (S25–S27)', async () => {
    let written!: () => void
    writeFile.mockImplementationOnce((body) => new Promise((resolve) => (written = () => resolve({ path: body.path, mtime: 99, size: body.content.length }))))
    const el = await mount(FM + BODY)
    type('# Hello\n\nsome text\n\nnew block\n')
    expect(el.querySelector('.save-indicator--unsaved')).not.toBeNull()
    switchLineNumbers(el)
    await settle()
    expect(requestBlockLinesMock).not.toHaveBeenCalled()
    await pastDebounce()
    expect(el.querySelector('.save-indicator--saving')).not.toBeNull()
    expect(requestBlockLinesMock).not.toHaveBeenCalled()
    await act(async () => written())
    await settle()
    expect(el.querySelector('.save-indicator--saved')).not.toBeNull()
    expect(requestBlockLinesMock).toHaveBeenCalledExactlyOnceWith('# Hello\n\nsome text\n\nnew block\n')
    expect(sent()).toEqual({ lines: [4, 6, 8], ends: [4, 6, 8], kinds: 'hpp' })
  })

  it('with the numbers on, typing asks for nothing; each settled save builds them again (S25, S26)', async () => {
    const el = await mount(BODY)
    switchLineNumbers(el)
    await settle()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(1)
    type('intro\n\n# Hello\n\nsome text\n')
    await settle()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(1)
    expect(showLineNumbersMock).toHaveBeenCalledTimes(1)
    await pastDebounce()
    await settle()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(2)
    expect(sent()).toEqual({ lines: [1, 3, 5], ends: [1, 3, 5], kinds: 'php' })
  })

  it('an outside change with nothing unsaved reloads the note and builds them from the new file (S28)', async () => {
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    const next = `${FM}\n\n# Someone else\n\n- a\n- b\n`
    diskHas(next, 2)
    diskHas(next, 2) // reload() re-reads
    await emit({ type: 'change', path: PATH, mtime: 2 })
    await settle()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(2)
    expect(sent()).toEqual({ lines: [6, 8, 9], ends: [6, 8, 9], kinds: 'hpp' })
  })

  it('an outside change over unsaved edits keeps them until "Reload" settles (S29)', async () => {
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    type('# Hello\n\nunsaved edit\n')
    const next = `${FM}# Someone else\n`
    diskHas(next, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(el.querySelector('.conflict-bar')).not.toBeNull()
    // The pending save meets the newer file: main refuses it, and the bar stays.
    writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer on disk', 2))
    diskHas(next, 2)
    await pastDebounce()
    expect(el.querySelector('.conflict-bar')).not.toBeNull()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(1)
    expect(showLineNumbersMock).toHaveBeenCalledTimes(1)
    diskHas(next, 2)
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.conflict-bar button')].find((b) => b.textContent === 'Reload')!.click())
    await settle()
    await settle()
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(2)
    expect(sent()).toEqual({ lines: [4], ends: [4], kinds: 'h' })
  })

  it('an outside change over unsaved edits keeps them until "Keep mine" has saved (S29)', async () => {
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    type('# Hello\n\nmine\n\nand more\n')
    diskHas(`${FM}# Someone else\n`, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer on disk', 2))
    diskHas(`${FM}# Someone else\n`, 2)
    await pastDebounce()
    expect(el.querySelector('.conflict-bar')).not.toBeNull()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(1)
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.conflict-bar button')].find((b) => b.textContent === 'Keep mine')!.click())
    await settle()
    await settle()
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: `${FM}# Hello\n\nmine\n\nand more\n`, expectedMtime: 2 })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(2)
    expect(sent()).toEqual({ lines: [4, 6, 8], ends: [4, 6, 8], kinds: 'hpp' })
  })

  it('an outside change that puts back the bytes the note was opened with still builds them again (S28)', async () => {
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    type('intro\n\n# Hello\n\nsome text\n')
    await pastDebounce()
    await settle()
    expect(sent()).toEqual({ lines: [4, 6, 8], ends: [4, 6, 8], kinds: 'php' })
    // A revert from outside (git, an AI): the file is byte-for-byte what this editor mounted on.
    diskHas(FM + BODY, 100)
    diskHas(FM + BODY, 100) // reload() re-reads
    await emit({ type: 'change', path: PATH, mtime: 100 })
    await settle()
    expect(applyExternalMock).toHaveBeenCalledWith(expect.anything(), BODY)
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(3)
    expect(sent()).toEqual({ lines: [4, 6], ends: [4, 6], kinds: 'hp' })
  })

  it('a property write changes the frontmatter’s line count: every number moves with it (S30)', async () => {
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    expect(sent()).toEqual({ lines: [4, 6], ends: [4, 6], kinds: 'hp' })
    diskHas(`---\nstatus: done\nowner: yasin\ntags:\n  - a\n---\n${BODY}`, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    await settle()
    expect(applyExternalMock).not.toHaveBeenCalled()
    expect(sent()).toEqual({ lines: [7, 9], ends: [7, 9], kinds: 'hp' })
  })

  it('turn-off drops every number (S32)', async () => {
    const el = await mount(BODY)
    switchLineNumbers(el)
    await settle()
    switchLineNumbers(el)
    expect(showLineNumbersMock).toHaveBeenCalledTimes(2)
    expect(showLineNumbersMock).toHaveBeenLastCalledWith(crepe(), null)
  })

  it('drops an answer that comes back after the numbers went off (S31)', async () => {
    let answer!: (blocks: BlockLines) => void
    requestBlockLinesMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const el = await mount(BODY)
    switchLineNumbers(el)
    switchLineNumbers(el)
    await act(async () => answer({ lines: [1, 3], ends: [1, 3], kinds: 'hp' }))
    await settle()
    expect(showLineNumbersMock.mock.calls.map((call) => call[1])).toEqual([null])
  })

  it('drops an answer that comes back after a newer request (S31)', async () => {
    let answer!: (blocks: BlockLines) => void
    requestBlockLinesMock.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const el = await mount(BODY)
    switchLineNumbers(el)
    const next = '# Someone else\n\nnew\n\ntext\n'
    diskHas(next, 2)
    diskHas(next, 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    await settle()
    expect(sent()).toEqual({ lines: [1, 3, 5], ends: [1, 3, 5], kinds: 'hpp' })
    await act(async () => answer({ lines: [1, 3], ends: [1, 3], kinds: 'hp' }))
    await settle()
    expect(showLineNumbersMock).toHaveBeenCalledTimes(1)
  })

  it('a worker that fails: one passive notice, nothing sent to the editor, no retry; the next settled save asks again (S65)', async () => {
    const onNotice = vi.fn()
    requestBlockLinesMock.mockRejectedValueOnce(new Error('the line-number worker failed'))
    const el = await mount(FM + BODY, 1, { onNotice })
    switchLineNumbers(el)
    await settle()
    await pastDebounce()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Line numbers could not load.')
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(1)
    expect(showLineNumbersMock).not.toHaveBeenCalled()
    expect(el.querySelector('.editor-host')!.hasAttribute('data-line-numbers')).toBe(true)
    type('# Hello\n\nsome text\n\nnew block\n')
    await pastDebounce()
    await settle()
    expect(requestBlockLinesMock).toHaveBeenCalledTimes(2)
    expect(sent()).toEqual({ lines: [4, 6, 8], ends: [4, 6, 8], kinds: 'hpp' })
    expect(onNotice).toHaveBeenCalledTimes(1)
  })

  it('a failure that comes back after the numbers went off says nothing (S31, S65)', async () => {
    const onNotice = vi.fn()
    let fail!: (reason: Error) => void
    requestBlockLinesMock.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const el = await mount(BODY, 1, { onNotice })
    switchLineNumbers(el)
    switchLineNumbers(el)
    await act(async () => fail(new Error('the line-number worker failed')))
    await settle()
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('turned on before the editor is created: nothing is sent to it until it is, then the numbers are built', async () => {
    let created!: () => void
    createCrepeMock.mockImplementationOnce((opts) => ({ md: opts.defaultValue ?? '', onMarkdownUpdated: opts.onMarkdownUpdated, create: () => new Promise<void>((resolve) => (created = resolve)), destroy: () => Promise.resolve() }) as never)
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    // The menu opened on an editor that cannot take an action yet: it counts nothing, and does not ask.
    expect(vi.mocked(getPlainText)).not.toHaveBeenCalled()
    expect(requestBlockLinesMock).not.toHaveBeenCalled()
    expect(showLineNumbersMock).not.toHaveBeenCalled()
    await act(async () => created())
    await settle()
    expect(showLineNumbersMock).toHaveBeenCalledExactlyOnceWith(crepe(), { lines: [4, 6], ends: [4, 6], kinds: 'hp' })
    clickCog(el)
    expect(vi.mocked(getPlainText)).toHaveBeenCalledExactlyOnceWith(crepe())
  })

  it('a Crepe recreated under the switch gets its numbers too, and the one it replaced gets nothing more', async () => {
    const el = await mount(FM + BODY)
    switchLineNumbers(el)
    await settle()
    const first = crepe()
    expect(showLineNumbersMock).toHaveBeenCalledExactlyOnceWith(first, { lines: [4, 6], ends: [4, 6], kinds: 'hp' })
    // A new `onOpenFile` identity is one of the mount effect's dependencies: the editor is rebuilt in place.
    act(() => root!.render(<Editor root="/vault" path={PATH} watch={watch} onOpenFile={() => undefined} onRetitle={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={createWikilinkResolveSource()} />))
    await settle()
    await settle()
    const second = crepe()
    expect(second).not.toBe(first)
    expect(el.querySelector('.editor-host')!.hasAttribute('data-line-numbers')).toBe(true)
    expect(showLineNumbersMock).toHaveBeenCalledTimes(2)
    expect(showLineNumbersMock).toHaveBeenLastCalledWith(second, { lines: [4, 6], ends: [4, 6], kinds: 'hp' })
  })
})

/**
 * "Section indent" (YAZ-2709 D2): the page's own switch, saved with the note in the app state as
 * its table of contents source is. `storage` is spied, as in the "TOC made from" tests above: the
 * record below is what the app state holds for the vault, page → switch.
 */
describe('section indent is the page’s own switch (YAZ-2709)', () => {
  const showSectionIndentMock = vi.mocked(showSectionIndent)
  let saved: Record<string, boolean>
  /** The switch, by its name, through the real menu. */
  function switchSectionIndent(host: ParentNode): void {
    clickCog(host)
    act(() => [...host.querySelectorAll<HTMLButtonElement>('.page-settings__menu > button[aria-pressed]')].find((button) => button.textContent?.startsWith('Section indent'))!.click())
    clickCog(host)
  }
  const indented = (host: ParentNode): boolean => host.querySelector('.editor-host')!.hasAttribute('data-section-indent')

  beforeEach(() => {
    saved = {}
    vi.spyOn(storage, 'getSectionIndent').mockImplementation((_root, file) => saved[file] === true)
    vi.spyOn(storage, 'setSectionIndent').mockImplementation((_root, file, on) => void (saved[file] = on))
  })

  afterEach(() => {
    vi.mocked(storage.getSectionIndent).mockRestore()
    vi.mocked(storage.setSectionIndent).mockRestore()
  })

  it('is off on a page with no entry: the editor is told nothing, and a mount writes nothing', async () => {
    const el = await mount(BODY)
    expect(storage.getSectionIndent).toHaveBeenCalledWith('/vault', PATH)
    expect(indented(el)).toBe(false)
    expect(showSectionIndentMock).not.toHaveBeenCalled()
    expect(storage.setSectionIndent).not.toHaveBeenCalled()
  })

  it('on tells the editor once and saves `true`; off tells it off and saves `false`, an entry of its own; the note and the browser store are never written', async () => {
    const browserStore = vi.spyOn(Storage.prototype, 'setItem')
    const el = await mount(BODY)
    switchSectionIndent(el)
    expect(indented(el)).toBe(true)
    expect(showSectionIndentMock).toHaveBeenCalledExactlyOnceWith(crepe(), true)
    expect(storage.setSectionIndent).toHaveBeenCalledExactlyOnceWith('/vault', PATH, true)
    switchSectionIndent(el)
    expect(indented(el)).toBe(false)
    expect(showSectionIndentMock).toHaveBeenCalledTimes(2)
    expect(showSectionIndentMock).toHaveBeenLastCalledWith(crepe(), false)
    // D2: off is `false` for THIS page, never the removal of its entry.
    expect(vi.mocked(storage.setSectionIndent).mock.calls).toEqual([['/vault', PATH, true], ['/vault', PATH, false]])
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
    expect(browserStore).not.toHaveBeenCalled()
    browserStore.mockRestore()
  })

  it('seeds from the app state: the next editor of the page starts on and tells its editor, a page saved as off and a page with no entry start off', async () => {
    const first = await mount(BODY)
    switchSectionIndent(first)
    act(() => root?.unmount())
    first.remove()
    showSectionIndentMock.mockClear()
    // A new editor on the same page: a second tab, the right panel, or the app after a restart.
    const again = await mount(BODY)
    expect(indented(again)).toBe(true)
    expect(showSectionIndentMock).toHaveBeenCalledExactlyOnceWith(crepe(), true)
    act(() => root?.unmount())
    again.remove()
    saved['/vault/off.md'] = false
    const off = await mount(BODY, 1, { path: '/vault/off.md' })
    expect(indented(off)).toBe(false)
    act(() => root?.unmount())
    off.remove()
    const other = await mount(BODY, 1, { path: '/vault/other.md' })
    expect(indented(other)).toBe(false)
    // Reading wrote nothing: the one write is the click on the first page.
    expect(storage.setSectionIndent).toHaveBeenCalledTimes(1)
  })

  it('an outside change that lands tells the editor again: a rebuilt editor state starts off', async () => {
    const el = await mount(FM + BODY)
    switchSectionIndent(el)
    expect(showSectionIndentMock).toHaveBeenCalledTimes(1)
    diskHas(FM + '# Hello\n\nchanged outside\n', 2)
    diskHas(FM + '# Hello\n\nchanged outside\n', 2)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    await settle()
    expect(applyExternalMock).toHaveBeenCalledTimes(1)
    expect(showSectionIndentMock).toHaveBeenCalledTimes(2)
    expect(showSectionIndentMock).toHaveBeenLastCalledWith(crepe(), true)
  })
})
