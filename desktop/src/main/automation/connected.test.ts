import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { connectedCommand } from './connected'
import type { AutomationServices } from './services'
import type { LiveEdits } from './liveEdits'
import { boardCommand } from './boards'
import { checked } from './contract'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-connected-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
// The services' real result shapes (shared/types.ts), so the contract check proves what the adapter adds.
const share = (id: string) => ({ path: join(root, 'Board.excalidraw'), id, url: `https://share.test/b/${id}`, allowDownload: true, sharedAt: 1, updatedAt: 1, sync: { state: 'ok' }, stale: false })
const off = { state: 'off', url: null, workersDevUrl: null, customDomain: null, accountName: null, workerName: null, bucketName: null, readyAt: null, demo: false }
const services = () => ({
  credentials: { hasPixabay: vi.fn(async () => true), setPixabay: vi.fn(async () => {}) },
  sync: { status: vi.fn(async () => ({ root, state: 'off' })), syncNow: vi.fn(async () => ({ root, state: 'synced' })), setEnabled: vi.fn(async () => ({ root, state: 'off', enabled: false })) },
  sharing: { list: vi.fn(async () => [{ ...share('one'), fileExists: true }, { ...share('two'), fileExists: false }]), accounts: vi.fn(async () => [{ id: 'account', name: 'Test' }]), publish: vi.fn(async () => share('published')), disconnect: vi.fn(async () => off) },
})
const run = (service: ReturnType<typeof services>, command: string, args: Record<string, unknown> = {}, body = '', liveEdits?: LiveEdits) => checked(command, connectedCommand(service as unknown as AutomationServices, defaultAppState(), command, args, Buffer.from(body), liveEdits))
it('uses the shared sync manager and distinguishes offline share listing from remote checking', async () => {
  const service = services()
  await run(service, 'sync.setEnabled', { root, enabled: false })
  expect(service.sync.setEnabled).toHaveBeenCalledExactlyOnceWith(root, false)
  expect(await run(service, 'share.list', { root, limit: 1 })).toMatchObject({ items: [{ id: 'one' }], total: 2, nextOffset: 1 })
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
  const content = JSON.stringify({ type: 'excalidraw', elements: [], appState: {}, files: {} })
  await run(service, 'share.publish', { root, path, shareId: 'existing' }, content)
  expect(service.sharing.publish).toHaveBeenCalledExactlyOnceWith(root, path, content, 'existing')
  await expect(run(service, 'share.publish', { root, path: '/outside.excalidraw' }, 'x')).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
  await run(service, 'share.disconnect', { root: null, deleteEverything: false })
  expect(service.sharing.disconnect).toHaveBeenCalledExactlyOnceWith(null, false)
})
it('refuses a non-standalone drawing and preserves valid embedded bytes unchanged', async () => {
  const service = services(), path = join(root, 'Picture.excalidraw')
  await writeFile(path, '{}')
  const scene = { elements: [{ type: 'image', fileId: 'picture' }] }
  await expect(run(service, 'share.publish', { root, path }, JSON.stringify(scene))).rejects.toMatchObject({ code: 'INCOMPLETE_CONTENT' })
  expect(service.sharing.publish).not.toHaveBeenCalled()
  const content = JSON.stringify({ ...scene, files: { picture: { dataURL: 'data:image/png;base64,AA==' } } })
  await run(service, 'share.publish', { root, path }, content)
  expect(service.sharing.publish).toHaveBeenCalledExactlyOnceWith(root, path, content, undefined)
})
it('YAZ-4515: history.restore refuses while a live editor holds unsaved edits of the board, then restores through git', async () => {
  const path = join(root, 'Board.excalidraw'), scene = (source: string) => JSON.stringify({ type: 'excalidraw', version: 2, source, elements: [], appState: {}, files: {} })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: root })
  git('init', '-q'); await writeFile(path, scene('first')); git('add', '.'); git('commit', '-qm', 'first')
  await writeFile(path, scene('second')); git('commit', '-qam', 'second')
  const service = services()
  const { items } = await run(service, 'history.list', { root, path }) as { items: { ref: string }[] }
  expect(await run(service, 'history.read', { root, path, ref: items.at(-1)!.ref })).toMatchObject({ kind: 'drawing', files: {} })
  expect(await run(service, 'history.export', { root, path, ref: items.at(-1)!.ref, outputFile: join(root, 'First.json') })).toMatchObject({ diskSaved: true })
  const { revision } = await boardCommand(defaultAppState(), 'drawing.read', { root, path }, Buffer.alloc(0)) as { revision: string }
  const open = [{ window: 'w1', path, tabs: ['t1'] }]
  await expect(run(service, 'history.restore', { root, path, ref: items.at(-1)!.ref, revision }, '', async target => target === path ? open : [])).rejects.toMatchObject({ code: 'UNSAVED_LIVE_EDITS', details: { path, open } })
  expect(await readFile(path, 'utf8')).toBe(scene('second'))
  expect(await run(service, 'history.restore', { root, path, ref: items.at(-1)!.ref, revision }, '', async () => [])).toMatchObject({ path, diskSaved: true })
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ source: 'first' })
})
