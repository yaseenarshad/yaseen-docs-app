/**
 * BaseHost (GRO-2125): a `.base` in the main pane, mounted with react-dom in jsdom.
 * `api` is mocked so every PUT / GET is observable; the watcher is a fake `WatchSource`
 * whose subscribers are captured so tests can push `change` events by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse, IndexRecord, WatchEvent } from '@shared/types'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { BaseHost } from './BaseHost'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), index: vi.fn() },
}))

import { api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const indexFn = vi.mocked(api.index)
const openFile = vi.fn()

const record = (path: string): IndexRecord => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  folder: '',
  ext: 'md',
  size: 1,
  ctime: 1,
  mtime: 1,
  properties: {},
  tags: [],
  links: [],
  embeds: [],
})

// React's act() refuses to run outside a test renderer unless this flag is set.
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/Content Pillars/Content Topics DB.base'

/** `Content Topics DB.base` from `desktop/src/main/fs/basesFixture.ts`, verbatim. */
const FIXTURE = `views:
  - type: table
    name: Table
    order:
      - file.name
    sort:
      - property: formula.Untitled
        direction: ASC
  - type: cards
    name: View
  - type: table
    name: View 2
    indentProperties: false
`

const INVALID = 'views:\n  - type: table\n    name: [unclosed\n'

const FIXED = 'views:\n  - type: table\n    name: Fixed\n'

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

function mount(content: string, mtime = 1): HTMLElement {
  const file: FileResponse = { path: PATH, content, mtime, size: content.length }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<BaseHost root="/vault" file={file} watch={watch} onOpenFile={openFile} />))
  return container
}

function tabNames(el: HTMLElement): string[] {
  return [...el.querySelectorAll('.base-tabs [role="tab"]')].map((t) => t.textContent ?? '')
}

/** Types into the textarea the way a user would: native value setter + bubbling `input` (React's value tracker). */
function typeRaw(el: HTMLElement, text: string): void {
  const ta = el.querySelector<HTMLTextAreaElement>('textarea.base-raw')
  if (ta === null) throw new Error('no textarea')
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    set?.call(ta, text)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
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

beforeEach(() => {
  vi.useFakeTimers()
  writeFile.mockImplementation(async (body) => ({ path: body.path, mtime: 99, size: body.content.length }))
  indexFn.mockResolvedValue({ root: '/vault', records: [record('/vault/a.md'), record('/vault/b.md')], generatedAt: 1 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('BaseHost', () => {
  it('renders the view names of a valid base as tabs, first selected', () => {
    const el = mount(FIXTURE)
    expect(tabNames(el)).toEqual(['Table', 'View', 'View 2'])
    const tabs = el.querySelectorAll('[role="tab"]')
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false')
    expect(el.querySelector('.base-raw')).toBeNull()
    // The index fetch has not resolved yet: the body is the pending notice over an empty result.
    expect(el.querySelector('.base-view__pending')).not.toBeNull()
    expect(el.querySelector('.base-toolbar__count')?.textContent).toBe('0 items')
  })

  it('feeds the fetched vault index into the view: rows and count appear once the index resolves (GRO-2129)', async () => {
    const el = mount(FIXTURE)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(indexFn).toHaveBeenCalledWith('/vault')
    expect(el.querySelector('.base-view__pending')).toBeNull()
    expect([...el.querySelectorAll('.base-table__link')].map((b) => b.textContent)).toEqual(['a.md', 'b.md'])
    expect(el.querySelector('.base-toolbar__count')?.textContent).toBe('2 items')
  })

  it('a failed index fetch shows the error state instead of rows (GRO-2129)', async () => {
    indexFn.mockRejectedValue(new Error('bridge gone'))
    const el = mount(FIXTURE)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(el.querySelector('.base-view__error')?.textContent).toContain('bridge gone')
    expect(el.querySelector('.base-rows')).toBeNull()
  })

  it('a toolbar change (adding a view) goes through onChange into one PUT of the new YAML after the debounce', async () => {
    const el = mount(FIXTURE)
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Add view"]')?.click())
    expect(tabNames(el)).toEqual(['Table', 'View', 'View 2', 'Table 4'])
    expect(el.querySelectorAll('[role="tab"]')[3]?.getAttribute('aria-selected')).toBe('true')
    expect(writeFile).not.toHaveBeenCalled()
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toEqual({
      path: PATH,
      content: `${FIXTURE}  - type: table\n    name: Table 4\n`,
      expectedMtime: 1,
    })
    expect(el.querySelector('.save-indicator')?.textContent).toBe('Saved')
  })

  it('clicking a tab switches the selected one (view-only, no write)', async () => {
    const el = mount(FIXTURE)
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    act(() => tabs[1]?.click())
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('false')
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a no-op open never writes the file', async () => {
    const el = mount(FIXTURE)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
    expect(el.querySelector('.save-indicator')?.textContent).toBe('Saved')
  })

  it('falls back to the raw text with a located error when the YAML is invalid', async () => {
    const el = mount(INVALID)
    expect(el.querySelector('.base-view')).toBeNull()
    expect(el.querySelector('.base-error')?.textContent).toMatch(/^4:1 /)
    expect(el.querySelector<HTMLTextAreaElement>('textarea.base-raw')?.value).toBe(INVALID)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a structurally invalid base (no views) also falls back, without a position', () => {
    const el = mount('formulas:\n  x: 1\n')
    expect(el.querySelector('.base-error')?.textContent).toContain('views')
    expect(el.querySelector('.base-error')?.textContent).not.toMatch(/\d+:\d+/)
    expect(el.querySelector('textarea.base-raw')).not.toBeNull()
  })

  it('fixing the YAML flips to view mode and saves the new content after the debounce', async () => {
    const el = mount(INVALID)
    typeRaw(el, 'views:\n  - type: table\n    name: [still\n')
    expect(el.querySelector('.base-raw')).not.toBeNull()
    typeRaw(el, FIXED)
    expect(el.querySelector('.base-raw')).toBeNull()
    expect(tabNames(el)).toEqual(['Fixed'])
    expect(writeFile).not.toHaveBeenCalled()
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: FIXED, expectedMtime: 1 })
    expect(el.querySelector('.save-indicator')?.textContent).toBe('Saved')
  })

  it('ignores the watcher echo of its own PUT', async () => {
    const el = mount(INVALID)
    typeRaw(el, FIXED)
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    await emit({ type: 'change', path: PATH, mtime: 99 })
    expect(readFile).not.toHaveBeenCalled()
    expect(el.querySelector('.conflict-bar')).toBeNull()
  })

  it('reloads from disk on an external change while clean', async () => {
    const el = mount(FIXTURE)
    const next = 'views:\n  - type: table\n    name: Fresh\n  - type: cards\n    name: Gallery\n'
    readFile.mockResolvedValueOnce({ path: PATH, content: next, mtime: 2, size: next.length })
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(readFile).toHaveBeenCalledWith(PATH)
    expect(tabNames(el)).toEqual(['Fresh', 'Gallery'])
    expect(el.querySelector('.conflict-bar')).toBeNull()
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('ignores events for other paths and non-change events', async () => {
    mount(FIXTURE)
    await emit({ type: 'change', path: '/vault/other.base', mtime: 2 })
    await emit({ type: 'add', path: PATH, mtime: 2 })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('a reload that lands on invalid YAML drops into raw mode', async () => {
    const el = mount(FIXTURE)
    readFile.mockResolvedValueOnce({ path: PATH, content: INVALID, mtime: 2, size: INVALID.length })
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(el.querySelector('.base-view')).toBeNull()
    expect(el.querySelector<HTMLTextAreaElement>('textarea.base-raw')?.value).toBe(INVALID)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('shows the conflict bar instead of reloading when dirty; Keep mine overwrites', async () => {
    const el = mount(INVALID)
    typeRaw(el, FIXED)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    expect(readFile).not.toHaveBeenCalled()
    const bar = el.querySelector('.conflict-bar')
    expect(bar?.textContent).toContain('File changed on disk.')
    expect(tabNames(el)).toEqual(['Fixed'])
    const keep = [...(bar?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Keep mine')
    await act(async () => {
      keep?.click()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: FIXED, expectedMtime: 2 })
  })

  it('survives StrictMode double-mount: one watcher subscription per consumer, one PUT, no write on open', async () => {
    const file: FileResponse = { path: PATH, content: INVALID, mtime: 1, size: INVALID.length }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <StrictMode>
          <BaseHost root="/vault" file={file} watch={watch} onOpenFile={openFile} />
        </StrictMode>,
      ),
    )
    // Two subscribers on the fan-out: BaseHost's reload watcher and useIndex's refetch watcher.
    expect(listeners).toHaveLength(2)
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
    typeRaw(container, FIXED)
    await pastDebounce()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toEqual({ path: PATH, content: FIXED, expectedMtime: 1 })
    expect(container.querySelector('.save-indicator')?.textContent).toBe('Saved')
  })

  it('Reload in the conflict bar discards local edits and re-renders the disk version', async () => {
    const el = mount(INVALID)
    typeRaw(el, FIXED)
    await emit({ type: 'change', path: PATH, mtime: 2 })
    const disk = 'views:\n  - type: list\n    name: Disk\n'
    readFile.mockResolvedValueOnce({ path: PATH, content: disk, mtime: 2, size: disk.length })
    const reload = [...el.querySelectorAll<HTMLButtonElement>('.conflict-bar button')].find((b) => b.textContent === 'Reload')
    await act(async () => {
      reload?.click()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(el.querySelector('.conflict-bar')).toBeNull()
    expect(tabNames(el)).toEqual(['Disk'])
    await pastDebounce()
    expect(writeFile).not.toHaveBeenCalled()
  })
})
