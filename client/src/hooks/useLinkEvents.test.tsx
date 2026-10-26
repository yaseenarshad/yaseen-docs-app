/**
 * useLinkEvents (E1, GRO-2171): the renderer's half of the yaseendocs:// deep-link pushes —
 * subscribed on mount, unsubscribed on unmount, latest callbacks win. Once subscribed it tells
 * main so (`link.ready`, YAZ-2589 A2): main holds a push for a window that cannot hear it yet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MovedTab, TabRef } from '@shared/types'
import { useLinkEvents } from './useLinkEvents'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function installBridge() {
  const openFileListeners = new Set<(path: string) => void>()
  const noticeListeners = new Set<(message: string) => void>()
  const takeTabListeners = new Set<(tab: MovedTab) => void>()
  /** The tab board's three (YAZ-3343): counted together, emitted through their own spies' listeners. */
  const boardListeners = new Set<(v: never) => void>()
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
      onTakeTab: vi.fn((l: (tab: MovedTab) => void) => {
        takeTabListeners.add(l)
        return () => takeTabListeners.delete(l)
      }),
      onFocusTab: vi.fn((l: (ref: TabRef) => void) => {
        boardListeners.add(l as (v: never) => void)
        return () => boardListeners.delete(l as (v: never) => void)
      }),
      onCloseTabs: vi.fn((l: (refs: TabRef[]) => void) => {
        boardListeners.add(l as (v: never) => void)
        return () => boardListeners.delete(l as (v: never) => void)
      }),
      onSendTab: vi.fn((l: (req: { to: string; ref: TabRef }) => void) => {
        boardListeners.add(l as (v: never) => void)
        return () => boardListeners.delete(l as (v: never) => void)
      }),
      ready: vi.fn(async () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return {
    emitOpenFile: (path: string) => openFileListeners.forEach((l) => l(path)),
    emitNotice: (message: string) => noticeListeners.forEach((l) => l(message)),
    emitTakeTab: (tab: MovedTab) => takeTabListeners.forEach((l) => l(tab)),
    count: () => openFileListeners.size + noticeListeners.size + takeTabListeners.size + boardListeners.size,
    bridge,
  }
}

function Probe({ onOpenFile, onNotice, onTakeTab = vi.fn() }: { onOpenFile: (path: string) => void; onNotice: (message: string) => void; onTakeTab?: (tab: MovedTab) => void }) {
  useLinkEvents({ onOpenFile, onNotice, onTakeTab })
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
    const onTakeTab = vi.fn()
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe onOpenFile={onOpenFile} onNotice={onNotice} onTakeTab={onTakeTab} />))

    act(() => b.emitOpenFile('/vaults/notes/a.md'))
    expect(onOpenFile).toHaveBeenCalledWith('/vaults/notes/a.md')
    act(() => b.emitNotice("Can't open link"))
    expect(onNotice).toHaveBeenCalledWith("Can't open link")
    // A tab another window moved here (YAZ-3091 D1).
    act(() => b.emitTakeTab({ path: '/vaults/notes/b.md', name: 'Outline' }))
    expect(onTakeTab).toHaveBeenCalledWith({ path: '/vaults/notes/b.md', name: 'Outline' })

    act(() => root?.unmount())
    root = null
    expect(b.count()).toBe(0)
  })

  it('says it is ready only after its three listeners are on, so main can send what it held (YAZ-2589 A2)', () => {
    const b = installBridge()
    let listening = -1
    b.bridge.link.ready.mockImplementation(async () => void (listening = b.count()))
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe onOpenFile={vi.fn()} onNotice={vi.fn()} />))
    expect(b.bridge.link.ready).toHaveBeenCalledOnce()
    expect(listening).toBe(3)
  })

  it('the tab board\'s three pushes (YAZ-3343 D3, D13) are on BEFORE ready when given, reach their callbacks, and go on unmount; left out, they are not subscribed', () => {
    const b = installBridge()
    let listening = -1
    b.bridge.link.ready.mockImplementation(async () => void (listening = b.count()))
    const onFocusTab = vi.fn()
    const onCloseTabs = vi.fn()
    const onSendTab = vi.fn()
    function Board() {
      useLinkEvents({ onOpenFile: vi.fn(), onNotice: vi.fn(), onTakeTab: vi.fn(), onFocusTab, onCloseTabs, onSendTab })
      return null
    }
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Board />))
    expect(listening).toBe(6)
    const ref = { path: '/v/a.md', copy: 1 }
    act(() => b.bridge.link.onFocusTab.mock.calls[0][0](ref))
    act(() => b.bridge.link.onCloseTabs.mock.calls[0][0]([ref]))
    act(() => b.bridge.link.onSendTab.mock.calls[0][0]({ to: 'w2', ref }))
    expect(onFocusTab).toHaveBeenCalledWith(ref)
    expect(onCloseTabs).toHaveBeenCalledWith([ref])
    expect(onSendTab).toHaveBeenCalledWith({ to: 'w2', ref })
    act(() => root?.unmount())
    root = null
    expect(b.count()).toBe(0)
    // Without them (the Probe above), only the three link listeners go on.
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe onOpenFile={vi.fn()} onNotice={vi.fn()} />))
    expect(b.count()).toBe(3)
  })
})
