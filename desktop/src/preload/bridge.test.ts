import { describe, expect, it, vi } from 'vitest'
import type { LinkApi, MenuApi, RegistryApi, StateApi, VaultConfigApi, WatchEvent, WindowApi, YaseenDocsApi } from '@shared/types'
import { CH } from '../channels'

const exposed: Record<string, unknown> = {}
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => void (exposed[name] = value) },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))

/**
 * Compile-time exhaustive: adding a method to the contract without listing it here fails
 * typecheck. `as const satisfies` keeps each tuple's literal type (a plain `readonly (keyof T)[]`
 * annotation would widen it and make `Exhaustive<>` vacuous) while still rejecting typos.
 */
const TOP = ['tree', 'readFile', 'writeFile', 'createDir', 'createFile', 'index', 'readAsset', 'pickFolder', 'watch', 'state', 'window', 'menu', 'link', 'vaultConfig', 'registry'] as const satisfies readonly (keyof YaseenDocsApi)[]
const STATE = ['get', 'setSettings', 'setSidebarCollapsed', 'pushRecent', 'removeRecent', 'setFolder', 'setFolds', 'setBaseGroups', 'onChange'] as const satisfies readonly (keyof StateApi)[]
const WINDOW = ['identity', 'setIdentity', 'open', 'duplicate', 'onFlush'] as const satisfies readonly (keyof WindowApi)[]
const MENU = ['onOpenFolder', 'onOpenRoot'] as const satisfies readonly (keyof MenuApi)[]
const LINK = ['onOpenFile', 'onNotice'] as const satisfies readonly (keyof LinkApi)[]
const VAULT_CONFIG = ['read', 'write', 'onChange'] as const satisfies readonly (keyof VaultConfigApi)[]
const REGISTRY = ['get', 'setType', 'removeType', 'setProperty', 'removeProperty', 'onChange'] as const satisfies readonly (keyof RegistryApi)[]
type Exhaustive<T, K extends readonly (keyof T)[]> = Exclude<keyof T, K[number]> extends never ? true : never
const _top: Exhaustive<YaseenDocsApi, typeof TOP> = true
const _state: Exhaustive<StateApi, typeof STATE> = true
const _window: Exhaustive<WindowApi, typeof WINDOW> = true
const _menu: Exhaustive<MenuApi, typeof MENU> = true
const _link: Exhaustive<LinkApi, typeof LINK> = true
const _vaultConfig: Exhaustive<VaultConfigApi, typeof VAULT_CONFIG> = true
const _registry: Exhaustive<RegistryApi, typeof REGISTRY> = true
void [_top, _state, _window, _menu, _link, _vaultConfig, _registry]

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
    for (const k of VAULT_CONFIG) expect(typeof api.vaultConfig[k], `vaultConfig.${k}`).toBe('function')
    for (const k of REGISTRY) expect(typeof api.registry[k], `registry.${k}`).toBe('function')
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

  it('watch() multiplexes by subscription id: each listener gets only its own events; unsubscribe removes the listener and sends watch:unsubscribe', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.send).mockClear()
    const a = vi.fn()
    const b = vi.fn()
    const offA = bridge.watch('/vault/a', a)
    const offB = bridge.watch('/vault/b', b)
    const subs = vi.mocked(ipcRenderer.send).mock.calls.filter(([ch]) => ch === CH.watchSubscribe)
    expect(subs).toHaveLength(2)
    const idA = (subs[0][1] as { id: string; root: string }).id
    const idB = (subs[1][1] as { id: string; root: string }).id
    expect(idA).not.toBe(idB)
    expect((subs[0][1] as { root: string }).root).toBe('/vault/a')
    expect((subs[1][1] as { root: string }).root).toBe('/vault/b')
    type WatchHandler = (e: unknown, msg: { id: string; ev: WatchEvent }) => void
    const handlers = vi
      .mocked(ipcRenderer.on)
      .mock.calls.filter(([ch]) => ch === CH.watchEvent)
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
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.watchEvent && l === (handlers[0] as unknown))).toBe(true)
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.watchUnsubscribe, idA)
    // B is untouched by A's unsubscribe.
    for (const h of handlers) h(undefined, { id: idB, ev: evB })
    expect(b).toHaveBeenCalledTimes(2)
    offB()
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.watchUnsubscribe, idB)
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
