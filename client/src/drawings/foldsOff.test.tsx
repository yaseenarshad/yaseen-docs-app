/**
 * YAZ-4401 2E (D18): folding off, at the host. The surface keeps each folded box's folds aside (`foldsAside`), so the
 * engine shows every line, and writes them back on a save (`foldsBack`): the file keeps its `foldedLines`. A switch at
 * runtime opens the folds and keeps them; switched on again, they come back. A reload from disk (`replaceScene`) with
 * folding off keeps the new scene's folds aside too.
 *
 * The engine's own `restoreElements` and `serializeAsJSON` run here (its restore guard is what drops the `[-1]` fold the
 * host gives a box); only `<Excalidraw>` is a stand-in that records its props.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_CANVAS_PREFS, type CanvasPrefs, type FoldArrowMode } from '@shared/types'

const engine = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('./engine', async () => {
  const real = await import('@excalidraw/excalidraw')
  const Excalidraw = (props: Record<string, unknown>) => {
    engine.props.push(props)
    return null
  }
  const mod = { ...real, Excalidraw, Fonts: { loadElementsFonts: async () => [] } }
  const textEditor = { mount: () => ({ setSelection: () => undefined, focus: () => undefined, destroy: () => undefined }) }
  return {
    loadExcalidraw: async () => mod,
    loadTextBoxEditor: async () => ({ createTextBoxEditor: () => textEditor }),
    applyToolbarMode: () => undefined,
  }
})
vi.mock('katex/dist/katex.min.css', () => ({}))

import { ExcalidrawSurface, type DrawingSnapshot, type DrawingSurfaceApi } from './ExcalidrawSurface'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no 2D canvas; the engine's restore measures text with one (`drawingKeys.engine.test.ts` does the same).
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return { canvas: this, font: '', measureText: (text: string) => ({ width: text.length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) }
  } as unknown as HTMLCanvasElement['getContext'])
})
afterAll(() => vi.restoreAllMocks())

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  engine.props = []
})

const last = (): Record<string, unknown> => engine.props.at(-1) ?? {}

/** A box whose first bullet has a child: line 0 can fold. */
const OUTLINE = '• Phase one\n    ○ child\n• Two'
const box = (id: string, foldedLines?: number[]) => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  version: 3,
  versionNonce: 1,
  text: OUTLINE,
  originalText: OUTLINE,
  fontSize: 20,
  fontFamily: 5,
  lineHeight: 1.25,
  textAlign: 'left',
  verticalAlign: 'top',
  containerId: null,
  autoResize: true,
  ...(foldedLines !== undefined && { foldedLines }),
})
const rect = { id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 2, versionNonce: 1 }
const SCENE = { elements: [box('t', [0]), box('open'), rect], appState: {}, files: {} }

type El = { id: string; type: string; foldedLines?: readonly number[]; isDeleted?: boolean }
const foldsIn = (json: string) => Object.fromEntries((JSON.parse(json) as { elements: El[] }).elements.map((e) => [e.id, e.foldedLines]))

async function mount(opts: { prefs?: Partial<CanvasPrefs>; board?: FoldArrowMode; scene?: typeof SCENE } = {}) {
  const snapshots: DrawingSnapshot[] = []
  let handle: DrawingSurfaceApi | null = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = async (prefs: Partial<CanvasPrefs> = opts.prefs ?? {}, board: FoldArrowMode | undefined = opts.board) =>
    act(async () => {
      root?.render(
        <ExcalidrawSurface
          scene={opts.scene ?? SCENE}
          theme="light"
          canvasPrefs={{ ...DEFAULT_CANVAS_PREFS, ...prefs }}
          foldArrows={board}
          onSnapshot={(s) => void snapshots.push(s)}
          onFailed={() => undefined}
          onApi={(a) => (handle = a)}
        />,
      )
    })
  await render()
  return { snapshots, render, handle: () => handle! }
}

/** The engine's raw handle as the surface uses it: the scene it shows, and the fold writer. */
function rawApi(elements: El[]) {
  const scene = { elements }
  const api = {
    getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
    getSceneElements: () => scene.elements,
    getFiles: () => ({}),
    updateFrameRendering: () => undefined,
    updateScene: vi.fn((next: { elements?: El[] }) => {
      if (next.elements) scene.elements = next.elements
    }),
    addFiles: vi.fn(),
    pruneFiles: vi.fn(),
    refresh: () => undefined,
    setTextFolds: vi.fn((id: string, lines: readonly number[]) => {
      scene.elements = scene.elements.map((e) => (e.id === id ? { ...e, foldedLines: lines.length ? lines : undefined } : e))
    }),
  }
  act(() => (last().onExcalidrawAPI as (a: unknown) => void)(api))
  return { api, scene }
}

/** What the engine reports after a change: its own scene through the surface's `onChange`. */
const report = (elements: readonly unknown[]) => act(() => (last().onChange as (e: unknown, a: unknown, f: unknown) => void)(elements, {}, {}))

describe('YAZ-4401 2E: a board opened with folding off', () => {
  for (const [how, opts] of [
    ['the app setting', { prefs: { foldArrowsOpen: 'off' as const } }],
    ["the board's own mode", { board: 'off' as const }],
  ] as const) {
    it(`(${how}) mounts every line: no fold reaches the engine, and the restore guard drops the host's [-1]`, async () => {
      await mount(opts)
      const mounted = (last().initialData as { elements: El[] }).elements
      expect(mounted.map((e) => [e.id, e.foldedLines])).toEqual([['t', [-1]], ['open', undefined], ['r', undefined]])
      const { restoreElements } = await import('@excalidraw/excalidraw')
      expect((restoreElements(mounted as never, null) as unknown as El[]).map((e) => e.foldedLines)).toEqual([undefined, undefined, undefined])
      // the engine is told the mode, so its arrows, keys and clicks stay off
      expect((last().foldArrows as { openArrows: string }).openArrows).toBe('off')
    })
  }

  it('the save writes the file\'s `foldedLines` back, byte for byte: the open-time baseline and a later engine change both carry [0]', async () => {
    const { snapshots } = await mount({ prefs: { foldArrowsOpen: 'off' } })
    expect(snapshots).toHaveLength(1)
    expect(foldsIn(snapshots[0].serialize().json)).toEqual({ t: [0], open: undefined, r: undefined })
    // the engine settles on its restored (all lines open) scene
    const { restoreElements } = await import('@excalidraw/excalidraw')
    const shown = restoreElements((last().initialData as { elements: never[] }).elements, null)
    report(shown)
    expect(foldsIn(snapshots.at(-1)!.serialize().json)).toEqual({ t: [0], open: undefined, r: undefined })
    expect(JSON.stringify(foldsIn(snapshots.at(-1)!.serialize().json).t)).toBe(JSON.stringify((SCENE.elements[0] as El).foldedLines))
  })

  it('opening writes nothing: the open-time baseline is the scene the engine mounts, so its first report has the same version and content', async () => {
    const { snapshots } = await mount({ prefs: { foldArrowsOpen: 'off' } })
    const { restoreElements } = await import('@excalidraw/excalidraw')
    report(restoreElements((last().initialData as { elements: never[] }).elements, null))
    expect(snapshots.map((s) => s.version)).toEqual([snapshots[0].version, snapshots[0].version])
    // the baseline is the scene the engine mounts (all lines measured), not the folded file: the same content, but for
    // the engine's own stamps, which `contentVersion` does not count either
    const content = (json: string) => (JSON.parse(json) as { elements: Record<string, unknown>[] }).elements.map(({ version: _v, versionNonce: _n, updated: _u, ...rest }) => rest)
    expect(content(snapshots[1].serialize().json)).toEqual(content(snapshots[0].serialize().json))
  })

  it('with folding on, the same board mounts its folds and nothing is kept aside', async () => {
    const { snapshots } = await mount()
    expect((last().initialData as { elements: El[] }).elements[0].foldedLines).toEqual([0])
    // a box the engine opened (an unfold) is saved open: no folds come back from anywhere
    report([{ ...box('t'), version: 4 }, box('open'), rect])
    expect(foldsIn(snapshots.at(-1)!.serialize().json).t).toBeUndefined()
  })
})

describe('YAZ-4401 2E: folding switched at runtime', () => {
  it('off opens each folded box (no undo step: the engine\'s fold writer) and keeps its folds for the save; on puts them back', async () => {
    const { snapshots, render } = await mount()
    const { api, scene } = rawApi([box('t', [0]), box('open'), { ...box('gone', [0]), isDeleted: true }, rect])
    await render({ foldArrowsOpen: 'off' })
    // only the live folded box is opened
    expect(api.setTextFolds.mock.calls).toEqual([['t', []]])
    report(scene.elements)
    expect(foldsIn(snapshots.at(-1)!.serialize().json)).toMatchObject({ t: [0], open: undefined, r: undefined })

    await render({ foldArrowsOpen: 'hover' })
    expect(api.setTextFolds.mock.calls).toEqual([['t', []], ['t', [0]]])
    expect(scene.elements[0].foldedLines).toEqual([0])
    // the aside map is empty again: an unfold after this is saved open
    api.setTextFolds('t', [])
    report(scene.elements)
    expect(foldsIn(snapshots.at(-1)!.serialize().json).t).toBeUndefined()
  })

  it("the board's own Off does the same while the app says hover, and the board's App gives the folds back", async () => {
    const { render } = await mount()
    const { api } = rawApi([box('t', [0])])
    await render({}, 'off')
    expect(api.setTextFolds.mock.calls).toEqual([['t', []]])
    await render({}, undefined)
    expect(api.setTextFolds.mock.calls).toEqual([['t', []], ['t', [0]]])
  })

  it('a prefs change that keeps folding off touches no fold', async () => {
    const { render } = await mount({ prefs: { foldArrowsOpen: 'off' } })
    const { api } = rawApi([box('t'), rect])
    await render({ foldArrowsOpen: 'off', foldArrowSize: 150 })
    await render({ foldArrowsOpen: 'off', gridModeEnabled: true })
    expect(api.setTextFolds).not.toHaveBeenCalled()
  })

  it('a board opened with folding off gets its file folds back when folding goes on', async () => {
    const { render } = await mount({ prefs: { foldArrowsOpen: 'off' } })
    const { api } = rawApi([box('t'), box('open'), rect])
    await render({ foldArrowsOpen: 'always' })
    expect(api.setTextFolds.mock.calls).toEqual([['t', [0]]])
  })
})

describe('YAZ-4401 2E: a reload from disk (replaceScene) with folding off', () => {
  it("hands the engine the new scene with every line open and saves the new scene's folds; the old scene's folds are gone", async () => {
    const { snapshots, handle } = await mount({ prefs: { foldArrowsOpen: 'off' } })
    const { api } = rawApi([box('t'), box('open'), rect])
    // on disk now: `t` is open and `open` is folded
    handle().replaceScene({ elements: [box('t'), box('open', [0]), rect], appState: {}, files: {} })
    const handed = (api.updateScene.mock.calls[0][0] as { elements: El[] }).elements
    expect(handed.map((e) => e.foldedLines)).toEqual([undefined, undefined, undefined])
    report(handed)
    expect(foldsIn(snapshots.at(-1)!.serialize().json)).toEqual({ t: undefined, open: [0], r: undefined })
  })

  it('with folding on, the new scene keeps its folds in the engine', async () => {
    const { handle } = await mount()
    const { api } = rawApi([box('t'), rect])
    handle().replaceScene({ elements: [box('t', [0]), rect], appState: {}, files: {} })
    expect((api.updateScene.mock.calls[0][0] as { elements: El[] }).elements[0].foldedLines).toEqual([0])
  })
})
