/**
 * What the surface hands the ENGINE (YAZ-3076 D2, YAZ-3120): the engine is a stand-in that records
 * its props, so the real surface runs and its view-mode rule is pinned as behaviour, not as source.
 * A read-only file forces the engine's own view mode (`viewModeEnabled: true`); an editable one
 * passes NO `viewModeEnabled` at all, because a defined prop turns off the engine's own ⌥R toggle
 * (`actionToggleViewMode.predicate` is `typeof appProps.viewModeEnabled === "undefined"`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const engine = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('./engine', () => {
  const Excalidraw = (props: Record<string, unknown>) => {
    engine.props.push(props)
    return null
  }
  const mod = {
    Excalidraw,
    restoreElements: (elements: unknown) => elements,
    restoreAppState: () => ({}),
    getSceneVersion: () => 0,
    serializeAsJSON: () => JSON.stringify({ appState: {} }),
  }
  return { loadExcalidraw: async () => mod, applyToolbarMode: () => undefined }
})
vi.mock('katex/dist/katex.min.css', () => ({}))

import { ExcalidrawSurface, readOnlyHandle } from './ExcalidrawSurface'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  engine.props = []
})

const SCENE = { elements: [], appState: {}, files: {} }

async function render(readOnly: boolean | undefined): Promise<void> {
  container ??= document.createElement('div')
  document.body.appendChild(container)
  root ??= createRoot(container)
  await act(async () => {
    root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} readOnly={readOnly} />)
  })
}

const last = (): Record<string, unknown> => engine.props.at(-1) ?? {}

describe('the engine’s view mode (YAZ-3076 D2, YAZ-3120)', () => {
  it('an editable drawing passes NO viewModeEnabled, so the engine’s own ⌥R still toggles its view mode', async () => {
    await render(false)
    expect(engine.props.length).toBeGreaterThan(0)
    expect(last().viewModeEnabled).toBeUndefined()
    await render(undefined)
    expect(last().viewModeEnabled).toBeUndefined()
  })

  it('a read-only drawing forces it on, and "Allow edits" hands it back to the engine', async () => {
    await render(true)
    expect(last().viewModeEnabled).toBe(true)
    await render(false)
    expect(last().viewModeEnabled).toBeUndefined()
  })
})

/**
 * The canvas panel's handle on a read-only drawing (YAZ-3076 D2, S26): the panel can still look
 * and present, but its inserts, its slide reorder and its slide rename change nothing.
 */
describe('readOnlyHandle', () => {
  const engineApi = () => ({ insertElements: vi.fn(), addFiles: vi.fn(), pruneFiles: vi.fn(), updateScene: vi.fn(), getSceneElements: vi.fn(() => []), setViewport: vi.fn() })

  it('shuts every door that changes the scene, and leaves the views open', () => {
    const raw = engineApi()
    const api = readOnlyHandle(raw as never) as unknown as ReturnType<typeof engineApi>
    api.insertElements([] as never)
    api.addFiles([] as never)
    api.pruneFiles()
    api.updateScene({ elements: [] } as never)
    expect(raw.insertElements).not.toHaveBeenCalled()
    expect(raw.addFiles).not.toHaveBeenCalled()
    expect(raw.pruneFiles).not.toHaveBeenCalled()
    expect(raw.updateScene).not.toHaveBeenCalled()
    // A view, a tool or a dialog is not an edit of the file's elements.
    api.updateScene({ appState: { openDialog: { name: 'imageExport' } } } as never)
    expect(raw.updateScene).toHaveBeenCalledExactlyOnceWith({ appState: { openDialog: { name: 'imageExport' } } })
    api.getSceneElements()
    api.setViewport({} as never)
    expect(raw.getSceneElements).toHaveBeenCalled()
    expect(raw.setViewport).toHaveBeenCalled()
  })
})
