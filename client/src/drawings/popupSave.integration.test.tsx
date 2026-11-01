/**
 * YAZ-3943 1A1 through the real code path: the note's popup (`DrawingModal`) on a board past the asset
 * pipe's 10 MiB cap. With pictures inside by default (D5), any board with about 7 MB of pictures is
 * past it. The popup must open it AND save it, through main's REAL doors (`readAsset`, `drawing:load`,
 * `drawing:save`) on a real temp vault; only the engine is a stand-in.
 *
 * Main's code and Node's fs are reached through non-literal dynamic imports on purpose, as in
 * `share/shareContent.integration.test.ts`: the renderer's tsconfig must not type-check main.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { DrawingLoadRequest, DrawingSaveRequest } from '@shared/types'
import type { DrawingSurfaceProps } from './ExcalidrawSurface'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

interface NodeFs {
  mkdtemp(prefix: string): Promise<string>
  writeFile(p: string, data: string): Promise<void>
  readFile(p: string, enc: 'utf8'): Promise<string>
  stat(p: string): Promise<{ size: number }>
  rm(p: string, o: { recursive: true; force: true }): Promise<void>
}
const nodeImport = <T,>(specifier: string): Promise<T> => import(/* @vite-ignore */ specifier) as Promise<T>
const MAIN_DRAWING = '../../../desktop/src/main/fs/drawing'
const MAIN_ASSETS = '../../../desktop/src/main/fs/assets'
type Main = { loadDrawing(r: DrawingLoadRequest): Promise<unknown>; saveDrawing(r: DrawingSaveRequest): Promise<unknown> }
type MainAssets = { readAsset(root: string, ref: string): Promise<unknown>; writeAsset(r: unknown): Promise<unknown> }

/** Main's failures arrive as the bridge's error class, as `api.ts` makes them. */
async function bridged<T>(fn: () => Promise<T>): Promise<T> {
  const { BridgeRequestError } = await vi.importActual<typeof import('../api')>('../api')
  try {
    return await fn()
  } catch (err) {
    const e = err as { code: string; message: string; mtime?: number; path?: string }
    throw new BridgeRequestError(e.code as never, e.message, e.mtime, e.path)
  }
}

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: {
    readAsset: (root: string, ref: string) => bridged(async () => (await nodeImport<MainAssets>(MAIN_ASSETS)).readAsset(root, ref)),
    writeAsset: (req: unknown) => bridged(async () => (await nodeImport<MainAssets>(MAIN_ASSETS)).writeAsset(req)),
    drawing: {
      load: (req: DrawingLoadRequest) => bridged(async () => (await nodeImport<Main>(MAIN_DRAWING)).loadDrawing(req)),
      save: vi.fn((req: DrawingSaveRequest) => bridged(async () => (await nodeImport<Main>(MAIN_DRAWING)).saveDrawing(req))),
    },
    window: { onFlush: () => () => undefined },
    hotkeys: { drawingInFront: async () => undefined },
  },
}))

/** The stand-in engine: it hands its props back, so the test can emit what the real canvas would. */
const seam = vi.hoisted(() => ({ props: null as DrawingSurfaceProps | null }))
vi.mock('./ExcalidrawSurface', () => ({
  ENGINE_LOAD_FAILED: "Can't open the drawing editor.",
  ExcalidrawSurface: (props: DrawingSurfaceProps) => {
    seam.props = props
    return <div className="fake-surface" />
  },
}))

import { api } from '../api'
import { DrawingModal } from './DrawingModal'

const MiB = 1024 * 1024
let fs: NodeFs
let root: string
/** 8 MiB of picture: about 10.7 MiB of base64 inside the board. */
const BIG = `data:image/png;base64,${'QUJD'.repeat((8 * MiB) / 3)}`
const image = { id: 'img', type: 'image', x: 0, y: 0, width: 100, height: 100, fileId: 'pic', status: 'saved', scale: [1, 1] }

beforeAll(async () => {
  fs = await nodeImport<NodeFs>('node:fs/promises')
  const tmp = (await nodeImport<{ tmpdir(): string }>('node:os')).tmpdir()
  root = await fs.mkdtemp(`${tmp}/popup-save-`)
  const board = { yaseendraw: { createdAt: 1600000000000, updatedAt: 1600000000001, cloudId: 'k7' }, type: 'excalidraw', version: 2, source: 'yaseen-docs', elements: [image], appState: {}, files: { pic: { mimeType: 'image/png', id: 'pic', dataURL: BIG, created: 5 } } }
  await fs.writeFile(`${root}/Big.excalidraw`, `${JSON.stringify(board, null, 2)}\n`)
})
afterAll(() => fs.rm(root, { recursive: true, force: true }))

describe('the popup saves a board over 10 MiB (YAZ-3943 1A1)', () => {
  it('opens it, saves an edit through drawing:save with no picture re-sent, and the file keeps its picture, its block and the edit', async () => {
    const file = `${root}/Big.excalidraw`
    expect((await fs.stat(file)).size).toBeGreaterThan(10 * MiB)
    // The popup's old door (the asset pipe) refuses a board this big: what it hit before the fix.
    await expect(api.writeAsset({ root, path: file, content: 'x'.repeat(10 * MiB + 1) })).rejects.toMatchObject({ code: 'TOO_LARGE' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = createRoot(container)
    const onClose = vi.fn()
    await act(async () => view.render(<DrawingModal root={root} target="Big.excalidraw" theme="light" onClose={onClose} />))
    await vi.waitFor(() => expect(seam.props).not.toBeNull())
    const files = seam.props!.scene.files as Record<string, { dataURL: string; mimeType: string }>
    expect(files.pic.dataURL).toBe(BIG)

    const rect = { id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }
    const snapshot = (version: number, elements: unknown[]) => ({
      version,
      serialize: () => ({ json: `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-docs', elements, appState: {}, files: {} }, null, 2)}\n`, files: { pic: { mimeType: 'image/png', dataURL: BIG } }, referenced: new Set(['pic']) }),
    })
    act(() => seam.props!.onSnapshot(snapshot(1, [image])))
    act(() => seam.props!.onSnapshot(snapshot(2, [image, rect])))
    // ✕ saves what is pending, then closes.
    await act(async () => container.querySelector<HTMLButtonElement>('.drawing-modal__close')!.click())
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(vi.mocked(api.drawing.save)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.drawing.save).mock.calls[0][0].newFiles).toEqual([])
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>
    expect(saved.elements.map((e: { id: string }) => e.id)).toEqual(['img', 'r'])
    expect(saved.files.pic).toMatchObject({ id: 'pic', dataURL: BIG, created: 5 })
    expect(saved.yaseendraw).toMatchObject({ createdAt: 1600000000000, cloudId: 'k7' })
    expect(saved.yaseendraw.updatedAt).toBeGreaterThan(1600000000001)
    act(() => view.unmount())
    container.remove()
  })
})
