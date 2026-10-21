/** The hover preview's dwell, driven directly on the Sidebar's half (Draw's YAZ-1800; ported by YAZ-3028 D11; notes by YAZ-3075). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode, WatchEvent } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { createStore } from '../lib/store'
import { BOARD_PREVIEW_DWELL_MS, HoverPreviewHost, useHoverPreview, type HoverState } from './HoverPreviewHost'

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { boardHead: vi.fn() },
}))

/** The lazy panel, stood in: it reports the cache key the host handed it. */
const panel = vi.hoisted(() => ({ keys: [] as string[], notes: [] as { path: string; size: unknown }[] }))
vi.mock('./BoardPreview', () => ({
  default: ({ cacheKey }: { cacheKey: string }) => {
    panel.keys.push(cacheKey)
    return <div className="fake-board-preview" />
  },
}))
/** The lazy note panel, stood in: it reports which note and which text formatting the host handed it. */
vi.mock('./NotePreview', () => ({
  default: ({ node, textVars }: { node: { path: string }; textVars: Record<string, unknown> }) => {
    panel.notes.push({ path: node.path, size: textVars['--text-size'] })
    return <div className="fake-note-preview" />
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

describe('a board or a note row opens a preview (YAZ-3028 D11, YAZ-3075 D6)', () => {
  it('C1, C31: a note row waits the same 400 ms and shows; a text file, a PDF or an image row starts no dwell at all', () => {
    render()
    for (const path of ['/v/data.json', '/v/paper.pdf', '/v/photo.png']) {
      act(() => hook.hoverFile({ path }))
      wait(BOARD_PREVIEW_DWELL_MS)
      expect(state()).toEqual({ path: null, shown: false })
    }
    act(() => hook.hoverFile({ path: '/v/Note.md' }))
    wait(BOARD_PREVIEW_DWELL_MS - 1)
    expect(state()).toEqual({ path: '/v/Note.md', shown: false })
    wait(1)
    expect(state()).toEqual({ path: '/v/Note.md', shown: true })
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
    panel.notes = []
    vi.mocked(api.boardHead).mockReset()
  })

  const listeners = new Set<(ev: WatchEvent) => void>()
  const watch = { subscribe: (l: (ev: WatchEvent) => void) => (listeners.add(l), () => void listeners.delete(l)) }

  const wikilinks = createWikilinkResolveSource()
  async function show(shown: TreeNode = file): Promise<void> {
    const hover = createStore<HoverState>({ path: shown.path, shown: true })
    await act(async () => {
      root?.render(
        <HoverPreviewHost hover={hover} forest={[shown]} rootOf={() => '/v'} watchOf={() => watch} wikilinksOf={() => wikilinks} textVarsOf={() => ({ '--text-size': '18px' }) as never} enabled diagramDarkColors="adapt" anchor={createRef<HTMLElement>()} onClose={() => undefined} />,
      )
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

  it('YAZ-3075 C20, C27: a note opens its own panel in its vault`s text formatting, with no board head read and no watch subscription', async () => {
    listeners.clear()
    await show({ type: 'file', name: 'Plan.md', path: '/v/Plan.md', size: 10, mtime: 1000, kind: 'markdown' })
    expect(panel.notes.at(-1)).toEqual({ path: '/v/Plan.md', size: '18px' })
    expect(api.boardHead).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
    expect(panel.keys).toEqual([])
  })
})
