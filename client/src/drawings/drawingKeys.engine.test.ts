/**
 * THE REMAP IN THE REAL ENGINE (YAZ-3564 K5, K12). The vendored `<Excalidraw>` is mounted in jsdom with the
 * `keyBindings` the app builds from `settings.hotkeys` (`drawingKeys.ts`), and real key events go to its
 * container: a moved key runs its action, the old key does nothing, a text field is never remapped, and key
 * down / up stay paired. The toolbar's tooltip names the new key.
 *
 * ⚡ THE ENGINE'S OWN REACT. Resolved from the app's `node_modules` (the workspace link, YAZ-3574), the engine and
 * its React dependencies find the repo root's React 18, while `client/` has React 19; the build dedupes the two
 * (`desktop/electron.vite.config.ts`), vitest does not. So this file renders with the root's React and
 * react-dom: one React, the one the engine's dependencies hold. jsdom has no canvas: a 2d context that does
 * nothing is enough, since nothing here looks at pixels.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { drawingKeyBindings } from './drawingKeys'

type Api = {
  updateScene(scene: Record<string, unknown>): void
  getSceneElements(): readonly { id: string; backgroundColor: string; strokeColor: string }[]
  getAppState(): { activeTool: { type: string }; isBindingEnabled: boolean; selectedElementIds: Record<string, true> }
}
type ReactLike = { createElement(type: unknown, props: Record<string, unknown>): unknown; act(fn: () => unknown): Promise<void> }

let React: ReactLike
let createRoot: (el: Element) => { render(node: unknown): void; unmount(): void }
let engine: { Excalidraw: unknown; convertToExcalidrawElements(skeletons: unknown[], opts: { regenerateIds: boolean }): unknown[] }

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

/** Mounts the engine on one rectangle, with the bindings `hotkeys` make; `rerender` hands it new ones, live. */
async function mount(hotkeys: HotkeyOverrides = {}, aside?: Record<string, boolean>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  unmount = () => root.unmount()
  let api: Api | null = null
  const render = (keys: HotkeyOverrides) =>
    React.act(() =>
      root.render(
        React.createElement(engine.Excalidraw, {
          keyBindings: drawingKeyBindings(keys, aside),
          onExcalidrawAPI: (a: Api | null) => {
            api ??= a
          },
        }),
      ),
    )
  await render(hotkeys)
  await React.act(() => new Promise((r) => setTimeout(r, 50)))
  if (api === null) throw new Error('the engine did not mount')
  const live: Api = api
  await React.act(() => live.updateScene({ elements: engine.convertToExcalidrawElements([{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 80, height: 60 }], { regenerateIds: false }) }))
  const container = host.querySelector<HTMLElement>('.excalidraw-container')
  if (container === null) throw new Error('no container')
  /** A keydown on the canvas (or on `target`), as the browser sends it; ⌘ is `metaKey` (the test setup is a Mac). */
  const down = (code: string, key: string, mods: KeyboardEventInit = {}, target: Element = container) =>
    React.act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, ...mods })))
  const up = (code: string, key: string, mods: KeyboardEventInit = {}) => React.act(() => void document.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true, ...mods })))
  const select = (on: boolean) => React.act(() => live.updateScene({ appState: { selectedElementIds: on ? { box: true } : {} } }))
  return { api: live, container, down, up, select, rerender: render }
}

describe('a key an App command takes, in the real engine (K3, K9)', () => {
  it("with Show in sidebar's switch off, ⌘D duplicates nothing and stays unhandled, so the menu runs it", async () => {
    const { api, container, select } = await mount({}, { 'app.goTo': false })
    await select(true)
    let handled = false
    await React.act(() => void (handled = !container.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', metaKey: true, bubbles: true, cancelable: true }))))
    expect([api.getSceneElements().length, handled]).toEqual([1, false])
  })
})

describe('a moved drawing key in the real engine (K5)', () => {
  it('runs its action on the new key, live, and the old key does nothing', async () => {
    const { api, down, select, rerender } = await mount()
    await select(true)
    await down('KeyD', 'd', { metaKey: true })
    expect(api.getSceneElements()).toHaveLength(2) // ⌘D duplicates, as shipped
    await rerender({ 'drawing.duplicate': 'CmdOrCtrl+Alt+D' })
    await down('KeyD', 'd', { metaKey: true })
    expect(api.getSceneElements()).toHaveLength(2) // the old key: nothing
    await down('KeyD', '∂', { metaKey: true, altKey: true }) // ⌥ changes `key` on a Mac, never `code`
    expect(api.getSceneElements()).toHaveLength(3)
  })

  it('moves a tool letter and keeps the colour letter it shared: R stays red on a selection', async () => {
    const { api, down, select } = await mount({ 'drawing.rectangle': 'M' })
    await select(false)
    await down('KeyR', 'r')
    expect(api.getAppState().activeTool.type).toBe('selection')
    await down('KeyM', 'm')
    expect(api.getAppState().activeTool.type).toBe('rectangle')
    await down('KeyV', 'v')
    await select(true)
    const before = api.getSceneElements()[0]
    await down('KeyR', 'r')
    const after = api.getSceneElements()[0]
    expect([after.backgroundColor, after.strokeColor]).not.toEqual([before.backgroundColor, before.strokeColor])
  })

  it('never remaps a key typed into a text field', async () => {
    const { api, container, down, select } = await mount({ 'drawing.duplicate': 'CmdOrCtrl+Alt+D', 'drawing.rectangle': 'M' })
    const field = document.createElement('input')
    container.appendChild(field)
    field.focus()
    await select(true)
    await down('KeyD', '∂', { metaKey: true, altKey: true }, field)
    await down('KeyM', 'm', {}, field)
    expect(api.getSceneElements()).toHaveLength(1)
    expect(api.getAppState().activeTool.type).toBe('selection')
  })

  it('keeps key down and up paired: a ⌘ hold around a moved ⌘ key ends as it began', async () => {
    const { api, down, up, select } = await mount({ 'drawing.duplicate': 'CmdOrCtrl+Alt+D' })
    await select(true)
    expect(api.getAppState().isBindingEnabled).toBe(true)
    await down('MetaLeft', 'Meta', { metaKey: true })
    expect(api.getAppState().isBindingEnabled).toBe(false) // ⌘ held: arrows do not bind
    await down('AltLeft', 'Alt', { metaKey: true, altKey: true })
    await down('KeyD', '∂', { metaKey: true, altKey: true })
    expect(api.getSceneElements()).toHaveLength(2)
    await up('KeyD', '∂', { metaKey: true, altKey: true })
    await up('AltLeft', 'Alt', { metaKey: true })
    expect(api.getAppState().isBindingEnabled).toBe(false) // still held
    await up('MetaLeft', 'Meta')
    expect(api.getAppState().isBindingEnabled).toBe(true)
  })

  it('names the new key in the toolbar tooltip (K12)', async () => {
    const { container } = await mount({ 'drawing.rectangle': 'M', 'drawing.ellipse': null })
    const title = (tool: string) => container.querySelector(`[data-testid="toolbar-${tool}"]`)?.closest('[title]')?.getAttribute('title') ?? container.querySelector(`[data-testid="toolbar-${tool}"]`)?.getAttribute('title')
    expect(title('rectangle')).toMatch(/— M$/)
    expect(title('ellipse')).not.toMatch(/—/) // no key, no hint
    expect(title('arrow')).toMatch(/— A$/)
  })

  it('names the new key in an action button tooltip too (K12): the zoom buttons', async () => {
    const { container } = await mount({ 'drawing.zoomIn': 'CmdOrCtrl+Alt+I' })
    const title = (button: string) => container.querySelector(`.${button}`)?.getAttribute('title')
    expect(title('zoom-in-button')).toBe('Zoom in — Cmd+Option+I')
    expect(title('zoom-out-button')).toBe('Zoom out — Cmd+-') // not moved: the engine's own
  })
})
