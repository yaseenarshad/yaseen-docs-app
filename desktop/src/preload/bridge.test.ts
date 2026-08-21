import { describe, expect, it, vi } from 'vitest'
import type { StateApi, WindowApi, YaseenDocsApi } from '@shared/types'

const exposed: Record<string, unknown> = {}
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => void (exposed[name] = value) },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))

/** Compile-time exhaustive: adding a method to the contract without listing it here fails typecheck. */
const TOP: readonly (keyof YaseenDocsApi)[] = ['tree', 'readFile', 'writeFile', 'createDir', 'createFile', 'pickFolder', 'watch', 'state', 'window']
const STATE: readonly (keyof StateApi)[] = ['get', 'setSettings', 'setSidebarCollapsed', 'pushRecent', 'setFolder', 'setFolds', 'onChange']
const WINDOW: readonly (keyof WindowApi)[] = ['identity', 'setIdentity', 'open', 'duplicate']
type Exhaustive<T, K extends readonly (keyof T)[]> = Exclude<keyof T, K[number]> extends never ? true : never
const _top: Exhaustive<YaseenDocsApi, typeof TOP> = true
const _state: Exhaustive<StateApi, typeof STATE> = true
const _window: Exhaustive<WindowApi, typeof WINDOW> = true
void [_top, _state, _window]

describe('preload bridge', () => {
  it('installs window.yaseenDocs with every contract method', async () => {
    await import('./index')
    const api = exposed.yaseenDocs as YaseenDocsApi
    expect(api).toBeDefined()
    for (const k of TOP) expect(api[k], k).toBeDefined()
    for (const k of STATE) expect(typeof api.state[k], `state.${k}`).toBe('function')
    for (const k of WINDOW) expect(typeof api.window[k], `window.${k}`).toBe('function')
  })

  it('rejects with the plain BridgeError when main answers an error envelope', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'newer on disk', mtime: 42 } })
    const { bridge } = await import('./index')
    await expect(bridge.writeFile({ path: '/x.md', content: '' })).rejects.toEqual({ code: 'CONFLICT', message: 'newer on disk', mtime: 42 })
  })
})
