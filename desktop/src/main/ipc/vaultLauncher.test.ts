import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { createStore, type Store } from '../store'
import { buildLauncherPlist, LAUNCHER_BUNDLE_ID_PREFIX, type ScannedLauncher } from '../vaultLauncher'
import {
  cleanupWorkspaceLauncher,
  createUnsupportedVaultLauncherBackend,
  MAX_LAUNCHER_ICON_BYTES,
  registerVaultLauncherIpc,
  vaultLauncherIconPath,
  workspaceLauncherIconPath,
  type VaultLauncherBackend,
} from './vaultLauncher'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

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
let scannedApps: ScannedLauncher[]
let backend: VaultLauncherBackend
let onIconChanged: ReturnType<typeof vi.fn<(iconPath: string) => void>>
let onChanged: ReturnType<typeof vi.fn<() => void>>

beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yd-vault-launcher-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  installedApps = new Set()
  scannedApps = []
  onIconChanged = vi.fn()
  onChanged = vi.fn()
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
    scan: vi.fn(async () => scannedApps),
  }
  registerVaultLauncherIpc(store, dir, backend, onIconChanged, onChanged)
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

describe('workspace launcher IPC', () => {
  it('createWorkspace, workspaceStatus, revealWorkspace, testWorkspace, workspaceIcons, and removeWorkspace work end-to-end', async () => {
    const ws = store.saveVaultSet('Work Suite', ['/vaults/a', '/vaults/b'], 100)!
    const ws2 = store.saveVaultSet('Ghost Suite', ['/vaults/c', '/vaults/d'], 101)!

    // Status before creation.
    expect(await registered(CONTRACT.vaultLauncher.workspaceStatus)(undefined, ws.id)).toEqual({
      ok: true,
      value: { supported: true, launcher: null, exists: false, iconDataUrl: null },
    })

    // Create workspace launcher.
    const expectedIconPath = workspaceLauncherIconPath(dir, ws.id)
    const created = await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws.id,
      name: 'Work Suite',
      pngBase64: `data:image/png;base64,${VALID_PNG_B64}`,
      badge: { kind: 'letters', value: 'WS', color: '#2563eb' },
    })
    expect(created).toEqual({
      ok: true,
      value: {
        supported: true,
        launcher: {
          name: 'Work Suite',
          appPath: '/Applications/Work Suite.app',
          iconPath: expectedIconPath,
          badge: { kind: 'letters', value: 'WS', color: '#2563eb' },
        },
        exists: true,
        iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
      },
    })
    expect(backend.install).toHaveBeenCalledWith(
      expect.objectContaining({
        root: `workspace:${ws.id}`,
        vaultUrl: `yaseendocs://workspace/${encodeURIComponent(ws.id)}`,
        name: 'Work Suite',
        iconPath: expectedIconPath,
      }),
    )
    expect(existsSync(expectedIconPath)).toBe(true)
    expect(store.get().vaultSets.find((s) => s.id === ws.id)?.launcher).toEqual({
      name: 'Work Suite',
      appPath: '/Applications/Work Suite.app',
      iconPath: expectedIconPath,
      badge: { kind: 'letters', value: 'WS', color: '#2563eb' },
    })
    expect(onIconChanged).toHaveBeenCalledWith(expectedIconPath)

    // Reveal and test delegate to backend.
    expect(await registered(CONTRACT.vaultLauncher.revealWorkspace)(undefined, ws.id)).toEqual({ ok: true, value: undefined })
    expect(backend.reveal).toHaveBeenCalledWith('/Applications/Work Suite.app')
    expect(await registered(CONTRACT.vaultLauncher.testWorkspace)(undefined, ws.id)).toEqual({ ok: true, value: undefined })
    expect(backend.launch).toHaveBeenCalledWith('/Applications/Work Suite.app')

    // Create a second workspace launcher and simulate Finder deletion -> omitted from workspaceIcons.
    await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws2.id,
      name: 'Ghost Suite',
      pngBase64: VALID_PNG_B64,
    })
    installedApps.delete('/Applications/Ghost Suite.app')

    expect(await registered(CONTRACT.vaultLauncher.workspaceIcons)(undefined)).toEqual({
      ok: true,
      value: {
        [ws.id]: `data:image/png;base64,${VALID_PNG_B64}`,
      },
    })

    // Remove workspace launcher.
    onIconChanged.mockClear()
    expect(await registered(CONTRACT.vaultLauncher.removeWorkspace)(undefined, ws.id)).toEqual({ ok: true, value: undefined })
    expect(backend.remove).toHaveBeenCalledWith('/Applications/Work Suite.app', `workspace:${ws.id}`)
    expect(existsSync(expectedIconPath)).toBe(false)
    expect(store.get().vaultSets.find((s) => s.id === ws.id)?.launcher).toBeUndefined()
    expect(onIconChanged).toHaveBeenCalledWith(expectedIconPath)
  })

  it('validates workspaceId, unknown workspace, and missing launcher app', async () => {
    expect(await registered(CONTRACT.vaultLauncher.workspaceStatus)(undefined, '   ')).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(
      await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
        workspaceId: 'missing-id',
        name: 'Nope',
        pngBase64: VALID_PNG_B64,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await registered(CONTRACT.vaultLauncher.revealWorkspace)(undefined, 'missing-id')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await registered(CONTRACT.vaultLauncher.testWorkspace)(undefined, 'missing-id')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})

describe('launcher lifecycle & All Launchers IPC (YAZ-6447)', () => {
  it('broadcasts onChanged on create, remove, createWorkspace, removeWorkspace, and removeOrphan', async () => {
    const root = '/Users/yasin/Vaults/Sync'
    const ws = store.saveVaultSet('Sync WS', ['/vaults/a', '/vaults/b'], 100)!

    onChanged.mockClear()
    await registered(CONTRACT.vaultLauncher.create)(undefined, { root, name: 'Sync', pngBase64: VALID_PNG_B64 })
    expect(onChanged).toHaveBeenCalledTimes(1)

    await registered(CONTRACT.vaultLauncher.remove)(undefined, root)
    expect(onChanged).toHaveBeenCalledTimes(2)

    await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, { workspaceId: ws.id, name: 'Sync WS', pngBase64: VALID_PNG_B64 })
    expect(onChanged).toHaveBeenCalledTimes(3)

    await registered(CONTRACT.vaultLauncher.removeWorkspace)(undefined, ws.id)
    expect(onChanged).toHaveBeenCalledTimes(4)

    // Real orphan .app on disk -> removeOrphan broadcasts onChanged.
    const orphanApp = path.join(dir, 'Orphan.app')
    await mkdir(path.join(orphanApp, 'Contents'), { recursive: true })
    await writeFile(
      path.join(orphanApp, 'Contents', 'Info.plist'),
      buildLauncherPlist({
        name: 'Orphan',
        bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}orphan-1234`,
        vaultUrl: 'yaseendocs:///Users/yasin/Old',
        vaultPath: '/Users/yasin/Old',
      }),
      'utf8',
    )
    expect(await registered(CONTRACT.vaultLauncher.removeOrphan)(undefined, orphanApp)).toEqual({ ok: true, value: undefined })
    expect(onChanged).toHaveBeenCalledTimes(5)
  })

  it('cleanupWorkspaceLauncher trashes .app, deletes cached PNG, calls onIconChanged, and broadcasts onChanged', async () => {
    const ws = store.saveVaultSet('Cleanup WS', ['/vaults/a', '/vaults/b'], 100)!
    await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws.id,
      name: 'Cleanup WS',
      pngBase64: VALID_PNG_B64,
    })
    const iconPath = workspaceLauncherIconPath(dir, ws.id)
    expect(existsSync(iconPath)).toBe(true)

    onIconChanged.mockClear()
    onChanged.mockClear()
    await cleanupWorkspaceLauncher(store, backend, ws.id, onIconChanged, onChanged)

    expect(backend.remove).toHaveBeenCalledWith('/Applications/Cleanup WS.app', `workspace:${ws.id}`)
    expect(existsSync(iconPath)).toBe(false)
    expect(onIconChanged).toHaveBeenCalledWith(iconPath)
    expect(onChanged).toHaveBeenCalledTimes(1)

    // No-op when workspace has no launcher.
    const wsNoLauncher = store.saveVaultSet('Plain WS', ['/vaults/c', '/vaults/d'], 101)!
    onIconChanged.mockClear()
    onChanged.mockClear()
    await cleanupWorkspaceLauncher(store, backend, wsNoLauncher.id, onIconChanged, onChanged)
    expect(onIconChanged).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('listAll returns vault, workspace, missing-in-Finder, and orphan items without duplicates (case-insensitive on macOS)', async () => {
    const rootA = '/Users/yasin/Vaults/Daily'
    const rootB = '/Users/yasin/Vaults/Ghost'
    store.setFolder(rootA, { name: 'Daily Notes' })
    const ws = store.saveVaultSet('All Folders', ['/vaults/a', '/vaults/b'], 100)!

    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: rootA,
      name: 'Daily Vault',
      pngBase64: VALID_PNG_B64,
      target: 'today',
    })
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: rootB,
      name: 'Ghost Vault',
      pngBase64: VALID_PNG_B64,
    })
    await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws.id,
      name: 'All Folders',
      pngBase64: VALID_PNG_B64,
    })

    // Simulate Ghost Vault deleted in Finder.
    installedApps.delete('/Applications/Ghost Vault.app')

    // Scanner returns: one matching registered launcher (with different casing on macOS),
    // plus one real orphan with vaultPath, and one orphan with null vaultPath.
    scannedApps = [
      {
        appPath: process.platform === 'darwin' ? '/Applications/daily vault.app' : '/Applications/Daily Vault.app',
        name: 'daily vault',
        info: { bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}daily`, vaultPath: rootA, vaultUrl: `yaseendocs://${rootA}` },
      },
      {
        appPath: '/Applications/All Folders.app',
        name: 'All Folders',
        info: { bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}ws`, vaultPath: `workspace:${ws.id}`, vaultUrl: `yaseendocs://workspace/${ws.id}` },
      },
      {
        appPath: '/Applications/Demo Orphan.app',
        name: 'Demo Orphan',
        info: { bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}demo`, vaultPath: '/Users/yasin/DeletedVault', vaultUrl: 'yaseendocs:///Users/yasin/DeletedVault' },
      },
      {
        appPath: '/Applications/Mystery Orphan.app',
        name: 'Mystery Orphan',
        info: { bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}mystery`, vaultPath: null, vaultUrl: null },
      },
    ]

    const res = await registered(CONTRACT.vaultLauncher.listAll)(undefined)
    expect(res).toEqual({
      ok: true,
      value: [
        {
          kind: 'vault',
          id: rootA,
          name: 'Daily Vault',
          appPath: '/Applications/Daily Vault.app',
          exists: true,
          iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
          targetName: 'Daily Notes',
          target: 'today',
        },
        {
          kind: 'vault',
          id: rootB,
          name: 'Ghost Vault',
          appPath: '/Applications/Ghost Vault.app',
          exists: false,
          iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
          targetName: 'Ghost',
        },
        {
          kind: 'workspace',
          id: ws.id,
          name: 'All Folders',
          appPath: '/Applications/All Folders.app',
          exists: true,
          iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
          targetName: 'All Folders',
        },
        {
          kind: 'orphan',
          id: '/Applications/Demo Orphan.app',
          name: 'Demo Orphan',
          appPath: '/Applications/Demo Orphan.app',
          exists: true,
          iconDataUrl: null,
          targetName: '/Users/yasin/DeletedVault',
          vaultPath: '/Users/yasin/DeletedVault',
        },
        {
          kind: 'orphan',
          id: '/Applications/Mystery Orphan.app',
          name: 'Mystery Orphan',
          appPath: '/Applications/Mystery Orphan.app',
          exists: true,
          iconDataUrl: null,
          targetName: 'Unknown target',
        },
      ],
    })

    // Unsupported backend returns [].
    vi.mocked(ipcMain.handle).mockClear()
    registerVaultLauncherIpc(store, dir, createUnsupportedVaultLauncherBackend())
    expect(await registered(CONTRACT.vaultLauncher.listAll)(undefined)).toEqual({ ok: true, value: [] })
  })

  it('removeOrphan trashes valid orphan launcher and refuses third-party .app (fails closed)', async () => {
    const validOrphan = path.join(dir, 'Old Demo.app')
    await mkdir(path.join(validOrphan, 'Contents'), { recursive: true })
    await writeFile(
      path.join(validOrphan, 'Contents', 'Info.plist'),
      buildLauncherPlist({
        name: 'Old Demo',
        bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}old-demo-abcd`,
        vaultUrl: 'yaseendocs:///Users/yasin/OldDemo',
        vaultPath: '/Users/yasin/OldDemo',
      }),
      'utf8',
    )

    const thirdParty = path.join(dir, 'Safari.app')
    await mkdir(path.join(thirdParty, 'Contents'), { recursive: true })
    await writeFile(
      path.join(thirdParty, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.Safari</string></dict></plist>',
      'utf8',
    )

    // Third-party app -> refused (fails closed), backend.remove & onChanged NOT called.
    onChanged.mockClear()
    expect(await registered(CONTRACT.vaultLauncher.removeOrphan)(undefined, thirdParty)).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    })
    expect(backend.remove).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()

    // Relative path -> NOT_ABSOLUTE.
    expect(await registered(CONTRACT.vaultLauncher.removeOrphan)(undefined, 'relative.app')).toMatchObject({
      ok: false,
      error: { code: 'NOT_ABSOLUTE' },
    })

    // Valid orphan -> trashed via backend.remove with plist vaultPath, broadcasts onChanged.
    expect(await registered(CONTRACT.vaultLauncher.removeOrphan)(undefined, validOrphan)).toEqual({ ok: true, value: undefined })
    expect(backend.remove).toHaveBeenCalledWith(validOrphan, '/Users/yasin/OldDemo')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('removeOrphan treats an already-deleted orphan bundle as gone and broadcasts onChanged (YAZ-6459)', async () => {
    const missingOrphan = path.join(dir, 'Already Deleted.app')
    onChanged.mockClear()
    vi.mocked(backend.remove).mockClear()

    expect(await registered(CONTRACT.vaultLauncher.removeOrphan)(undefined, missingOrphan)).toEqual({ ok: true, value: undefined })
    expect(backend.remove).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
