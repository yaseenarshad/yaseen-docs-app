import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse } from '@shared/types'
import { useFile, type FileState } from './useFile'
import { _resetRenameContinuity, flushRenamedPath, registerRenameContinuity } from '../lib/renameContinuity'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
let state: FileState = { status: 'idle' }

function Probe({ path, revision = 0 }: { path: string | null; revision?: number }) {
  state = useFile(path, revision)
  return null
}

function render(path: string | null, revision = 0): void {
  if (root === null) {
    container = document.createElement('div')
    root = createRoot(container)
  }
  act(() => root?.render(<Probe path={path} revision={revision} />))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

const response = (path: string, content: string, mtime = 1): FileResponse => ({ path, content, mtime, size: new TextEncoder().encode(content).byteLength })

beforeEach(() => {
  writeFile.mockResolvedValue({ path: '/vault/note.md', mtime: 2, size: 0 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container = null
  state = { status: 'idle' }
  vi.restoreAllMocks()
})

describe('useFile reloadable read state (YAZ-1299)', () => {
  it('does no work for a null path', async () => {
    render(null)
    await flush()
    expect(state).toEqual({ status: 'idle' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it.each(['/vault/Page.md', '/vault/data.JsOn'])('a read is only a read: %s, frontmatter and body, comes through byte-for-byte and is never rewritten', async (path) => {
    const file = response(path, '---\r\nstatus: idea\r\n---\r\n\tvalue  \r\n')
    readFile.mockResolvedValueOnce(file)

    render(path)
    await flush()

    expect(state).toEqual({ status: 'ready', path, file })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a revision reload keeps the current file as prev until the replacement resolves', async () => {
    const path = '/vault/data.json'
    const first = response(path, 'old\r\ncontent\r\n', 1)
    let resolveReload!: (file: FileResponse) => void
    readFile.mockResolvedValueOnce(first).mockReturnValueOnce(new Promise<FileResponse>((resolve) => (resolveReload = resolve)))
    render(path)
    await flush()

    render(path, 1)
    expect(state).toEqual({ status: 'loading', path, prev: first })
    expect(readFile).toHaveBeenCalledTimes(2)

    const next = response(path, 'new\r\ncontent\r\n', 2)
    resolveReload(next)
    await flush()
    expect(state).toEqual({ status: 'ready', path, file: next })
  })

  it('a failed same-path reload reports the error while retaining the last readable snapshot', async () => {
    const path = '/vault/data.json'
    const first = response(path, 'still visible', 1)
    readFile.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('gone'))
    render(path)
    await flush()

    render(path, 1)
    await flush()

    expect(state).toEqual({ status: 'error', path, message: 'Failed to load file', prev: first })
  })

  it('a retry after a reload error still retains the last readable snapshot', async () => {
    const path = '/vault/data.json'
    const first = response(path, 'still visible', 1)
    let resolveRetry!: (file: FileResponse) => void
    readFile
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('gone'))
      .mockReturnValueOnce(new Promise<FileResponse>((resolve) => (resolveRetry = resolve)))
    render(path)
    await flush()
    render(path, 1)
    await flush()

    render(path, 2)
    expect(state).toEqual({ status: 'loading', path, prev: first })

    const recovered = response(path, 'back', 3)
    resolveRetry(recovered)
    await flush()
    expect(state).toEqual({ status: 'ready', path, file: recovered })
  })
})

describe('a read waits for a save that is under way (YAZ-3685 F5)', () => {
  afterEach(() => _resetRenameContinuity())

  it('F5: a copy that opens while its source flushes reads the file only after that save is on disk; with no flush it reads at once', async () => {
    let saved = (): void => undefined
    const off = registerRenameContinuity('/vault/note.md', { flush: () => new Promise<void>((done) => (saved = done)), capture: () => null, retire: () => undefined })
    readFile.mockResolvedValue(response('/vault/note.md', '* Day 4: Faro\n'))
    void flushRenamedPath('/vault/note.md') // the source saves its unsaved typing (the switch to the copy starts it)
    render('/vault/note.md')
    await flush()
    expect([readFile.mock.calls.length, state.status]).toEqual([0, 'loading'])
    saved()
    await flush()
    await flush()
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
    expect(state).toEqual({ status: 'ready', path: '/vault/note.md', file: response('/vault/note.md', '* Day 4: Faro\n') })
    off()
    // No save under way: the read starts in the same effect, as before.
    readFile.mockClear()
    render('/vault/other.md')
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/vault/other.md')
  })
})
