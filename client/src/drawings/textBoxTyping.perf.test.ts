/**
 * TYPING IN A LONG TEXT BOX (YAZ-4277 scenario 14, YAZ-4312 S2–S6): the real engine and the real text box editor in
 * jsdom. A 200-line box of bullets, ten of them folded, opens for edit; then one letter at a time is typed in its
 * middle, and the caret moves one letter at a time. Two times for each key: "sync", from the editor's input to the
 * end of the engine's work for it (the editor's report, the box's new size, the caret overlay), and "all", to the end
 * of the microtasks after it too (React's render of the board, a MutationObserver). jsdom has no layout and no paint,
 * so the numbers are the code's own work.
 *
 * Time on a loaded machine measures the machine (YAZ-3696), so counts hold the hot path too, and they do not move
 * with the load: the canvas `measureText` calls (each one a measure of a piece of a line), the editor's walks of its
 * document (each walk asks the bullet glyph of each list item, `getBulletMarkerForDepth`), the carets the engine
 * draws, and the editor's looks for its pop-ups.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Crepe } from '@milkdown/crepe'
import { median } from '../test-perf'
import { posAt, type BoxHelpers } from './textBoxDoc'
import { typeText } from './textBoxTestKit'

vi.mock('../editor/createCrepe', async (load) => {
  const real = await load<typeof import('../editor/createCrepe')>()
  const list = ((globalThis as { __textBoxCrepes?: unknown[] }).__textBoxCrepes ??= [])
  return {
    ...real,
    createCrepe: (...args: Parameters<typeof real.createCrepe>) => {
      const crepe = real.createCrepe(...args)
      list.push(crepe)
      return crepe
    },
  }
})

type ReactLike = { createElement(type: unknown, props: Record<string, unknown>): unknown; act(fn: () => unknown): Promise<void> }
type Api = { updateScene(scene: Record<string, unknown>): void; getSceneElements(): readonly { id: string; originalText?: string; height: number }[] }
type Engine = BoxHelpers & { Excalidraw: unknown; restoreElements(elements: unknown[], local: null): unknown[] }

let React: ReactLike
let createRoot: (el: Element) => { render(node: unknown): void; unmount(): void }
let engine: Engine
let createTextBoxEditor: typeof import('./textBoxEditor').createTextBoxEditor
const counts = { measure: 0, glyph: 0, caret: 0, popupScan: 0 }

beforeAll(async () => {
  // a 2d context that measures each letter 8 px wide, and counts the measures
  const context = (canvas: HTMLCanvasElement): unknown =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get(own, prop) {
        if (prop in own) return own[prop]
        if (prop === 'canvas') return canvas
        if (prop === 'measureText')
          return (text: string) => {
            counts.measure++
            return { width: text.length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }
          }
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
    return context(this)
  } as unknown as HTMLCanvasElement['getContext']
  const g = globalThis as unknown as Record<string, unknown>
  g.Path2D ??= class {}
  g.FontFace ??= class {
    family = ''
    status = 'loaded'
    load = async () => this
  }
  g.IS_REACT_ACT_ENVIRONMENT = true
  // each caret the engine draws is a new span (`renderSelection`); each look for the pop-ups is one query
  const createElement = document.createElement.bind(document)
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const node = createElement(tag, options)
    if (tag === 'span') counts.caret++
    return node
  }) as typeof document.createElement
  const query = Element.prototype.querySelectorAll
  Element.prototype.querySelectorAll = function (this: Element, selector: string) {
    if (selector.includes('.milkdown-slash-menu')) counts.popupScan++
    return query.call(this, selector)
  } as typeof Element.prototype.querySelectorAll
  Object.defineProperty(document, 'fonts', { configurable: true, value: Object.assign(new Set(), { load: async () => [], check: () => true, ready: Promise.resolve() }) })
  // the engine's own React (see `drawingKeys.engine.test.ts`)
  React = (await import('../../../node_modules/react/index.js' as string)) as ReactLike
  createRoot = ((await import('../../../node_modules/react-dom/client.js' as string)) as { createRoot: typeof createRoot }).createRoot
  engine = (await import('@excalidraw/excalidraw')) as unknown as Engine
  ;({ createTextBoxEditor } = await import('./textBoxEditor'))
})

let unmount: (() => void) | null = null
let host: HTMLElement | null = null

afterEach(async () => {
  await React.act(() => unmount?.())
  host?.remove()
  host = null
  unmount = null
})

/** 50 groups of a bullet and its three children: 200 lines. Every fifth group is folded (10 folds, 30 lines hidden). */
const GROUPS = 50
const TEXT = Array.from({ length: GROUPS }, (_, g) => [`• Topic ${g} of the long box`, ...[1, 2, 3].map((c) => `    ○ point ${g}.${c} with some words`)].join('\n')).join('\n')
const FOLDED = Array.from({ length: GROUPS / 5 }, (_, i) => i * 5 * 4)
/** A bold run on each topic's words: the box has runs, as most boxes do. */
const RUNS = (() => {
  const runs: Array<{ start: number; end: number; bold: true }> = []
  let at = 0
  for (const line of TEXT.split('\n')) {
    if (line.startsWith('•')) runs.push({ start: at + 2, end: at + line.length, bold: true })
    at += line.length + 1
  }
  return runs
})()

/** Mounts the engine on the box, opens it for edit (Enter on the selected box) and waits for the editor's document. */
async function openBox(textRuns: typeof RUNS | undefined) {
  host = document.createElement('div')
  host.style.width = '1200px'
  host.style.height = '800px'
  document.body.appendChild(host)
  const root = createRoot(host)
  unmount = () => root.unmount()
  let api: Api | null = null
  const helpers: BoxHelpers = {
    normalizeTextRuns: engine.normalizeTextRuns,
    remapTextRunsForTextEdit: engine.remapTextRunsForTextEdit,
    getBulletMarkerForDepth: ((depth: number) => {
      counts.glyph++
      return engine.getBulletMarkerForDepth(depth)
    }) as BoxHelpers['getBulletMarkerForDepth'],
  }
  await React.act(() =>
    root.render(
      React.createElement(engine.Excalidraw, {
        textEditor: createTextBoxEditor(helpers),
        onExcalidrawAPI: (a: Api | null) => {
          api ??= a
        },
      }),
    ),
  )
  await React.act(() => new Promise((r) => setTimeout(r, 50)))
  if (api === null) throw new Error('the engine did not mount')
  const live: Api = api
  const raw = { id: 'box', type: 'text', x: 0, y: 0, width: 400, height: 25 * 200, text: TEXT, originalText: TEXT, fontSize: 20, fontFamily: 5, lineHeight: 1.25, textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, foldedLines: FOLDED, ...(textRuns && { textRuns }) }
  await React.act(() => live.updateScene({ elements: engine.restoreElements([raw], null), appState: { selectedElementIds: { box: true } } }))
  const container = host.querySelector<HTMLElement>('.excalidraw-container')!
  const crepes = ((globalThis as { __textBoxCrepes?: Crepe[] }).__textBoxCrepes ??= [])
  const before = crepes.length
  await React.act(() => void container.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true })))
  let view: EditorView | null = null
  await vi.waitFor(() => {
    if (crepes.length === before) throw new Error('no edit')
    view = crepes[crepes.length - 1].editor.ctx.get(editorViewCtx)
    if (view.state.doc.textContent.length < 1000) throw new Error('not ready')
  })
  await React.act(() => new Promise((r) => setTimeout(r, 0)))
  const edited = view as unknown as EditorView
  // the caret at the end of line 101's letters, in the middle of the box
  const offset = TEXT.split('\n').slice(0, 102).join('\n').length
  edited.dispatch(edited.state.tr.setSelection(TextSelection.create(edited.state.doc, posAt(edited.state.doc, offset, helpers))))
  return { api: live, view: edited }
}

const p95 = (ms: readonly number[]) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)]

/**
 * Times `keys` runs of `run`, after 10 to warm up; the counts are each key's mean. A key's time ends after its
 * microtasks (a MutationObserver's callback is one), as the browser runs them before the next key.
 */
async function timeKeys(keys: number, run: () => void) {
  for (let i = 0; i < 10; i++) run()
  await new Promise((r) => setTimeout(r, 0))
  const ms: number[] = []
  const sync: number[] = []
  for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0
  for (let i = 0; i < keys; i++) {
    const start = performance.now()
    run()
    sync.push(performance.now() - start)
    await new Promise<void>((r) => queueMicrotask(r))
    ms.push(performance.now() - start)
  }
  const each = (n: number) => n / keys
  return {
    median: median(ms),
    p95: p95(ms),
    syncMedian: median(sync),
    syncP95: p95(sync),
    measures: each(counts.measure),
    walks: each(counts.glyph),
    carets: each(counts.caret),
    popupScans: each(counts.popupScan),
  }
}

const format = (r: Awaited<ReturnType<typeof timeKeys>>) =>
  `sync median ${r.syncMedian.toFixed(2)} / p95 ${r.syncP95.toFixed(2)} ms, all median ${r.median.toFixed(2)} / p95 ${r.p95.toFixed(2)} ms, ` +
  `${r.measures.toFixed(0)} measures, ${r.walks.toFixed(0)} glyph asks, ${r.carets.toFixed(0)} carets drawn, ${r.popupScans.toFixed(0)} pop-up scans`

describe('typing in a 200-line text box with folds (YAZ-4277 scenario 14)', () => {
  for (const [name, runs] of [['no runs', undefined], ['bold runs', RUNS]] as const) {
    it(`types a key and moves the caret fast: ${name}`, async () => {
      const { api, view } = await openBox(runs)
      const typed = await timeKeys(60, () => typeText(view, 'x'))
      const moved = await timeKeys(60, () => {
        const { head } = view.state.selection
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, head - 1)))
      })
      // the engine has each letter: the box's text grew by 70 letters
      expect(api.getSceneElements()[0].originalText).toHaveLength(TEXT.length + 70)
      console.log(`text box typing, 200 lines, 10 folds, ${name}: key ${format(typed)} · caret move ${format(moved)} (jsdom)`)
      // YAZ-4312, load-free: a key walks the editor's document once (200 items ask their glyph), lays the box out once
      // (200 lines; 470 to 882 measures before), draws one caret and scans for no pop-up; a caret move walks nothing
      expect(typed.walks).toBeLessThanOrEqual(200)
      expect(typed.measures).toBeLessThan(300)
      expect(typed.carets).toBeLessThan(1.5)
      expect(typed.popupScans).toBe(0)
      expect(moved.walks).toBe(0)
      // gross budgets on the median; the counts above hold the hot path on a loaded machine
      expect(typed.median).toBeLessThan(50)
      expect(moved.median).toBeLessThan(20)
    }, 60_000)
  }
})
