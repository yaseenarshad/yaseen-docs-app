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
  openImageExport: vi.fn(),
  exportScene: vi.fn(async () => '{"type":"excalidraw","elements":[],"files":{}}\n'),
}

vi.mock('./ExcalidrawSurface', async (importOriginal) => ({
  ENGINE_LOAD_FAILED: ((await importOriginal()) as { ENGINE_LOAD_FAILED: string }).ENGINE_LOAD_FAILED,
  ExcalidrawSurface: (props: DrawingSurfaceProps) => {
    props.onApi?.({
      refresh: () => undefined,
      focus: () => undefined,
      openAddSearch: () => undefined,
      openImageExport: surface.openImageExport,
      setCanvasBackground: () => undefined,
      exportScene: surface.exportScene,
      pictures: () => ({ bytes: 0, count: 0, missing: 0 }),
      replaceScene: () => 0,
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
  surface.openImageExport.mockReset()
  surface.exportScene.mockReset()
  surface.exportScene.mockResolvedValue('{"type":"excalidraw","elements":[],"files":{}}\n')
  vi.mocked(api.readFile).mockReset()
  vi.mocked(api.readFile).mockResolvedValue({ path: '/v/Notes.md', content: SAMPLE_MD, mtime: 100, size: SAMPLE_MD.length })
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
})
