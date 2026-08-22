import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YaseenDocsApi } from '@shared/types'
import { api, ApiRequestError } from './api'

/** A minimal `window.yaseenDocs` stub: only the methods the client `api` delegates to. */
function installBridge(): { [K in keyof YaseenDocsApi]: ReturnType<typeof vi.fn> } {
  const bridge = {
    tree: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createDir: vi.fn(),
    createFile: vi.fn(),
    index: vi.fn(),
    readAsset: vi.fn(),
    pickFolder: vi.fn(),
    watch: vi.fn(),
    state: vi.fn(),
    window: vi.fn(),
    menu: vi.fn(),
    link: vi.fn(),
    vaultConfig: vi.fn(),
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let bridge: ReturnType<typeof installBridge>
beforeEach(() => (bridge = installBridge()))
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('api', () => {
  it('delegates to window.yaseenDocs with the same arguments and resolves its value', async () => {
    bridge.tree.mockResolvedValue({ root: '/v', tree: [], generatedAt: 1 })
    bridge.writeFile.mockResolvedValue({ path: '/v/a.md', mtime: 2, size: 3 })
    bridge.pickFolder.mockResolvedValue({ cancelled: true })
    await expect(api.tree('/v')).resolves.toEqual({ root: '/v', tree: [], generatedAt: 1 })
    expect(bridge.tree).toHaveBeenCalledWith('/v')
    await expect(api.writeFile({ path: '/v/a.md', content: 'x', expectedMtime: 1 })).resolves.toEqual({ path: '/v/a.md', mtime: 2, size: 3 })
    expect(bridge.writeFile).toHaveBeenCalledWith({ path: '/v/a.md', content: 'x', expectedMtime: 1 })
    await expect(api.pickFolder()).resolves.toEqual({ cancelled: true })
    await api.readFile('/v/a.md')
    await api.createDir('/v/d')
    await api.createFile('/v/n.md')
    expect(bridge.readFile).toHaveBeenCalledWith('/v/a.md')
    expect(bridge.createDir).toHaveBeenCalledWith('/v/d')
    expect(bridge.createFile).toHaveBeenCalledWith('/v/n.md')
    bridge.index.mockResolvedValue({ root: '/v', records: [], generatedAt: 4 })
    await expect(api.index('/v')).resolves.toEqual({ root: '/v', records: [], generatedAt: 4 })
    expect(bridge.index).toHaveBeenCalledWith('/v')
    bridge.readAsset.mockResolvedValue({ path: '/v/pic.png', mime: 'image/png', data: 'aGk=', size: 2 })
    await expect(api.readAsset('/v', 'pic.png')).resolves.toEqual({ path: '/v/pic.png', mime: 'image/png', data: 'aGk=', size: 2 })
    expect(bridge.readAsset).toHaveBeenCalledWith('/v', 'pic.png')
  })

  it('a rejected plain BridgeError becomes a thrown ApiRequestError with code / message / path / mtime', async () => {
    bridge.writeFile.mockRejectedValue({ code: 'CONFLICT', message: 'newer on disk', path: '/v/a.md', mtime: 42 })
    const err = await api.writeFile({ path: '/v/a.md', content: '' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiRequestError)
    const e = err as ApiRequestError
    expect(e.code).toBe('CONFLICT')
    expect(e.message).toBe('newer on disk')
    expect(e.path).toBe('/v/a.md')
    expect(e.mtime).toBe(42)
    expect(e.name).toBe('ApiRequestError')
    expect('status' in e).toBe(false)
  })

  it('a BridgeError without path / mtime leaves those fields undefined', async () => {
    bridge.readFile.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    const err = (await api.readFile('/v/missing.md').catch((e: unknown) => e)) as ApiRequestError
    expect(err).toBeInstanceOf(ApiRequestError)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.mtime).toBeUndefined()
    expect(err.path).toBeUndefined()
  })

  it('anything that is not a BridgeError is wrapped as IO_ERROR with its message', async () => {
    bridge.tree.mockRejectedValue(new Error('ipc gone'))
    const err = (await api.tree('/v').catch((e: unknown) => e)) as ApiRequestError
    expect(err).toBeInstanceOf(ApiRequestError)
    expect(err.code).toBe('IO_ERROR')
    expect(err.message).toBe('ipc gone')
  })
})
