import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DrawingSurfaceApi, DrawingSurfaceProps } from './ExcalidrawSurface'
import { fakeWatch } from '../documents/boardTestKit'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      readFile: vi.fn(),
      writeFile: vi.fn(),
      drawing: { ...actual.api.drawing, resolveAssets: vi.fn(async () => ({ files: {}, stored: [] })), landAssets: vi.fn(async () => ({ persisted: [] })) },
      dialog: { saveDrawing: vi.fn(), savePdf: vi.fn() },
      window: { ...actual.api.window, onFlush: vi.fn(() => () => undefined) },
    },
  }
})

const surface = {
  props: null as DrawingSurfaceProps | null,
  openImageExport: vi.fn(),
  exportScene: vi.fn(async () => '{"type":"excalidraw","elements":[],"files":{}}\n'),
}

vi.mock('./ExcalidrawSurface', async (importOriginal) => ({
  ENGINE_LOAD_FAILED: ((await importOriginal()) as { ENGINE_LOAD_FAILED: string }).ENGINE_LOAD_FAILED,
  ExcalidrawSurface: (props: DrawingSurfaceProps) => {
    surface.props = props
    props.onApi?.({
      refresh: () => undefined,
      focus: () => undefined,
      openAddSearch: () => undefined,
      openImageExport: surface.openImageExport,
      setCanvasBackground: () => undefined,
      exportScene: surface.exportScene,
      pictures: () => ({ bytes: 0, count: 0, missing: 0 }),
      replaceScene: () => 0,
      mergeScene: () => ({ conflicts: [] }),
      clash: () => undefined,
      whenIdle: async () => true,
      canvas: () => ({ scrollX: 0, scrollY: 0, zoom: 1 }),
    } satisfies DrawingSurfaceApi)
    return <div data-testid="surface">{props.renderTopRight?.()}</div>
  },
}))

import { api } from '../api'
import { InlineDrawingTab } from './InlineDrawingTab'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function menuIn(scope: ParentNode): HTMLElement | null {
  const id = scope.querySelector('.page-settings > button[aria-expanded="true"]')?.getAttribute('aria-controls')
  return id == null ? null : document.getElementById(id)
}

const SAMPLE_MD = [
  '# Notes',
  '',
  '```excalidraw',
  '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}',
  '```',
  '<!-- drawing: title "Architecture" -->',
  '',
].join('\n')

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  surface.props = null
  surface.openImageExport.mockReset()
  surface.exportScene.mockReset()
  surface.exportScene.mockResolvedValue('{"type":"excalidraw","elements":[],"files":{}}\n')
  vi.mocked(api.readFile).mockReset()
  vi.mocked(api.readFile).mockResolvedValue({ path: '/v/Notes.md', content: SAMPLE_MD, mtime: 100, size: SAMPLE_MD.length })
  vi.mocked(api.writeFile).mockReset()
  vi.mocked(api.writeFile).mockImplementation(async ({ path, content }) => ({ path, mtime: 200, size: content.length }))
  vi.mocked(api.dialog.saveDrawing).mockReset()
  vi.mocked(api.dialog.saveDrawing).mockResolvedValue({ path: '/tmp/Architecture.excalidraw' })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('InlineDrawingTab cog menu (YAZ-6330)', () => {
  it('renders the cog with Export Image or PDF… and Export Excalidraw Drawing… and invokes the exports', async () => {
    const onNotice = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<InlineDrawingTab root="/v" path="/v/Notes.md" index={0} watch={fakeWatch().watch} onNotice={onNotice} />)
    })

    const cog = container.querySelector<HTMLButtonElement>('.page-settings > button')
    expect(cog).not.toBeNull()
    await act(async () => cog!.click())
    const menu = menuIn(container)
    expect(menu).not.toBeNull()
    const labels = [...menu!.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent?.trim())
    expect(labels).toContain('Export Image or PDF…')
    expect(labels).toContain('Export Excalidraw Drawing…')

    const exportImageBtn = [...menu!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Export Image or PDF…'))!
    await act(async () => exportImageBtn.click())
    expect(surface.openImageExport).toHaveBeenCalledTimes(1)

    await act(async () => cog!.click())
    const menu2 = menuIn(container)!
    const exportDrawingBtn = [...menu2.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Export Excalidraw Drawing…'))!
    await act(async () => exportDrawingBtn.click())
    expect(surface.exportScene).toHaveBeenCalledTimes(1)
    expect(api.dialog.saveDrawing).toHaveBeenCalledWith({
      defaultName: 'Architecture.excalidraw',
      content: '{"type":"excalidraw","elements":[],"files":{}}\n',
    })
  })

  it('YAZ-6342: renders Link preview on hover, Fold arrows, and Hover outline (omitting Read only and Pictures rows), updates ExcalidrawSurface, and persists yaseendraw', async () => {
    const raw = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<InlineDrawingTab root="/v" path="/v/Notes.md" index={0} watch={fakeWatch().watch} />)
    })

    // Emit baseline snapshot so autosave is active
    act(() => surface.props?.onSnapshot({ version: 1, serialize: () => ({ json: raw, files: {}, referenced: new Set() }) }))

    const cog = container.querySelector<HTMLButtonElement>('.page-settings > button')!
    await act(async () => cog.click())
    const menu = menuIn(container)!
    expect(menu.textContent).toContain('Link preview on hover')
    expect(menu.textContent).toContain('Fold arrows')
    expect(menu.textContent).toContain('Hover outline')
    expect(menu.textContent).not.toContain('Read only')
    expect(menu.textContent).not.toContain('Move to the assets folder')

    // Toggle Link preview on hover -> OFF
    const hoverLinksBtn = [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Link preview on hover'))!
    await act(async () => hoverLinksBtn.click())
    expect(api.writeFile).toHaveBeenCalledTimes(1)
    let written = vi.mocked(api.writeFile).mock.calls[0][0].content
    let blockJson = JSON.parse(written.split('\n')[3]!)
    expect(blockJson.yaseendraw).toEqual({ hoverLinks: false })

    // Reopen cog if needed and pick Fold arrows -> Always
    const menu2 = menuIn(container) ?? (await act(async () => cog.click()), menuIn(container)!)
    const alwaysBtn = [...menu2.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Always')!
    await act(async () => alwaysBtn.click())
    expect(surface.props?.foldArrows).toBe('always')
    expect(api.writeFile).toHaveBeenCalledTimes(2)
    written = vi.mocked(api.writeFile).mock.calls[1][0].content
    blockJson = JSON.parse(written.split('\n')[3]!)
    expect(blockJson.yaseendraw).toEqual({ hoverLinks: false, foldArrows: 'always' })

    // Pick Hover outline -> Off (last "Off" button in menu belongs to Hover outline)
    const menu3 = menuIn(container) ?? (await act(async () => cog.click()), menuIn(container)!)
    const offButtons = [...menu3.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === 'Off')
    await act(async () => offButtons[offButtons.length - 1]!.click())
    expect(surface.props?.hoverOutline).toBe(false)
    expect(api.writeFile).toHaveBeenCalledTimes(3)
    written = vi.mocked(api.writeFile).mock.calls[2][0].content
    blockJson = JSON.parse(written.split('\n')[3]!)
    expect(blockJson.yaseendraw).toEqual({ hoverLinks: false, foldArrows: 'always', hoverOutline: false })
  })
})
