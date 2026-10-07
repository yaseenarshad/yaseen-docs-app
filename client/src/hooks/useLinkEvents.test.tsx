/**
 * useLinkEvents (E1, GRO-2171): the renderer's half of the yaseendocs:// deep-link pushes —
 * subscribed on mount, unsubscribed on unmount, latest callbacks win. Once subscribed it tells
 * main so (`link.ready`, YAZ-2589 A2): main holds a push for a window that cannot hear it yet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useLinkEvents } from './useLinkEvents'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function installBridge() {
  const openFileListeners = new Set<(path: string) => void>()
  const noticeListeners = new Set<(message: string) => void>()
  const bridge = {
    link: {
      onOpenFile: vi.fn((l: (path: string) => void) => {
        openFileListeners.add(l)
        return () => openFileListeners.delete(l)
      }),
      onNotice: vi.fn((l: (message: string) => void) => {
        noticeListeners.add(l)
        return () => noticeListeners.delete(l)
      }),
      ready: vi.fn(async () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return {
    emitOpenFile: (path: string) => openFileListeners.forEach((l) => l(path)),
    emitNotice: (message: string) => noticeListeners.forEach((l) => l(message)),
    count: () => openFileListeners.size + noticeListeners.size,
    bridge,
  }
}

function Probe({ onOpenFile, onNotice }: { onOpenFile: (path: string) => void; onNotice: (message: string) => void }) {
  useLinkEvents({ onOpenFile, onNotice })
  return null
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('useLinkEvents', () => {
  it('routes link events to the callbacks and unsubscribes on unmount', () => {
    const b = installBridge()
    const onOpenFile = vi.fn()
    const onNotice = vi.fn()
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe onOpenFile={onOpenFile} onNotice={onNotice} />))

    act(() => b.emitOpenFile('/vaults/notes/a.md'))
    expect(onOpenFile).toHaveBeenCalledWith('/vaults/notes/a.md')
    act(() => b.emitNotice("Can't open link"))
    expect(onNotice).toHaveBeenCalledWith("Can't open link")

    act(() => root?.unmount())
    root = null
    expect(b.count()).toBe(0)
  })

  it('says it is ready only after both listeners are on, so main can send what it held (YAZ-2589 A2)', () => {
    const b = installBridge()
    let listening = -1
    b.bridge.link.ready.mockImplementation(async () => void (listening = b.count()))
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe onOpenFile={vi.fn()} onNotice={vi.fn()} />))
    expect(b.bridge.link.ready).toHaveBeenCalledOnce()
    expect(listening).toBe(2)
  })
})
