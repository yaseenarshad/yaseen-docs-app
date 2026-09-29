/**
 * The preload's hand-written specials (YAZ-2200): Paste as's claim and fallback, watch's
 * multiplexing, and the close/quit flush handshake. Every table-built door is pinned by
 * surface.test.ts, and contract.test.ts pins that each channel is wired once.
 */
import { describe, expect, it, vi } from 'vitest'
import type { WatchEvent } from '@shared/types'
import { SPECIAL } from '@shared/ipc'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))

describe('preload bridge specials', () => {
  it('paste is claimed by the focused subscriber; removed or unhandled listeners use one native fallback', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const emit = vi.mocked(ipcRenderer.on).mock.calls.find(([channel]) => channel === SPECIAL.menuPasteAs)?.[1] as unknown as (event: unknown, request: { mode: 'plain' | 'markdown'; text: string }) => void
    const request = { mode: 'plain' as const, text: '# exact\n\ntext' }
    const unfocused = vi.fn(() => false)
    const focused = vi.fn(() => true)
    const later = vi.fn(() => true)
    const offA = bridge.menu.onPasteAs(unfocused)
    const offB = bridge.menu.onPasteAs(focused)
    const offC = bridge.menu.onPasteAs(later)
    vi.mocked(ipcRenderer.invoke).mockClear()
    emit(undefined, request)
    expect(unfocused).toHaveBeenCalledWith(request)
    expect(focused).toHaveBeenCalledWith(request)
    expect(later).not.toHaveBeenCalled()
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
    offB()
    offC()
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({ ok: true, value: undefined })
    emit(undefined, request)
    expect(ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(SPECIAL.menuPasteTextFallback.channel, request.text)
    offA()
    vi.mocked(ipcRenderer.invoke).mockClear()
    emit(undefined, { mode: 'markdown', text: 'ordinary input' })
    expect(ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(SPECIAL.menuPasteTextFallback.channel, 'ordinary input')
  })

  it('watch() multiplexes by subscription id: each listener gets only its own events; unsubscribe removes the listener and sends watch:unsubscribe', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.send).mockClear()
    const a = vi.fn()
    const b = vi.fn()
    const offA = bridge.watch('/vault/a', a)
    const offB = bridge.watch('/vault/b', b)
    const subs = vi.mocked(ipcRenderer.send).mock.calls.filter(([ch]) => ch === SPECIAL.watchSubscribe)
    expect(subs).toHaveLength(2)
    const idA = (subs[0][1] as { id: string; root: string }).id
    const idB = (subs[1][1] as { id: string; root: string }).id
    expect(idA).not.toBe(idB)
    expect((subs[0][1] as { root: string }).root).toBe('/vault/a')
    expect((subs[1][1] as { root: string }).root).toBe('/vault/b')
    type WatchHandler = (e: unknown, msg: { id: string; ev: WatchEvent }) => void
    const handlers = vi
      .mocked(ipcRenderer.on)
      .mock.calls.filter(([ch]) => ch === SPECIAL.watchEvent)
      .map((c) => c[1] as unknown as WatchHandler)
      .slice(-2) // this test's two subscriptions (the module accumulates across tests)
    // Main fans every event out to every renderer listener on watch:event; the id filters them.
    const evA: WatchEvent = { type: 'change', path: '/vault/a/x.md', mtime: 1 }
    const evB: WatchEvent = { type: 'unlink', path: '/vault/b/y.md' }
    for (const h of handlers) h(undefined, { id: idA, ev: evA })
    for (const h of handlers) h(undefined, { id: idB, ev: evB })
    expect(a).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith(evA)
    expect(b).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledWith(evB)
    // Unsubscribe A: its watch:event listener is removed and main is told to drop the subscription.
    vi.mocked(ipcRenderer.send).mockClear()
    offA()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === SPECIAL.watchEvent && l === (handlers[0] as unknown))).toBe(true)
    expect(ipcRenderer.send).toHaveBeenCalledWith(SPECIAL.watchUnsubscribe, idA)
    // B is untouched by A's unsubscribe.
    for (const h of handlers) h(undefined, { id: idB, ev: evB })
    expect(b).toHaveBeenCalledTimes(2)
    offB()
    expect(ipcRenderer.send).toHaveBeenCalledWith(SPECIAL.watchUnsubscribe, idB)
  })

  it('acks app:flush only after every onFlush listener settled (GRO-2160 close handshake)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const call = vi.mocked(ipcRenderer.on).mock.calls.find(([ch]) => ch === SPECIAL.appFlush)
    expect(call).toBeDefined()
    const flushRequested = call?.[1] as unknown as () => void
    const settle = () => new Promise((r) => setTimeout(r))
    let release!: () => void
    const off = bridge.window.onFlush(() => new Promise<void>((r) => (release = r)))
    vi.mocked(ipcRenderer.send).mockClear()
    flushRequested()
    await settle()
    expect(ipcRenderer.send).not.toHaveBeenCalled()
    release()
    await settle()
    expect(ipcRenderer.send).toHaveBeenCalledWith(SPECIAL.appFlushed)
    // No listeners registered (Welcome window): the ack comes straight away.
    off()
    vi.mocked(ipcRenderer.send).mockClear()
    flushRequested()
    await settle()
    expect(ipcRenderer.send).toHaveBeenCalledWith(SPECIAL.appFlushed)
  })
})
