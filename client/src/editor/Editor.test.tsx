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
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse, IndexRecord, WatchEvent } from '@shared/types'
import { resolverFor } from '../views/engine'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { Editor } from './Editor'
import { createWikilinkResolveSource, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), index: vi.fn(), properties: { get: vi.fn(), onChange: vi.fn() } },
}))

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

import { api } from '../api'
import { createCrepe, setMarkdown } from './createCrepe'

interface FakeCrepe {
  md: string
  onMarkdownUpdated?: (md: string) => void
}

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const createCrepeMock = vi.mocked(createCrepe)
const setMarkdownMock = vi.mocked(setMarkdown)
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

/** Mounts <Editor> and settles useFile's load + the fake crepe.create() so autosave is attached. */
async function mount(content: string, mtime = 1, extra: { path?: string; wikilinks?: WikilinkResolveSource } = {}): Promise<HTMLElement> {
  const path = extra.path ?? PATH
  const file: FileResponse = { path, content, mtime, size: content.length }
  readFile.mockResolvedValueOnce(file)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Editor root="/vault" path={path} watch={watch} onOpenFile={openFile} wikilinks={extra.wikilinks} />))
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
  writeFile.mockImplementation(async (body) => ({ path: body.path, mtime: 99, size: body.content.length }))
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
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  // reset (not clear): a failing test must not leak queued mockResolvedValueOnce reads into the next mount.
  vi.resetAllMocks()
  vi.useRealTimers()
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
    expect(setMarkdownMock).toHaveBeenCalledWith(expect.anything(), '# Someone else\n')
    expect(el.querySelector('.conflict-bar')).toBeNull()
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
 */
describe('Editor backlinks section (Links D, GRO-2193)', () => {
  const record = (path: string, links: string[] = [], properties: Record<string, unknown> = {}): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return {
      path,
      name,
      basename: name.replace(/\.(md|base)$/, ''),
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
    expect([...(host?.children ?? [])].map((c) => c.className)).toEqual(['page-title', 'frontmatter-panel', 'editor-mount', 'backlinks'])
    expect(host?.querySelector('.editor-mount .editor-instance')).not.toBeNull()
    expect(host?.querySelector('.backlinks__header')?.textContent).toBe('Linked mentions (1)')
  })

  /**
   * The folder page's contents block (YAZ-819, 🔒 D1) sits between the Crepe mount and the
   * backlinks (only when the open record carries the flag) — the fourth of the scroller's five
   * blocks since the properties panel took block ONE (⚡ YAZ-883). Order is the placement rule,
   * so it is pinned as an order.
   */
  it('a FOLDER PAGE renders its contents between the mount and the backlinks', async () => {
    const source = createWikilinkResolveSource()
    const el = await mount(BODY, 1, { wikilinks: source })
    feed(source, [
      record('/vault/member.md', ['note'], { folder_pages: ['[[note]]'] }),
      record(PATH, [], { folder_page: true }),
    ])
    const host = el.querySelector('.editor-host')
    expect([...(host?.children ?? [])].map((c) => c.className)).toEqual(['page-title', 'frontmatter-panel', 'editor-mount', 'folder-page-contents', 'backlinks'])
    // fed the pages that belong to it, and no title row of its own — block zero already names
    // the page (⚡ YAZ-888).
    // Q7's default view is the OUTLINE (YAZ-820), which names pages the way a link does.
    expect([...el.querySelectorAll('.view-outline__link')].map((n) => n.textContent)).toEqual(['member'])
  })

  it('an ordinary note gets no contents block at all', async () => {
    const source = createWikilinkResolveSource()
    const el = await mount(BODY, 1, { wikilinks: source })
    feed(source, [record('/vault/member.md', ['note'], { folder_pages: ['[[note]]'] }), record(PATH)])
    const host = el.querySelector('.editor-host')
    expect([...(host?.children ?? [])].map((c) => c.className)).toEqual(['page-title', 'frontmatter-panel', 'editor-mount', 'backlinks'])
  })

})
