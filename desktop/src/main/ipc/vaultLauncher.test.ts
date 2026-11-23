import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { createStore, type Store } from '../store'
import {
  createUnsupportedVaultLauncherBackend,
  MAX_LAUNCHER_ICON_BYTES,
  registerVaultLauncherIpc,
  vaultLauncherIconPath,
  type VaultLauncherBackend,
} from './vaultLauncher'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
function registered(door: { channel: string }): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}

// Minimal valid 8-byte PNG header + dummy body.
const VALID_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('test-png-data')])
const VALID_PNG_B64 = VALID_PNG.toString('base64')

let dir: string
let store: Store
let installedApps: Set<string>
let backend: VaultLauncherBackend
let onIconChanged: ReturnType<typeof vi.fn<(iconPath: string) => void>>

beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yd-vault-launcher-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  installedApps = new Set()
  onIconChanged = vi.fn()
  backend = {
    supported: true,
    install: vi.fn(async ({ name }) => {
      const appPath = `/Applications/${name}.app`
      installedApps.add(appPath)
      return { appPath }
    }),
    remove: vi.fn(async (appPath: string) => {
      installedApps.delete(appPath)
    }),
    reveal: vi.fn(),
    launch: vi.fn(),
    exists: vi.fn((p: string) => installedApps.has(p)),
  }
  registerVaultLauncherIpc(store, dir, backend, onIconChanged)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('vaultLauncher IPC (YAZ-6374)', () => {
  const ROOT = '/Users/yasin/Vaults/Work'

  it('status returns null launcher when none is configured', async () => {
    const res = await registered(CONTRACT.vaultLauncher.status)(undefined, ROOT)
    expect(res).toEqual({
      ok: true,
      value: { supported: true, launcher: null, exists: false, iconDataUrl: null },
    })
  })

  it('create writes PNG atomically, installs via backend, persists FolderState.launcher, and notifies onIconChanged', async () => {
    const res = await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work Docs',
      pngBase64: `data:image/png;base64,${VALID_PNG_B64}`,
      target: 'inbox',
      badge: { kind: 'emoji', value: '🚀', color: '#2563eb' },
    })

    const expectedIconPath = vaultLauncherIconPath(dir, ROOT)
    expect(res).toEqual({
      ok: true,
      value: {
        supported: true,
        launcher: {
          name: 'Work Docs',
          appPath: '/Applications/Work Docs.app',
          iconPath: expectedIconPath,
          target: 'inbox',
          badge: { kind: 'emoji', value: '🚀', color: '#2563eb' },
        },
        exists: true,
        iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
      },
    })

    // Cached PNG was written with exact bytes.
    expect(existsSync(expectedIconPath)).toBe(true)
    expect(await readFile(expectedIconPath)).toEqual(VALID_PNG)

    // Store persisted launcher metadata.
    expect(store.get().folders[ROOT]?.launcher).toEqual({
      name: 'Work Docs',
      appPath: '/Applications/Work Docs.app',
      iconPath: expectedIconPath,
      target: 'inbox',
      badge: { kind: 'emoji', value: '🚀', color: '#2563eb' },
    })
    expect(onIconChanged).toHaveBeenCalledWith(expectedIconPath)

    // Re-creating passes previousAppPath to backend.install.
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work HQ',
      pngBase64: VALID_PNG_B64,
    })
    expect(backend.install).toHaveBeenLastCalledWith(
      expect.objectContaining({
        root: ROOT,
        name: 'Work HQ',
        previousAppPath: '/Applications/Work Docs.app',
      }),
    )
  })

  it('validates create inputs: relative root, empty name, bad PNG magic, >2MB PNG, bad target, bad badge', async () => {
    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, { root: 'relative/path', name: 'X', pngBase64: VALID_PNG_B64 }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ABSOLUTE' } })

    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT, name: '   ', pngBase64: VALID_PNG_B64 }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })

    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT, name: 'Work', pngBase64: Buffer.from('not-a-png').toString('base64') }),
    ).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_TYPE' } })

    const oversized = Buffer.concat([VALID_PNG, Buffer.alloc(MAX_LAUNCHER_ICON_BYTES)]).toString('base64')
    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT, name: 'Work', pngBase64: oversized }),
    ).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })

    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT, name: 'Work', pngBase64: VALID_PNG_B64, target: 'invalid' }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })

    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, {
        root: ROOT,
        name: 'Work',
        pngBase64: VALID_PNG_B64,
        badge: { kind: 'emoji', value: 'x', color: 'not-hex' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })

    expect(backend.install).not.toHaveBeenCalled()
  })

  it('status detects Finder-deleted launchers while preserving metadata and cached iconDataUrl', async () => {
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work',
      pngBase64: VALID_PNG_B64,
    })

    // Simulate user deleting the .app in Finder.
    installedApps.delete('/Applications/Work.app')

    const status = await registered(CONTRACT.vaultLauncher.status)(undefined, ROOT)
    expect(status).toEqual({
      ok: true,
      value: {
        supported: true,
        launcher: expect.objectContaining({ name: 'Work', appPath: '/Applications/Work.app' }),
        exists: false,
        iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
      },
    })
  })

  it('remove trashes existing .app, deletes cached PNG, clears store, and notifies onIconChanged', async () => {
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work',
      pngBase64: VALID_PNG_B64,
    })
    const iconPath = vaultLauncherIconPath(dir, ROOT)
    onIconChanged.mockClear()

    expect(await registered(CONTRACT.vaultLauncher.remove)(undefined, ROOT)).toEqual({ ok: true, value: undefined })
    expect(backend.remove).toHaveBeenCalledWith('/Applications/Work.app', ROOT)
    expect(existsSync(iconPath)).toBe(false)
    expect(store.get().folders[ROOT]?.launcher).toBeUndefined()
    expect(onIconChanged).toHaveBeenCalledWith(iconPath)
  })

  it('remove skips backend.remove when the .app was already deleted in Finder', async () => {
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work',
      pngBase64: VALID_PNG_B64,
    })
    installedApps.delete('/Applications/Work.app')

    expect(await registered(CONTRACT.vaultLauncher.remove)(undefined, ROOT)).toEqual({ ok: true, value: undefined })
    expect(backend.remove).not.toHaveBeenCalled()
    expect(store.get().folders[ROOT]?.launcher).toBeUndefined()
  })

  it('reveal and test delegate to backend when .app exists, and reject NOT_FOUND when missing', async () => {
    expect(await registered(CONTRACT.vaultLauncher.reveal)(undefined, ROOT)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await registered(CONTRACT.vaultLauncher.test)(undefined, ROOT)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })

    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work',
      pngBase64: VALID_PNG_B64,
    })

    expect(await registered(CONTRACT.vaultLauncher.reveal)(undefined, ROOT)).toEqual({ ok: true, value: undefined })
    expect(backend.reveal).toHaveBeenCalledWith('/Applications/Work.app')

    expect(await registered(CONTRACT.vaultLauncher.test)(undefined, ROOT)).toEqual({ ok: true, value: undefined })
    expect(backend.launch).toHaveBeenCalledWith('/Applications/Work.app')

    // Removed in Finder -> NOT_FOUND.
    installedApps.delete('/Applications/Work.app')
    expect(await registered(CONTRACT.vaultLauncher.reveal)(undefined, ROOT)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await registered(CONTRACT.vaultLauncher.test)(undefined, ROOT)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('icons returns data URLs only for launchers whose .app and PNG both exist', async () => {
    const ROOT_B = '/Users/yasin/Vaults/Personal'
    const ROOT_C = '/Users/yasin/Vaults/Ghost'

    await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT, name: 'Work', pngBase64: VALID_PNG_B64 })
    await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT_B, name: 'Personal', pngBase64: VALID_PNG_B64 })
    await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT_C, name: 'Ghost', pngBase64: VALID_PNG_B64 })

    // Remove Ghost's .app in Finder, and delete Personal's PNG.
    installedApps.delete('/Applications/Ghost.app')
    await rm(vaultLauncherIconPath(dir, ROOT_B), { force: true })

    const res = await registered(CONTRACT.vaultLauncher.icons)(undefined)
    expect(res).toEqual({
      ok: true,
      value: {
        [ROOT]: `data:image/png;base64,${VALID_PNG_B64}`,
      },
    })
  })

  it('preserves previous cached icon PNG when backend.install fails and persists sanitized backend name', async () => {
    const firstPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('first-icon')])
    const secondPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('second-icon')])

    vi.mocked(backend.install).mockResolvedValueOnce({ appPath: '/Applications/Work.app', name: 'Work' })
    installedApps.add('/Applications/Work.app')
    const okRes = await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work.app',
      pngBase64: firstPng.toString('base64'),
    })
    expect(okRes).toMatchObject({ ok: true, value: { launcher: { name: 'Work', appPath: '/Applications/Work.app' } } })

    const iconPath = vaultLauncherIconPath(dir, ROOT)
    expect(await readFile(iconPath)).toEqual(firstPng)

    // Second install fails (e.g. collision guard): cached icon PNG must stay `firstPng`.
    vi.mocked(backend.install).mockRejectedValueOnce(new Error('Cannot overwrite third-party app'))
    const failRes = await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Safari',
      pngBase64: secondPng.toString('base64'),
    })
    expect(failRes).toMatchObject({ ok: false })
    expect(await readFile(iconPath)).toEqual(firstPng)
  })

  it('unsupported stub backend reports supported: false and refuses create', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    registerVaultLauncherIpc(store, dir, createUnsupportedVaultLauncherBackend())
    expect(await registered(CONTRACT.vaultLauncher.status)(undefined, ROOT)).toEqual({
      ok: true,
      value: { supported: false, launcher: null, exists: false, iconDataUrl: null },
    })
    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, { root: ROOT, name: 'Work', pngBase64: VALID_PNG_B64 }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
  })
})
