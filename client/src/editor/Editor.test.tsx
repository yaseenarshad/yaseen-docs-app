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
import type { FileResponse, IndexRecord, TreeNode, WatchEvent } from '@shared/types'
import { resolverFor } from '../views/engine'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { Editor } from './Editor'
import { createWikilinkResolveSource, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource, type ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import * as frontmatter from '@shared/frontmatter'

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
  }
})

// External edits apply as diffs (YAZ-1347): the fake lands the body the way the real apply would.
vi.mock('./external/applyExternalMarkdown', () => ({
  applyExternalMarkdown: vi.fn((crepe: { md: string }, md: string) => {
    crepe.md = md
    return 'applied'
  }),
}))

import { api } from '../api'
import { storage } from '../lib/storage'
import { fetchTree } from '../lib/treeFeed'
import { createCrepe, setMarkdown, type CreateCrepeOptions } from './createCrepe'
import { applyExternalMarkdown } from './external/applyExternalMarkdown'

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
async function mount(content: string, mtime = 1, extra: { path?: string; wikilinks?: WikilinkResolveSource; reviewSettings?: ReviewSettings; viewOnlyLinks?: ViewOnlyLinkSource; onRetitle?: (path: string, title: string, kind: 'file' | 'dir') => void; onOpenFileBackground?: (path: string) => void; newNoteFolderFor?: (sourcePath: string) => string } = {}): Promise<HTMLElement> {
  const path = extra.path ?? PATH
  const file: FileResponse = { path, content, mtime, size: content.length }
  readFile.mockResolvedValueOnce(file)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Editor root="/vault" path={path} watch={watch} onOpenFile={openFile} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={extra.wikilinks ?? createWikilinkResolveSource()} reviewSettings={extra.reviewSettings} viewOnlyLinks={extra.viewOnlyLinks} onRetitle={extra.onRetitle ?? noop} onOpenFileBackground={extra.onOpenFileBackground} newNoteFolderFor={extra.newNoteFolderFor} />))
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
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const centered: [Element, unknown][] = []
    proto.scrollIntoView = function (this: Element, opts: unknown) { centered.push([this, opts]) }
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
      expect(centered).toEqual([])

      offScreen = true
      step(line) // 125 → 150 with the caret below the fold: centered, scroll left alone
      expect(centered).toEqual([[line, { block: 'center' }]])
      expect(scroller.scrollTop).toBe(65)

      const outside = document.createElement('p')
      outside.textContent = 'elsewhere'
      document.body.append(outside)
      caretIn(outside)
      step(el.querySelector('.editor-mount')!) // this note zooms, but the caret is not its business
      expect(centered).toHaveLength(1)
      expect(scroller.scrollTop).toBe(65)
      outside.remove()
    } finally {
      Range.prototype.getBoundingClientRect = originalRange
      delete proto.scrollIntoView
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
