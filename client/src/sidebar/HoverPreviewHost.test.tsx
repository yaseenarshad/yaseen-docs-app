/** The hover preview's dwell, driven directly on the Sidebar's half (Draw's YAZ-1800; ported by YAZ-3028 D11). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode, WatchEvent } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { createStore } from '../lib/store'
import { BOARD_PREVIEW_DWELL_MS, HoverPreviewHost, useHoverPreview, type HoverState } from './HoverPreviewHost'

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { boardHead: vi.fn() },
}))

/** The lazy panel, stood in: it reports the cache key the host handed it. */
const panel = vi.hoisted(() => ({ keys: [] as string[] }))
vi.mock('./BoardPreview', () => ({
  default: ({ cacheKey }: { cacheKey: string }) => {
    panel.keys.push(cacheKey)
    return <div className="fake-board-preview" />
  },
}))

const board = (name: string) => ({ path: `/v/${name}.excalidraw` })

let root: Root | null = null
let hook: ReturnType<typeof useHoverPreview>
interface ProbeProps {
  blocked: boolean
  enabled: boolean
  activeFile: string | null
}
function Probe({ blocked, enabled, activeFile }: ProbeProps) {
  hook = useHoverPreview(blocked, enabled, activeFile)
  return null
}
const render = (props: Partial<ProbeProps> = {}) => act(() => root?.render(<Probe blocked={false} enabled activeFile={null} {...props} />))
const state = () => hook.hover.getState()
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
  root = createRoot(document.createElement('div'))
})
afterEach(() => {
  act(() => root?.unmount())
  vi.useRealTimers()
})

describe('useHoverPreview', () => {
  it('the same row again (focus after the pointer, or back) keeps its dwell rather than restarting it', () => {
    render()
    act(() => hook.hoverFile(board('a')))
    expect(state()).toEqual({ path: '/v/a.excalidraw', shown: false })
    wait(BOARD_PREVIEW_DWELL_MS - 1)
    act(() => hook.hoverFile(board('a')))
    wait(1)
    expect(state()).toEqual({ path: '/v/a.excalidraw', shown: true })
  })

  it('an earlier row`s dwell never fires for the next one', () => {
    render()
    act(() => hook.hoverFile(board('a')))
    wait(BOARD_PREVIEW_DWELL_MS - 100)
    act(() => hook.hoverFile(board('b')))
    wait(100)
    expect(state()).toEqual({ path: '/v/b.excalidraw', shown: false })
    wait(BOARD_PREVIEW_DWELL_MS)
    expect(state()).toEqual({ path: '/v/b.excalidraw', shown: true })
  })

  it('opens nothing while blocked, and closes on blocking, disabling, or another board opening', () => {
    render({ blocked: true })
    act(() => hook.hoverFile(board('a')))
    wait(BOARD_PREVIEW_DWELL_MS)
    expect(state().path).toBeNull()
    for (const next of [{ blocked: true }, { enabled: false }, { activeFile: '/v/b.excalidraw' }]) {
      render()
      act(() => hook.hoverFile(board('a')))
      wait(BOARD_PREVIEW_DWELL_MS)
      expect(state().shown).toBe(true)
      render(next)
      expect(state()).toEqual({ path: null, shown: false })
    }
  })
})

describe('only a board row opens a preview in Docs (YAZ-3028 D11)', () => {
  it('a note, a text file or an image row starts no dwell at all', () => {
    render()
    for (const path of ['/v/Note.md', '/v/data.json', '/v/photo.png']) {
      act(() => hook.hoverFile({ path }))
      wait(BOARD_PREVIEW_DWELL_MS)
      expect(state()).toEqual({ path: null, shown: false })
    }
    act(() => hook.hoverFile({ path: '/v/Flow.drawio' }))
    wait(BOARD_PREVIEW_DWELL_MS)
    expect(state()).toEqual({ path: '/v/Flow.drawio', shown: true })
  })
})

describe('HoverPreviewHost', () => {
  const file: TreeNode = { type: 'file', name: 'Flow.excalidraw', path: '/v/Flow.excalidraw', size: 10, mtime: 1000, kind: 'drawing' }

  beforeEach(() => {
    vi.useRealTimers()
    panel.keys = []
    vi.mocked(api.boardHead).mockReset()
  })

  const listeners = new Set<(ev: WatchEvent) => void>()
  const watch = { subscribe: (l: (ev: WatchEvent) => void) => (listeners.add(l), () => void listeners.delete(l)) }

  async function show(): Promise<void> {
    const hover = createStore<HoverState>({ path: file.path, shown: true })
    await act(async () => {
      root?.render(<HoverPreviewHost hover={hover} forest={[file]} rootOf={() => '/v'} watchOf={() => watch} enabled diagramDarkColors="adapt" anchor={createRef<HTMLElement>()} onClose={() => undefined} />)
    })
    // The lazy chunk and the head read both settle.
    for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
  }

  it('opens on the newer of the tree mtime and the board head', async () => {
    vi.mocked(api.boardHead).mockResolvedValue({ mtime: 2000 } as never)
    await show()
    expect(panel.keys.at(-1)?.split('\n')[2]).toBe('2000')
  })

  it('YAZ-3044 A6: a board head that fails still opens the panel, on the tree mtime, so the picture can say why', async () => {
    vi.mocked(api.boardHead).mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'gone'))
    await show()
    expect(panel.keys.length).toBeGreaterThan(0)
    expect(panel.keys.at(-1)?.split('\n')[2]).toBe('1000')
  })

  it('YAZ-3044 A41: a change of the shown board while the panel is up draws it again on the new mtime; another file does not', async () => {
    vi.mocked(api.boardHead).mockResolvedValue({ mtime: 2000 } as never)
    await show()
    await act(async () => [...listeners].forEach((l) => l({ type: 'change', path: '/v/other.md', mtime: 5000 })))
    expect(panel.keys.at(-1)?.split('\n')[2]).toBe('2000')
    await act(async () => [...listeners].forEach((l) => l({ type: 'change', path: file.path, mtime: 3000 })))
    expect(panel.keys.at(-1)?.split('\n')[2]).toBe('3000')
  })
})
