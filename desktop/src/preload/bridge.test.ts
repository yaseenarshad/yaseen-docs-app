import { describe, expect, it, vi } from 'vitest'
import type { LinkApi, MenuApi, StateApi, WindowApi, YaseenDocsApi } from '@shared/types'
import { CH } from '../channels'

const exposed: Record<string, unknown> = {}
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => void (exposed[name] = value) },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))

/** Compile-time exhaustive: adding a method to the contract without listing it here fails typecheck. */
const TOP: readonly (keyof YaseenDocsApi)[] = ['tree', 'readFile', 'writeFile', 'createDir', 'createFile', 'index', 'readAsset', 'pickFolder', 'watch', 'state', 'window', 'menu', 'link']
const STATE: readonly (keyof StateApi)[] = ['get', 'setSettings', 'setSidebarCollapsed', 'pushRecent', 'removeRecent', 'setFolder', 'setFolds', 'setBaseGroups', 'onChange']
const WINDOW: readonly (keyof WindowApi)[] = ['identity', 'setIdentity', 'open', 'duplicate', 'onFlush']
const MENU: readonly (keyof MenuApi)[] = ['onOpenFolder', 'onOpenRoot']
const LINK: readonly (keyof LinkApi)[] = ['onOpenFile', 'onNotice']
type Exhaustive<T, K extends readonly (keyof T)[]> = Exclude<keyof T, K[number]> extends never ? true : never
const _top: Exhaustive<YaseenDocsApi, typeof TOP> = true
const _state: Exhaustive<StateApi, typeof STATE> = true
const _window: Exhaustive<WindowApi, typeof WINDOW> = true
const _menu: Exhaustive<MenuApi, typeof MENU> = true
const _link: Exhaustive<LinkApi, typeof LINK> = true
void [_top, _state, _window, _menu, _link]

describe('preload bridge', () => {
  it('installs window.yaseenDocs with every contract method', async () => {
    await import('./index')
    const api = exposed.yaseenDocs as YaseenDocsApi
    expect(api).toBeDefined()
    for (const k of TOP) expect(api[k], k).toBeDefined()
    for (const k of STATE) expect(typeof api.state[k], `state.${k}`).toBe('function')
    for (const k of WINDOW) expect(typeof api.window[k], `window.${k}`).toBe('function')
    for (const k of MENU) expect(typeof api.menu[k], `menu.${k}`).toBe('function')
    for (const k of LINK) expect(typeof api.link[k], `link.${k}`).toBe('function')
  })

  it('forwards link:open-file paths to the listener and unsubscribes cleanly (E1, GRO-2171)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.link.onOpenFile(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.linkOpenFile)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown, path: string) => void
    emit(undefined, '/vaults/notes/a.md')
    expect(listener).toHaveBeenCalledWith('/vaults/notes/a.md')
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.linkOpenFile && l === emit)).toBe(true)
  })

  it('forwards menu:open-root paths to the listener and unsubscribes cleanly (GRO-2161)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.menu.onOpenRoot(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.menuOpenRoot)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown, path: string) => void
    emit(undefined, '/vaults/notes')
    expect(listener).toHaveBeenCalledWith('/vaults/notes')
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.menuOpenRoot && l === emit)).toBe(true)
  })

  it('rejects with the plain BridgeError when main answers an error envelope', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'newer on disk', mtime: 42 } })
    const { bridge } = await import('./index')
    await expect(bridge.writeFile({ path: '/x.md', content: '' })).rejects.toEqual({ code: 'CONFLICT', message: 'newer on disk', mtime: 42 })
  })

  it('acks app:flush only after every onFlush listener settled (GRO-2160 close handshake)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const call = vi.mocked(ipcRenderer.on).mock.calls.find(([ch]) => ch === CH.appFlush)
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
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.appFlushed)
    // No listeners registered (Welcome window): the ack comes straight away.
    off()
    vi.mocked(ipcRenderer.send).mockClear()
    flushRequested()
    await settle()
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.appFlushed)
  })
})
