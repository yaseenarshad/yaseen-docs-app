import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { connectedCommand } from './connected'
import type { AutomationServices } from './services'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-connected-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const services = () => ({
  credentials: { hasPixabay: vi.fn(async () => true), setPixabay: vi.fn(async () => {}) },
  sync: { status: vi.fn(async () => ({ state: 'off' })), syncNow: vi.fn(async () => ({ state: 'idle' })), setEnabled: vi.fn(async () => ({ state: 'off' })) },
  sharing: { list: vi.fn(async () => [{ id: 'one' }, { id: 'two' }]), accounts: vi.fn(async () => [{ id: 'account', name: 'Test' }]), publish: vi.fn(async () => ({ id: 'published' })), disconnect: vi.fn(async () => ({ configured: false })) },
})
const run = (service: ReturnType<typeof services>, command: string, args: Record<string, unknown> = {}, body = '') => connectedCommand(service as unknown as AutomationServices, defaultAppState(), command, args, Buffer.from(body))
it('uses the shared sync manager and distinguishes offline share listing from remote checking', async () => {
  const service = services()
  await run(service, 'sync.setEnabled', { root, enabled: false })
  expect(service.sync.setEnabled).toHaveBeenCalledExactlyOnceWith(root, false)
  expect(await run(service, 'share.list', { root, limit: 1 })).toEqual({ items: [{ id: 'one' }], total: 2, nextOffset: 1 })
  expect(service.sharing.list).toHaveBeenLastCalledWith(root, { check: false })
  await run(service, 'share.check', { root })
  expect(service.sharing.list).toHaveBeenLastCalledWith(root, { check: true })
})
it('reports credential presence and redacts failed protected operations', async () => {
  const service = services()
  expect(await run(service, 'provider.status')).toEqual({ provider: 'pixabay', configured: true })
  await run(service, 'provider.set', {}, 'test-token\n')
  expect(service.credentials.setPixabay).toHaveBeenCalledWith('test-token')
  service.sharing.accounts.mockRejectedValueOnce(new Error('Provider echoed test-token'))
  await expect(run(service, 'share.accounts', {}, 'test-token')).rejects.toMatchObject({ code: 'PROVIDER_FAILED', message: expect.not.stringContaining('test-token') })
  await expect(run(service, 'provider.set', {}, 'x'.repeat(65537))).rejects.toMatchObject({ code: 'TOO_LARGE' })
  await expect(run(service, 'provider.set', {}, '')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await run(service, 'provider.clear')
  expect(service.credentials.setPixabay).toHaveBeenLastCalledWith(null)
})
it('publishes only an explicitly scoped target and passes the requested update ID', async () => {
  const service = services(), path = join(root, 'Board.excalidraw')
  await writeFile(path, '{}')
  await run(service, 'share.publish', { root, path, shareId: 'existing' }, 'standalone-content')
  expect(service.sharing.publish).toHaveBeenCalledExactlyOnceWith(root, path, 'standalone-content', 'existing')
  await expect(run(service, 'share.publish', { root, path: '/outside.excalidraw' }, 'x')).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
  await run(service, 'share.disconnect', { root: null, deleteEverything: false })
  expect(service.sharing.disconnect).toHaveBeenCalledExactlyOnceWith(null, false)
})
