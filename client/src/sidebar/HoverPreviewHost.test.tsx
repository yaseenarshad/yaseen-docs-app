/** The hover preview's dwell, driven directly on the Sidebar's half (Draw's YAZ-1800; ported by YAZ-3028 D11; pages by YAZ-3075). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode, WatchEvent } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { createStore } from '../lib/store'
import { HOVER_PREVIEW_DWELL_MS, HoverPreviewHost, useHoverPreview, type HoverState } from './HoverPreviewHost'

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { boardHead: vi.fn() },
}))

/** The lazy panel, stood in: it reports the cache key the host handed it. */
const panel = vi.hoisted(() => ({
  keys: [] as string[],
  pages: [] as { path: string; size: unknown }[],
  code: [] as string[],
  inline: [] as { inlineRef: unknown; root?: string; place?: string; name?: string; dark?: boolean; diagramDarkColors?: string }[],
}))
vi.mock('./BoardPreview', () => ({
  default: ({ cacheKey }: { cacheKey: string }) => {
    panel.keys.push(cacheKey)
    return <div className="fake-board-preview" />
  },
}))
/** The lazy page panel, stood in: it reports which page and which text formatting the host handed it. */
vi.mock('./PagePreview', () => ({
  default: ({ node, textVars }: { node: { path: string }; textVars: Record<string, unknown> }) => {
    panel.pages.push({ path: node.path, size: textVars['--text-size'] })
    return <div className="fake-page-preview" />
  },
}))

/** The lazy code card (YAZ-3508), stood in: it reports which file the host handed it. Monaco never loads here. */
vi.mock('../code/CodeHoverPreview', () => ({
  default: ({ path }: { path: string }) => {
    panel.code.push(path)
    return <div className="fake-code-preview" />
  },
}))

/** The lazy inline preview (YAZ-6468), stood in: reports the ref and parent page props handed by the host. */
vi.mock('./InlineHoverPreview', () => ({
  default: (props: { inlineRef: unknown; root?: string; place?: string; name?: string; dark?: boolean; diagramDarkColors?: string }) => {
    panel.inline.push({
      inlineRef: props.inlineRef,
      root: props.root,
      place: props.place,
      name: props.name,
      dark: props.dark,
      diagramDarkColors: props.diagramDarkColors,
    })
    return <div className="fake-inline-preview" />
  },
}))

const board = (name: string) => ({ path: `/v/${name}.excalidraw` })

let root: Root | null = null
let hook: ReturnType<typeof useHoverPreview>
interface ProbeProps {
  blocked: boolean
  activeFile: string | null
}
function Probe({ blocked, activeFile }: ProbeProps) {
  hook = useHoverPreview(blocked, activeFile)
  return null
}
const render = (props: Partial<ProbeProps> = {}) => act(() => root?.render(<Probe blocked={false} activeFile={null} {...props} />))
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
    wait(HOVER_PREVIEW_DWELL_MS - 1)
    act(() => hook.hoverFile(board('a')))
    wait(1)
    expect(state()).toEqual({ path: '/v/a.excalidraw', shown: true })
  })

  it('an earlier row`s dwell never fires for the next one', () => {
    render()
    act(() => hook.hoverFile(board('a')))
    wait(HOVER_PREVIEW_DWELL_MS - 100)
    act(() => hook.hoverFile(board('b')))
    wait(100)
    expect(state()).toEqual({ path: '/v/b.excalidraw', shown: false })
    wait(HOVER_PREVIEW_DWELL_MS)
    expect(state()).toEqual({ path: '/v/b.excalidraw', shown: true })
  })

  it('opens nothing while blocked, and closes on blocking or another board opening', () => {
    render({ blocked: true })
    act(() => hook.hoverFile(board('a')))
    wait(HOVER_PREVIEW_DWELL_MS)
    expect(state().path).toBeNull()
    for (const next of [{ blocked: true }, { activeFile: '/v/b.excalidraw' }]) {
      render()
      act(() => hook.hoverFile(board('a')))
      wait(HOVER_PREVIEW_DWELL_MS)
      expect(state().shown).toBe(true)
      render(next)
      expect(state()).toEqual({ path: null, shown: false })
    }
  })

  it('a press ends the glance (YAZ-5648 #4): a click on the row of the page already open, mid-dwell or shown, leaves no preview over the page', () => {
    const page = { path: '/v/Long page.md' }
    render({ activeFile: page.path })
    act(() => hook.hoverFile(page))
    wait(HOVER_PREVIEW_DWELL_MS - 100)
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    // The row's focus comes right after the press: it starts no dwell.
    act(() => hook.hoverFile(page))
    wait(HOVER_PREVIEW_DWELL_MS)
    expect(state()).toEqual({ path: null, shown: false })
    // Once the pointer leaves the row and comes back, it previews again.
    act(() => hook.hoverFile(null))
    act(() => hook.hoverFile(page))
    wait(HOVER_PREVIEW_DWELL_MS)
    expect(state().shown).toBe(true)
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(state()).toEqual({ path: null, shown: false })
  })
})

describe('a board or a page row opens a preview (YAZ-3028 D11, YAZ-3075 D6)', () => {
  it('C1, C31: a page row waits the same 400 ms and shows; a PDF or an image row too (YAZ-3746 13R, overturning YAZ-3075 D6); a video row starts no dwell at all', () => {
    render()
    act(() => hook.hoverFile({ path: '/v/clip.mp4' }))
    wait(HOVER_PREVIEW_DWELL_MS)
    expect(state()).toEqual({ path: null, shown: false })
    for (const path of ['/v/paper.pdf', '/v/photo.png']) {
      act(() => hook.hoverFile({ path }))
      wait(HOVER_PREVIEW_DWELL_MS - 1)
      expect(state()).toEqual({ path, shown: false })
      wait(1)
      expect(state()).toEqual({ path, shown: true })
    }
    act(() => hook.hoverFile({ path: '/v/Page.md' }))
    wait(HOVER_PREVIEW_DWELL_MS - 1)
    expect(state()).toEqual({ path: '/v/Page.md', shown: false })
    wait(1)
    expect(state()).toEqual({ path: '/v/Page.md', shown: true })
    act(() => hook.hoverFile({ path: '/v/Flow.drawio' }))
    wait(HOVER_PREVIEW_DWELL_MS)
    expect(state()).toEqual({ path: '/v/Flow.drawio', shown: true })
  })

  it('YAZ-3508: a code or text file row waits the same 400 ms and shows, a well-known name too', () => {
    render()
    for (const path of ['/v/data.json', '/v/src/app.ts', '/v/Dockerfile']) {
      act(() => hook.hoverFile({ path }))
      wait(HOVER_PREVIEW_DWELL_MS - 1)
      expect(state()).toEqual({ path, shown: false })
      wait(1)
      expect(state()).toEqual({ path, shown: true })
    }
  })
})

describe('HoverPreviewHost', () => {
  const file: TreeNode = { type: 'file', name: 'Flow.excalidraw', path: '/v/Flow.excalidraw', size: 10, mtime: 1000, kind: 'drawing' }

  beforeEach(() => {
    vi.useRealTimers()
    panel.keys = []
    panel.pages = []
    vi.mocked(api.boardHead).mockReset()
  })

  const listeners = new Set<(ev: WatchEvent) => void>()
  const watch = { subscribe: (l: (ev: WatchEvent) => void) => (listeners.add(l), () => void listeners.delete(l)) }

  const wikilinks = createWikilinkResolveSource()
  async function show(shown: TreeNode = file): Promise<void> {
    const hover = createStore<HoverState>({ path: shown.path, shown: true })
    await act(async () => {
      root?.render(
        <HoverPreviewHost hover={hover} forest={[shown]} rootOf={() => '/v'} watchOf={() => watch} wikilinksOf={() => wikilinks} nameOf={(p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '')} textVarsOf={() => ({ '--text-size': '18px' }) as never} enabled diagramDarkColors="adapt" anchor={createRef<HTMLElement>()} onClose={() => undefined} />,
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

  it('YAZ-3508: a code file opens the code card, with no board head read', async () => {
    panel.code = []
    await show({ type: 'file', name: 'app.ts', path: '/v/src/app.ts', size: 10, mtime: 1000, kind: 'text' })
    expect(panel.code.at(-1)).toBe('/v/src/app.ts')
    expect(panel.pages).toEqual([])
    expect(api.boardHead).not.toHaveBeenCalled()
  })

  it('YAZ-3075 C20, C27: a page opens its own panel in its vault`s text formatting, with no board head read and no watch subscription', async () => {
    listeners.clear()
    await show({ type: 'file', name: 'Plan.md', path: '/v/Plan.md', size: 10, mtime: 1000, kind: 'markdown' })
    expect(panel.pages.at(-1)).toEqual({ path: '/v/Plan.md', size: '18px' })
    expect(api.boardHead).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
    expect(panel.keys).toEqual([])
  })

  it('YAZ-6468: an inline card or inline drawing ref resolves its parent page in forest and renders lazy InlineRefPreview with root, place, wikilinks, diagramDarkColors, and dark', async () => {
    panel.inline = []
    const parent: TreeNode = { type: 'file', name: 'Plan.md', path: '/v/Plan.md', size: 10, mtime: 1000, kind: 'markdown' }
    const onClose = vi.fn()
    for (const refPath of ['/v/Plan.md#WIKI-12', '/v/Plan.md#drawing-2']) {
      const hover = createStore<HoverState>({ path: refPath, shown: true })
      await act(async () => {
        root?.render(
          <HoverPreviewHost
            hover={hover}
            forest={[parent]}
            rootOf={() => '/v'}
            watchOf={() => watch}
            wikilinksOf={() => wikilinks}
            nameOf={(p) => (p === '/v/Plan.md' ? 'Annual Plan' : p)}
            textVarsOf={() => ({ '--text-size': '16px' }) as never}
            enabled
            diagramDarkColors="keep"
            anchor={createRef<HTMLElement>()}
            onClose={onClose}
          />,
        )
      })
      for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
    }
    expect(onClose).not.toHaveBeenCalled()
    expect(api.boardHead).not.toHaveBeenCalled()
    expect(panel.inline).toEqual([
      { inlineRef: { kind: 'card', page: '/v/Plan.md', id: 'WIKI-12' }, root: '/v', place: 'Annual Plan', name: undefined, dark: false, diagramDarkColors: 'keep' },
      { inlineRef: { kind: 'drawing', page: '/v/Plan.md', index: 2 }, root: '/v', place: 'Annual Plan', name: undefined, dark: false, diagramDarkColors: 'keep' },
    ])

    // When the parent page is gone from forest, HoverPreviewHost closes cleanly.
    const hoverMissing = createStore<HoverState>({ path: '/v/Gone.md#drawing-0', shown: true })
    await act(async () => {
      root?.render(
        <HoverPreviewHost
          hover={hoverMissing}
          forest={[parent]}
          rootOf={() => '/v'}
          wikilinksOf={() => wikilinks}
          nameOf={(p) => p}
          textVarsOf={() => ({}) as never}
          enabled
          diagramDarkColors="adapt"
          anchor={createRef<HTMLElement>()}
          onClose={onClose}
        />,
      )
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('YAZ-6468: inline refs in useHoverPreview', () => {
  it('inline card and inline drawing refs dwell 400 ms and show, while non-markdown # refs do not', () => {
    render()
    act(() => hook.hoverFile({ path: '/v/clip.mp4#drawing-0' }))
    wait(HOVER_PREVIEW_DWELL_MS)
    expect(state()).toEqual({ path: null, shown: false })
    for (const path of ['/v/Notes.md#WIKI-1', '/v/Notes.md#drawing-0']) {
      act(() => hook.hoverFile({ path }))
      wait(HOVER_PREVIEW_DWELL_MS - 1)
      expect(state()).toEqual({ path, shown: false })
      wait(1)
      expect(state()).toEqual({ path, shown: true })
    }
  })
})
