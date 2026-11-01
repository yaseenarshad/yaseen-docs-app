/**
 * A woken tab's caret (YAZ-3737 D3, YAZ-3926) through the REAL note editor: `createCrepe`, `placeCaret` and
 * `focusEditor` are not mocked (Editor.test.tsx's fake has no ProseMirror, so it sees only the call order).
 * The note has a list: Crepe's list-item node views put back, one frame after they mount, the caret the new
 * editor had then (its start). The test lets the mount, its effects and a few frames finish, then reads the
 * caret from the page view, as the tab sleep and "Duplicate tab" read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse, PageView } from '@shared/types'
import type { WatchSource } from '../hooks/useWatch'
import { readPageView } from '../lib/pageView'
import { Editor } from './Editor'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, tree: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), index: vi.fn(), properties: { get: vi.fn(), onChange: vi.fn() }, state: { ...actual.api.state, setFolds: vi.fn() } } }
})

import { api } from '../api'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/Note F.md'
const BODY = '# Note F\n\nFirst paragraph.\n\n- item one\n- item two\n\nThird paragraph QW of text.\n'
const noop = (): void => undefined
const watch: WatchSource = { subscribe: () => noop }

let root: Root | null = null
let container: HTMLElement | null = null

/** The mount, its effects, and some frames (the list-item caret restore runs on one). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
}

/** Mounts the note in a tab layer (`data-tab`, as App draws it) with `startView`; `behind`: a hover wake (S7). */
async function mount(startView: PageView | undefined, behind = false): Promise<void> {
  const file: FileResponse = { path: PATH, content: BODY, mtime: 1, size: BODY.length }
  vi.mocked(api.readFile).mockResolvedValue(file)
  container = document.createElement('div')
  container.className = behind ? 'tabstack__layer tabstack__layer--hidden' : 'tabstack__layer'
  container.dataset.tab = 'tab-1'
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Editor root="/vault" path={PATH} watch={watch} onOpenFile={noop} commentsOrder="oldest" onChangeCommentsOrder={noop} wikilinks={createWikilinkResolveSource()} onRetitle={noop} startView={startView} tabId="tab-1" zoomKey={null} />))
  await settle()
}

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

const caret = () => readPageView('tab-1')?.selection

beforeEach(() => {
  vi.mocked(api.tree).mockImplementation(async (r) => ({ root: r, tree: [], generatedAt: 1 }))
  vi.mocked(api.writeFile).mockImplementation(async (body) => ({ path: body.path, mtime: 99, size: body.content.length }))
  vi.mocked(api.state.setFolds).mockResolvedValue(undefined as never)
  Object.defineProperty(window, 'yaseenDocs', { value: { window: { onFlush: () => noop } }, configurable: true, writable: true })
})

afterEach(() => {
  unmount()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.resetAllMocks()
})

describe('a woken note keeps its caret, through the real editor (YAZ-3737 D3, YAZ-3926)', () => {
  it('a woken tab or a copy (front, with the caret grab) and a hover wake (behind, S7) end with the kept caret, not at the start', async () => {
    // With no page view the caret starts at 1, in the title: where the bug put a woken tab's.
    await mount(undefined)
    expect([...container!.querySelectorAll('.ProseMirror > p')].at(-1)?.textContent).toBe('Third paragraph QW of text.')
    expect(caret()).toEqual({ anchor: 1, head: 1 })
    unmount()
    // "QW" selected (69 to 71), in the paragraph after the list.
    for (const behind of [false, true]) {
      await mount({ scrollTop: 0, zoomKey: null, folds: [], magnification: 100, selection: { anchor: 69, head: 71 } }, behind)
      expect(caret(), behind ? 'hover wake' : 'click wake').toEqual({ anchor: 69, head: 71 })
      unmount()
    }
  })
})
