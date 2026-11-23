/**
 * THE MERGE IN THE REAL ENGINE (YAZ-4279 4A-13). The vendored `<Excalidraw>` in jsdom, as `drawingKeys.engine.test.ts`
 * mounts it (its own React; a 2d context that does nothing): the user's edit is one undo step, an outside save merged with
 * `mergeLiveScene` and `captureUpdate: NEVER` is none, so ⌘Z takes back the user's edit alone and the file's change stays.
 * The outlines of what changed (`OutsideMarks`, stand-in collaborators) never reach the saved file, and are no undo step.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mergeLiveScene } from './mergeScene'
import { OutsideMarks } from './outsideMarks'

type El = { id: string; x: number; strokeColor: string; version: number }
type Api = {
  updateScene(scene: Record<string, unknown>): void
  getSceneElements(): readonly El[]
  getSceneElementsIncludingDeleted(): readonly El[]
  getAppState(): Record<string, unknown>
}
type ReactLike = { createElement(type: unknown, props: Record<string, unknown>): unknown; act(fn: () => unknown): Promise<void> }

let React: ReactLike
let createRoot: (el: Element) => { render(node: unknown): void; unmount(): void }
let engine: {
  Excalidraw: unknown
  CaptureUpdateAction: Record<'IMMEDIATELY' | 'NEVER' | 'EVENTUALLY', string>
  convertToExcalidrawElements(skeletons: unknown[], opts: { regenerateIds: boolean }): unknown[]
  restoreElements: (...args: never[]) => unknown
  restoreAppState: (...args: never[]) => unknown
  serializeAsJSON(elements: readonly unknown[], appState: unknown, files: unknown, type: 'local'): string
}

beforeAll(async () => {
  const blank = (canvas: HTMLCanvasElement): unknown =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get(own, prop) {
        if (prop in own) return own[prop]
        if (prop === 'canvas') return canvas
        if (prop === 'measureText') return () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 })
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
        if (prop === 'getTransform') return () => ({ a: 1, d: 1 })
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') return () => ({ addColorStop() {} })
        return () => undefined
      },
      set(own, prop, value) {
        own[prop] = value
        return true
      },
    })
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return blank(this)
  } as unknown as HTMLCanvasElement['getContext']
  const g = globalThis as unknown as Record<string, unknown>
  g.Path2D ??= class {}
  g.FontFace ??= class {
    family = ''
    status = 'loaded'
    load = async () => this
  }
  g.IS_REACT_ACT_ENVIRONMENT = true
  // The engine loads the scene's fonts through `document.fonts`, which jsdom lacks.
  Object.defineProperty(document, 'fonts', { configurable: true, value: Object.assign(new Set(), { load: async () => [], check: () => true, ready: Promise.resolve() }) })
  React = (await import('../../../node_modules/react/index.js' as string)) as ReactLike
  createRoot = ((await import('../../../node_modules/react-dom/client.js' as string)) as { createRoot: typeof createRoot }).createRoot
  engine = (await import('@excalidraw/excalidraw')) as unknown as typeof engine
})

let host: HTMLElement | null = null
let unmount: (() => void) | null = null

afterEach(async () => {
  await React.act(() => unmount?.())
  host?.remove()
  host = null
  unmount = null
})

/** The engine on one box, saved: the box as the file holds it is the merge's base. */
async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  unmount = () => root.unmount()
  let api: Api | null = null
  await React.act(() => root.render(React.createElement(engine.Excalidraw, { onExcalidrawAPI: (a: Api | null) => void (api ??= a) })))
  await React.act(() => new Promise((r) => setTimeout(r, 50)))
  if (api === null) throw new Error('the engine did not mount')
  const live: Api = api
  const box = engine.convertToExcalidrawElements([{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 80, height: 60, strokeColor: '#1e1e1e' }], { regenerateIds: false })
  await React.act(() => live.updateScene({ elements: box, captureUpdate: engine.CaptureUpdateAction.NEVER }))
  const container = host.querySelector<HTMLElement>('.excalidraw-container')
  if (container === null) throw new Error('no container')
  const file = JSON.parse(engine.serializeAsJSON(live.getSceneElementsIncludingDeleted(), live.getAppState(), {}, 'local')) as { elements: El[]; appState: Record<string, unknown> }
  const the = () => live.getSceneElements()[0]
  return { api: live, file, the }
}

describe('the merge in the real engine (YAZ-4279)', () => {
  it('the user\'s move and the file\'s colour, both on the engine\'s canvas, above the canvas version', async () => {
    const { api, file, the } = await mount()
    // The user moves the box: one undo step.
    await React.act(() => api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => ({ ...e, x: 300, version: e.version + 1 })), captureUpdate: engine.CaptureUpdateAction.IMMEDIATELY }))
    // An AI recolours it in the file (no version bump), and the tab merges with unsaved edits.
    const disk = { elements: file.elements.map((e) => ({ ...e, strokeColor: '#e03131' })), appState: file.appState }
    const merged = mergeLiveScene(engine as never, file, disk, { elements: api.getSceneElementsIncludingDeleted(), appState: api.getAppState() }, [])
    if ('conflicts' in merged) throw new Error('expected a merge')
    await React.act(() => api.updateScene({ elements: merged.elements, captureUpdate: engine.CaptureUpdateAction.NEVER }))
    expect(the()).toMatchObject({ x: 300, strokeColor: '#e03131' })
    expect(the().version).toBeGreaterThan(file.elements[0].version + 1)
  })

  it('the outlines are stand-in collaborators: in the engine\'s appState, never in the saved file', async () => {
    const { api, the } = await mount()
    const marks = new OutsideMarks((collaborators) => api.updateScene({ collaborators, captureUpdate: engine.CaptureUpdateAction.NEVER }))
    await React.act(() => marks.mark([], ['box'], api.getSceneElements(), 'until-checked'))
    expect((api.getAppState().collaborators as Map<string, unknown>).size).toBe(1)
    const saved = engine.serializeAsJSON(api.getSceneElementsIncludingDeleted(), api.getAppState(), {}, 'local')
    expect(saved).not.toContain('outside-changed')
    expect(saved).not.toContain('collaborators')
    expect(JSON.parse(saved).elements).toEqual([expect.objectContaining({ id: the().id, version: the().version })])
    marks.dispose()
  })
})
