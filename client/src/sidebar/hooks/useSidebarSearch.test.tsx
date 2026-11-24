import { act, useCallback, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord, TreeNode } from '@shared/types'
import { api } from '../../api'
import { NO_FILTER } from '../../search/searchFilter'
import { PREVIEW_FOLLOW_MS, useSidebarSearch } from './useSidebarSearch'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PAGE = '/v/Plan.md'
const TREE: TreeNode[] = [{ type: 'file', name: 'Plan.md', path: PAGE, size: 1, mtime: 100, kind: 'markdown' }]
const RECORDS: IndexRecord[] = [
  {
    path: PAGE,
    name: 'Plan.md',
    basename: 'Plan',
    title: 'Plan',
    folder: '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 100,
    properties: {},
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
    cards: [{ id: 'GEO-140', title: 'Capital of France', off: false, next: false, reviews: [] }],
    inlineDrawings: [{ index: 0, title: 'Architecture' }],
  },
]

const noopWatch = { subscribe: () => () => undefined }
const identityLevel = (nodes: readonly TreeNode[]) => nodes

function fakeKeyEvent(init: Partial<ReactKeyboardEvent<HTMLInputElement>> & { key: string }): ReactKeyboardEvent<HTMLInputElement> {
  return {
    key: init.key,
    code: init.code ?? '',
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    repeat: init.repeat ?? false,
    nativeEvent: { isComposing: false },
    defaultPrevented: false,
    preventDefault: vi.fn(function (this: { defaultPrevented: boolean }) {
      this.defaultPrevented = true
    }),
    stopPropagation: vi.fn(),
  } as unknown as ReactKeyboardEvent<HTMLInputElement>
}

describe('useSidebarSearch inline parity (YAZ-6469)', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  let clipDescriptor: PropertyDescriptor | undefined
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clipDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.spyOn(api, 'index').mockResolvedValue({ root: '/v', records: RECORDS, folders: [], generatedAt: 1, ids: true, letters: ['GEO'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    act(() => root?.unmount())
    root = null
    host?.remove()
    host = null
    vi.restoreAllMocks()
    if (clipDescriptor === undefined) delete (navigator as unknown as Record<string, unknown>).clipboard
    else Object.defineProperty(navigator, 'clipboard', clipDescriptor)
  })

  async function mountHook(opts: { hotkeys?: Record<string, string | null> } = {}) {
    const onPreview = vi.fn()
    const onNotice = vi.fn()
    let latest!: ReturnType<typeof useSidebarSearch>
    const vaults = [{ root: '/v', watch: noopWatch, dirs: [], files: [], cards: true }]

    function Harness() {
      const [preview, setPreview] = useState<string | null>(null)
      const handlePreview = useCallback((next: string | null) => {
        onPreview(next)
        setPreview(next)
      }, [])
      latest = useSidebarSearch(
        vaults,
        TREE,
        [],
        true,
        vi.fn(),
        false,
        vi.fn(),
        vi.fn(),
        preview,
        handlePreview,
        identityLevel,
        true,
        NO_FILTER,
        vi.fn(),
        false,
        vi.fn(),
        true,
        opts.hotkeys,
        onNotice,
      )
      return null
    }

    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(<Harness />)
      await Promise.resolve()
      await Promise.resolve()
    })
    return { get: () => latest, onPreview, onNotice }
  }

  it('passes full synthetic inline ref on Space QuickLook and arrow follow (never strips #CARD-ID or #drawing-N)', async () => {
    const { get, onPreview } = await mountHook()

    // Search for the inline drawing (lazy index fetch triggers on first query)
    await act(async () => {
      get().changeQuery({ target: { value: 'Architecture' } } as ChangeEvent<HTMLInputElement>)
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(get().results.map((r) => r.path)).toEqual([`${PAGE}#drawing-0`]))
    vi.useFakeTimers()
    // First ArrowDown picks the row (listKey requires picked !== null)
    act(() => get().searchKeyDown(fakeKeyEvent({ key: 'ArrowDown' })))
    // Space opens QuickLook on the synthetic drawing ref
    act(() => get().searchKeyDown(fakeKeyEvent({ key: ' ' })))
    expect(onPreview).toHaveBeenLastCalledWith(`${PAGE}#drawing-0`)

    // Close preview and search for the inline card
    act(() => get().searchKeyDown(fakeKeyEvent({ key: ' ' })))
    expect(onPreview).toHaveBeenLastCalledWith(null)

    act(() => get().changeQuery({ target: { value: 'Capital' } } as ChangeEvent<HTMLInputElement>))
    expect(get().results.map((r) => r.path)).toEqual([`${PAGE}#GEO-140`])
    act(() => get().searchKeyDown(fakeKeyEvent({ key: 'ArrowDown' })))
    act(() => get().searchKeyDown(fakeKeyEvent({ key: ' ' })))
    expect(onPreview).toHaveBeenLastCalledWith(`${PAGE}#GEO-140`)

    // Arrow follow from page row to inline card row after PREVIEW_FOLLOW_MS keeps synthetic ref
    act(() => get().changeQuery({ target: { value: 'a' } } as ChangeEvent<HTMLInputElement>))
    // Rows in tree order for 'a': Plan.md, then its children (Architecture / Capital of France)
    act(() => get().searchKeyDown(fakeKeyEvent({ key: 'ArrowUp' })))
    act(() => get().searchKeyDown(fakeKeyEvent({ key: ' ' })))
    expect(onPreview).toHaveBeenLastCalledWith(PAGE)

    onPreview.mockClear()
    act(() => get().searchKeyDown(fakeKeyEvent({ key: 'ArrowDown' })))
    act(() => void vi.advanceTimersByTime(PREVIEW_FOLLOW_MS))
    const followed = onPreview.mock.calls.at(-1)?.[0]
    expect([`${PAGE}#GEO-140`, `${PAGE}#drawing-0`]).toContain(followed)
  })

  it('⌘⇧C copies canonical <pagePath>:<line> for inline rows and plain path for normal rows, ignoring plain ⌘C', async () => {
    vi.spyOn(api, 'readFile').mockResolvedValue({
      path: PAGE,
      content: 'Header\n```card\nParis\n```\n<!-- card: GEO-140 -->\n```excalidraw\n{}\n```\n',
      mtime: 1,
      size: 1,
    })

    const { get, onNotice } = await mountHook()

    // Inline card highlighted -> ⌘⇧C copies /v/Plan.md:2
    await act(async () => {
      get().changeQuery({ target: { value: 'Capital' } } as ChangeEvent<HTMLInputElement>)
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(get().results.map((r) => r.path)).toEqual([`${PAGE}#GEO-140`]))
    const plainCopy = fakeKeyEvent({ key: 'c', code: 'KeyC', metaKey: true, shiftKey: false })
    act(() => get().searchKeyDown(plainCopy))
    expect(plainCopy.preventDefault).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()

    const cardCopy = fakeKeyEvent({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })
    act(() => get().searchKeyDown(cardCopy))
    expect(cardCopy.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${PAGE}:2`))
    expect(onNotice).toHaveBeenCalledWith('Copied path', 'info', 'clipboard')

    // Inline drawing highlighted -> ⌘⇧C copies /v/Plan.md:6
    writeText.mockClear()
    act(() => get().changeQuery({ target: { value: 'Architecture' } } as ChangeEvent<HTMLInputElement>))
    act(() => get().searchKeyDown(fakeKeyEvent({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${PAGE}:6`))

    // Normal page highlighted -> ⌘⇧C copies /v/Plan.md
    writeText.mockClear()
    act(() => get().changeQuery({ target: { value: 'Plan' } } as ChangeEvent<HTMLInputElement>))
    act(() => get().searchKeyDown(fakeKeyEvent({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(PAGE))
  })
})
