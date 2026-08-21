/**
 * useMenuEvents (GRO-2161): the renderer's half of the File › Open Folder… / Open Recent
 * menu gestures — subscribed on mount, unsubscribed on unmount, latest callbacks win.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMenuEvents } from './useMenuEvents'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function installBridge() {
  const openFolderListeners = new Set<() => void>()
  const openRootListeners = new Set<(path: string) => void>()
  const bridge = {
    menu: {
      onOpenFolder: vi.fn((l: () => void) => {
        openFolderListeners.add(l)
        return () => openFolderListeners.delete(l)
      }),
      onOpenRoot: vi.fn((l: (path: string) => void) => {
        openRootListeners.add(l)
        return () => openRootListeners.delete(l)
      }),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return {
    emitOpenFolder: () => openFolderListeners.forEach((l) => l()),
    emitOpenRoot: (path: string) => openRootListeners.forEach((l) => l(path)),
    count: () => openFolderListeners.size + openRootListeners.size,
  }
}

function Probe({ onOpenFolder, onOpenRoot }: { onOpenFolder: () => void; onOpenRoot: (path: string) => void }) {
  useMenuEvents({ onOpenFolder, onOpenRoot })
  return null
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('useMenuEvents', () => {
  it('routes menu gestures to the callbacks and unsubscribes on unmount', () => {
    const b = installBridge()
    const onOpenFolder = vi.fn()
    const onOpenRoot = vi.fn()
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe onOpenFolder={onOpenFolder} onOpenRoot={onOpenRoot} />))

    act(() => b.emitOpenFolder())
    expect(onOpenFolder).toHaveBeenCalledTimes(1)
    act(() => b.emitOpenRoot('/vaults/notes'))
    expect(onOpenRoot).toHaveBeenCalledWith('/vaults/notes')

    act(() => root?.unmount())
    root = null
    expect(b.count()).toBe(0)
  })
})
