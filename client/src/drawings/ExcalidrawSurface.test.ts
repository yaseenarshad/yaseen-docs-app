import { describe, expect, it, vi } from 'vitest'
import { readOnlyHandle } from './ExcalidrawSurface'

/**
 * The canvas panel's handle on a read-only drawing (YAZ-3076 D2, S26): the panel can still look
 * and present, but its inserts, its slide reorder and its slide rename change nothing.
 */
describe('readOnlyHandle', () => {
  const engineApi = () => ({ insertElements: vi.fn(), addFiles: vi.fn(), updateScene: vi.fn(), getSceneElements: vi.fn(() => []), setViewport: vi.fn() })

  it('shuts every door that changes the scene, and leaves the views open', () => {
    const raw = engineApi()
    const api = readOnlyHandle(raw as never) as unknown as ReturnType<typeof engineApi>
    api.insertElements([] as never)
    api.addFiles([] as never)
    api.updateScene({ elements: [] } as never)
    expect(raw.insertElements).not.toHaveBeenCalled()
    expect(raw.addFiles).not.toHaveBeenCalled()
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
