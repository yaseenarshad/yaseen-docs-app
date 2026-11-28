import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { createStore, type Store } from '../store'
import { buildLauncherPlist, LAUNCHER_BUNDLE_ID_PREFIX, LAUNCHER_BUNDLE_VERSION, type ScannedLauncher } from '../vaultLauncher'
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
let onChanged: ReturnType<typeof vi.fn<() => void>>

beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yd-vault-launcher-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  installedApps = new Set()
  scannedApps = []
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
  registerVaultLauncherIpc(store, dir, backend, onChanged)
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

  it('create writes PNG atomically, installs via backend, and persists FolderState.launcher', async () => {
    const res = await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work Docs',
      pngBase64: `data:image/png;base64,${VALID_PNG_B64}`,
      target: 'inbox',
      badge: { kind: 'emoji', value: '🚀', color: '#2563eb' },
    })

    const expectedIconPath = vaultLauncherIconPath(dir, ROOT)
    const expectedLauncher = {
      id: 'default',
      name: 'Work Docs',
      appPath: '/Applications/Work Docs.app',
      iconPath: expectedIconPath,
      target: 'inbox',
      badge: { kind: 'emoji', value: '🚀', color: '#2563eb' },
    }
    expect(res).toEqual({
      ok: true,
      value: {
        supported: true,
        launcher: expectedLauncher,
        exists: true,
        iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
        launchers: [
          {
            launcher: expectedLauncher,
            exists: true,
            iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
          },
        ],
      },
    })

    // Cached PNG was written with exact bytes.
    expect(existsSync(expectedIconPath)).toBe(true)
    expect(await readFile(expectedIconPath)).toEqual(VALID_PNG)

    // Store persisted canonical launchers list.
    expect(store.get().folders[ROOT]?.launchers).toEqual([expectedLauncher])

    // Re-creating with appId: 'default' updates in place and passes previousAppPath to backend.install.
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      appId: 'default',
      name: 'Work HQ',
      pngBase64: VALID_PNG_B64,
    })
    expect(backend.install).toHaveBeenLastCalledWith(
      expect.objectContaining({
        root: ROOT,
        appId: 'default',
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
        launcher: expect.objectContaining({ id: 'default', name: 'Work', appPath: '/Applications/Work.app' }),
        exists: false,
        iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
        launchers: [
          {
            launcher: expect.objectContaining({ id: 'default', name: 'Work', appPath: '/Applications/Work.app' }),
            exists: false,
            iconDataUrl: `data:image/png;base64,${VALID_PNG_B64}`,
          },
        ],
      },
    })
  })

  it('remove trashes existing .app, deletes cached PNG, and clears store', async () => {
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: ROOT,
      name: 'Work',
      pngBase64: VALID_PNG_B64,
    })
    const iconPath = vaultLauncherIconPath(dir, ROOT)

    expect(await registered(CONTRACT.vaultLauncher.remove)(undefined, ROOT)).toEqual({ ok: true, value: undefined })
    expect(backend.remove).toHaveBeenCalledWith('/Applications/Work.app', ROOT)
    expect(existsSync(iconPath)).toBe(false)
    expect(store.get().folders[ROOT]?.launcher).toBeUndefined()
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
    expect(await registered(CONTRACT.vaultLauncher.removeWorkspace)(undefined, ws.id)).toEqual({ ok: true, value: undefined })
    expect(backend.remove).toHaveBeenCalledWith('/Applications/Work Suite.app', `workspace:${ws.id}`)
    expect(existsSync(expectedIconPath)).toBe(false)
    expect(store.get().vaultSets.find((s) => s.id === ws.id)?.launcher).toBeUndefined()
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

  it('cleanupWorkspaceLauncher trashes .app, deletes cached PNG, and broadcasts onChanged', async () => {
    const ws = store.saveVaultSet('Cleanup WS', ['/vaults/a', '/vaults/b'], 100)!
    await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws.id,
      name: 'Cleanup WS',
      pngBase64: VALID_PNG_B64,
    })
    const iconPath = workspaceLauncherIconPath(dir, ws.id)
    expect(existsSync(iconPath)).toBe(true)

    onChanged.mockClear()
    await cleanupWorkspaceLauncher(store, backend, ws.id, onChanged)

    expect(backend.remove).toHaveBeenCalledWith('/Applications/Cleanup WS.app', `workspace:${ws.id}`)
    expect(existsSync(iconPath)).toBe(false)
    expect(onChanged).toHaveBeenCalledTimes(1)

    // No-op when workspace has no launcher.
    const wsNoLauncher = store.saveVaultSet('Plain WS', ['/vaults/c', '/vaults/d'], 101)!
    onChanged.mockClear()
    await cleanupWorkspaceLauncher(store, backend, wsNoLauncher.id, onChanged)
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
        info: {
          bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}daily`,
          vaultPath: rootA,
          vaultUrl: `yaseendocs://${rootA}`,
          bundleVersion: LAUNCHER_BUNDLE_VERSION,
        },
      },
      {
        appPath: '/Applications/All Folders.app',
        name: 'All Folders',
        info: {
          bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}ws`,
          vaultPath: `workspace:${ws.id}`,
          vaultUrl: `yaseendocs://workspace/${ws.id}`,
          bundleVersion: LAUNCHER_BUNDLE_VERSION,
        },
      },
      {
        appPath: '/Applications/Demo Orphan.app',
        name: 'Demo Orphan',
        info: {
          bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}demo`,
          vaultPath: '/Users/yasin/DeletedVault',
          vaultUrl: 'yaseendocs:///Users/yasin/DeletedVault',
          bundleVersion: LAUNCHER_BUNDLE_VERSION,
        },
      },
      {
        appPath: '/Applications/Mystery Orphan.app',
        name: 'Mystery Orphan',
        info: { bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}mystery`, vaultPath: null, vaultUrl: null, bundleVersion: null },
      },
    ]

    const res = await registered(CONTRACT.vaultLauncher.listAll)(undefined)
    expect(res).toEqual({
      ok: true,
      value: [
        {
          kind: 'vault',
          id: rootA,
          appId: 'default',
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
          appId: 'default',
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

  it('listAll falls back to scanInstalledLaunchers using YASEEN_DOCS_APP_SHIM_DIRS when backend.scan is omitted', async () => {
    const shimDir = path.join(dir, 'IsolatedShims')
    const orphanApp = path.join(shimDir, 'Env Orphan.app')
    await mkdir(path.join(orphanApp, 'Contents'), { recursive: true })
    await writeFile(
      path.join(orphanApp, 'Contents', 'Info.plist'),
      buildLauncherPlist({
        name: 'Env Orphan',
        bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}env-orphan-1234`,
        vaultUrl: 'yaseendocs:///Users/yasin/EnvOrphan',
        vaultPath: '/Users/yasin/EnvOrphan',
      }),
      'utf8',
    )

    const prevEnv = process.env.YASEEN_DOCS_APP_SHIM_DIRS
    process.env.YASEEN_DOCS_APP_SHIM_DIRS = shimDir
    try {
      vi.mocked(ipcMain.handle).mockClear()
      const { scan: _ignored, ...backendWithoutScan } = backend
      registerVaultLauncherIpc(store, dir, backendWithoutScan, onChanged)
      expect(await registered(CONTRACT.vaultLauncher.listAll)(undefined)).toEqual({
        ok: true,
        value: [
          {
            kind: 'orphan',
            id: orphanApp,
            name: 'Env Orphan',
            appPath: orphanApp,
            exists: true,
            iconDataUrl: null,
            targetName: '/Users/yasin/EnvOrphan',
            vaultPath: '/Users/yasin/EnvOrphan',
          },
        ],
      })
    } finally {
      if (prevEnv === undefined) delete process.env.YASEEN_DOCS_APP_SHIM_DIRS
      else process.env.YASEEN_DOCS_APP_SHIM_DIRS = prevEnv
    }
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

describe('synced vault & workspace launcher presets (YAZ-6560)', () => {
  it('create saves portable badge preset into .yaseendocs/settings.json preserving existing keys, remove keeps synced preset, clearSynced clears it', async () => {
    const vaultRoot = path.join(dir, 'synced-vault')
    await mkdir(path.join(vaultRoot, '.yaseendocs'), { recursive: true })
    await writeFile(
      path.join(vaultRoot, '.yaseendocs', 'settings.json'),
      JSON.stringify({ version: 1, contentWidth: 'wide', customFutureKey: true }, null, 2),
      'utf8',
    )

    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Daily Note Vault',
      pngBase64: VALID_PNG_B64,
      target: 'today',
      badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
    })

    const saved = JSON.parse(await readFile(path.join(vaultRoot, '.yaseendocs', 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(saved).toEqual({
      version: 1,
      contentWidth: 'wide',
      customFutureKey: true,
      launcher: {
        name: 'Daily Note Vault',
        target: 'today',
        badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
      },
    })
    // Badge mode must not write vault-icon.png.
    expect(existsSync(path.join(vaultRoot, '.yaseendocs', 'vault-icon.png'))).toBe(false)

    // Remove deletes only the local .app & store entry; synced preset in settings.json stays intact!
    await registered(CONTRACT.vaultLauncher.remove)(undefined, vaultRoot)
    const afterRemove = (await registered(CONTRACT.vaultLauncher.status)(undefined, vaultRoot)) as { ok: true; value: Record<string, unknown> }
    expect(afterRemove.ok).toBe(true)
    expect(afterRemove.value.launcher).toBeNull()
    expect(afterRemove.value.synced).toEqual({
      name: 'Daily Note Vault',
      target: 'today',
      badge: { kind: 'emoji', value: '📅', color: '#007AFF' },
    })
    expect(String(afterRemove.value.syncedIconDataUrl)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)

    // icons() falls back to the synced SVG data URL when no local .app exists.
    const iconsRes = (await registered(CONTRACT.vaultLauncher.icons)(undefined)) as { ok: true; value: Record<string, string> }
    expect(iconsRes.value[vaultRoot]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)

    // clearSynced drops launcher from settings.json while keeping contentWidth & customFutureKey.
    await registered(CONTRACT.vaultLauncher.clearSynced)(undefined, vaultRoot)
    const afterClear = JSON.parse(await readFile(path.join(vaultRoot, '.yaseendocs', 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(afterClear).toEqual({ version: 1, contentWidth: 'wide', customFutureKey: true })
  })

  it('custom PNG launcher writes .yaseendocs/vault-icon.png and switching to badge cleans up stale PNG', async () => {
    const vaultRoot = path.join(dir, 'custom-img-vault')
    await mkdir(vaultRoot, { recursive: true })

    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Trevor Yaseen Docs',
      pngBase64: VALID_PNG_B64,
    })

    const pngPath = path.join(vaultRoot, '.yaseendocs', 'vault-icon.png')
    expect(existsSync(pngPath)).toBe(true)
    expect(await readFile(pngPath)).toEqual(VALID_PNG)

    await registered(CONTRACT.vaultLauncher.remove)(undefined, vaultRoot)
    const status = (await registered(CONTRACT.vaultLauncher.status)(undefined, vaultRoot)) as { ok: true; value: Record<string, unknown> }
    expect(status.value.synced).toEqual({ name: 'Trevor Yaseen Docs', iconFile: 'vault-icon.png' })
    expect(status.value.syncedIconDataUrl).toBe(`data:image/png;base64,${VALID_PNG_B64}`)

    // Switching to a badge removes stale vault-icon.png.
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Trevor Yaseen Docs',
      pngBase64: VALID_PNG_B64,
      badge: { kind: 'letters', value: 'TD', color: '#0D9488' },
    })
    expect(existsSync(pngPath)).toBe(false)
  })

  it('read-only vaults skip writing settings.json/vault-icon.png and refuse clearSynced', async () => {
    const roVault = path.join(dir, 'ro-vault')
    await mkdir(path.join(roVault, '.yaseendocs'), { recursive: true })
    await writeFile(path.join(roVault, '.yaseendocs', 'read-only.json'), JSON.stringify({ on: true }), 'utf8')

    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: roVault,
      name: 'RO Vault',
      pngBase64: VALID_PNG_B64,
      badge: { kind: 'emoji', value: '🔒', color: '#475569' },
    })

    expect(existsSync(path.join(roVault, '.yaseendocs', 'settings.json'))).toBe(false)
    expect(await registered(CONTRACT.vaultLauncher.clearSynced)(undefined, roVault)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    })
  })

  it('workspace launcher badge syncs via SettingsState.workspaceLaunchers, survives removeWorkspace, and falls back in workspaceIcons', async () => {
    const ws = store.saveVaultSet('All Folders', ['/vaults/a', '/vaults/b'], 100)!

    await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws.id,
      name: 'All Folders',
      pngBase64: VALID_PNG_B64,
      badge: { kind: 'material', value: 'folder-docs', color: '#475569', svgPaths: ['M1 2h12v10H1z'] },
    })

    expect(store.get().settings.workspaceLaunchers['all folders']).toEqual({
      name: 'All Folders',
      badge: { kind: 'material', value: 'folder-docs', color: '#475569', svgPaths: ['M1 2h12v10H1z'] },
    })

    // Remove local .app on this Mac -> synced preset remains for other Macs and workspaceIcons falls back to SVG.
    await registered(CONTRACT.vaultLauncher.removeWorkspace)(undefined, ws.id)
    const wsStatus = (await registered(CONTRACT.vaultLauncher.workspaceStatus)(undefined, ws.id)) as { ok: true; value: Record<string, unknown> }
    expect(wsStatus.value.launcher).toBeNull()
    expect(wsStatus.value.synced).toEqual({
      name: 'All Folders',
      badge: { kind: 'material', value: 'folder-docs', color: '#475569', svgPaths: ['M1 2h12v10H1z'] },
    })
    expect(String(wsStatus.value.syncedIconDataUrl)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)

    const wsIcons = (await registered(CONTRACT.vaultLauncher.workspaceIcons)(undefined)) as { ok: true; value: Record<string, string> }
    expect(wsIcons.value[ws.id]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)

    // clearSyncedWorkspace removes it from SettingsState.workspaceLaunchers.
    await registered(CONTRACT.vaultLauncher.clearSyncedWorkspace)(undefined, ws.id)
    expect(store.get().settings.workspaceLaunchers['all folders']).toBeUndefined()
  })

  it('malformed settings.json skips synced write without clobbering existing vault-icon.png (YAZ-6565)', async () => {
    const vaultRoot = path.join(dir, 'corrupt-settings-vault')
    await mkdir(path.join(vaultRoot, '.yaseendocs'), { recursive: true })
    await writeFile(path.join(vaultRoot, '.yaseendocs', 'settings.json'), '{not-valid-json', 'utf8')
    await writeFile(path.join(vaultRoot, '.yaseendocs', 'vault-icon.png'), VALID_PNG)

    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Corrupt Vault',
      pngBase64: VALID_PNG_B64,
      badge: { kind: 'emoji', value: '🧪', color: '#007AFF' },
    })

    // Must not overwrite corrupt settings.json or unlink vault-icon.png.
    expect(await readFile(path.join(vaultRoot, '.yaseendocs', 'settings.json'), 'utf8')).toBe('{not-valid-json')
    expect(existsSync(path.join(vaultRoot, '.yaseendocs', 'vault-icon.png'))).toBe(true)
  })
})

describe('multiple Vault Apps per vault & sidebarStart IPC (YAZ-6681, YAZ-6682)', () => {
  it('creates multiple apps with distinct appIds and icon paths, updates/reveals/tests/removes by appId, exposes vaultApps, and prevents secondary orphans in listAll', async () => {
    const vaultRoot = path.join(dir, 'multi-app-vault')
    await mkdir(vaultRoot, { recursive: true })
    store.setFolder(vaultRoot, { name: 'Multi Vault' })

    // 1st app -> id: 'default', synced preset written to settings.json.
    const first = (await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Multi Main',
      pngBase64: VALID_PNG_B64,
      badge: { kind: 'emoji', value: '📓', color: '#2563eb' },
    })) as { ok: true; value: { launcher: { id: string; iconPath: string }; launchers: unknown[] } }
    expect(first.ok).toBe(true)
    expect(first.value.launcher.id).toBe('default')
    expect(first.value.launcher.iconPath).toBe(vaultLauncherIconPath(dir, vaultRoot))

    // 2nd app (appId omitted) -> fresh 8-char hex id, distinct icon path, sidebarStart persisted, primary synced preset untouched!
    const sidebarStart = { tab: 'focus' as const, folderKind: 'collection' as const, folderId: 'focus-1', onlyFolder: true }
    const second = (await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Multi Focus',
      pngBase64: VALID_PNG_B64,
      target: 'today',
      sidebarStart,
      badge: { kind: 'emoji', value: '🎯', color: '#16a34a' },
    })) as { ok: true; value: { launcher: { id: string; iconPath: string; sidebarStart?: unknown }; launchers: unknown[] } }
    expect(second.ok).toBe(true)
    const secId = second.value.launcher.id
    expect(secId).toMatch(/^[0-9a-f]{8}$/)
    expect(second.value.launcher.iconPath).toBe(vaultLauncherIconPath(dir, vaultRoot, secId))
    expect(second.value.launcher.sidebarStart).toEqual(sidebarStart)
    expect(second.value.launchers).toHaveLength(2)

    // Primary synced preset in .yaseendocs/settings.json stayed 'Multi Main'.
    const syncedDoc = JSON.parse(await readFile(path.join(vaultRoot, '.yaseendocs', 'settings.json'), 'utf8')) as {
      launcher?: { name?: string }
    }
    expect(syncedDoc.launcher?.name).toBe('Multi Main')

    // status(root, secId) returns secondary app as `launcher` AND both apps in `launchers`.
    const secStatus = (await registered(CONTRACT.vaultLauncher.status)(undefined, vaultRoot, secId)) as {
      ok: true
      value: { launcher: { id: string; name: string }; launchers: Array<{ launcher: { id: string } }> }
    }
    expect(secStatus.ok).toBe(true)
    expect(secStatus.value.launcher.id).toBe(secId)
    expect(secStatus.value.launcher.name).toBe('Multi Focus')
    expect(secStatus.value.launchers.map((x) => x.launcher.id)).toEqual(['default', secId])

    // reveal & test target the requested appId.
    await registered(CONTRACT.vaultLauncher.reveal)(undefined, vaultRoot, secId)
    expect(backend.reveal).toHaveBeenLastCalledWith('/Applications/Multi Focus.app')
    await registered(CONTRACT.vaultLauncher.test)(undefined, vaultRoot, secId)
    expect(backend.launch).toHaveBeenLastCalledWith('/Applications/Multi Focus.app')

    // vaultApps returns compact summaries keyed by vault root.
    const appsRes = await registered(CONTRACT.vaultLauncher.vaultApps)(undefined)
    expect(appsRes).toEqual({
      ok: true,
      value: {
        [vaultRoot]: [
          { id: 'default', name: 'Multi Main' },
          { id: secId, name: 'Multi Focus', target: 'today', sidebarStart },
        ],
      },
    })

    // listAll emits both apps with appId & sidebarStart and does NOT classify secondary app as an orphan.
    scannedApps = [
      {
        appPath: '/Applications/Multi Main.app',
        name: 'Multi Main',
        info: { bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}m1`, vaultPath: vaultRoot, vaultUrl: `yaseendocs://${vaultRoot}`, bundleVersion: 3 },
      },
      {
        appPath: '/Applications/Multi Focus.app',
        name: 'Multi Focus',
        info: { bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}m2`, vaultPath: vaultRoot, vaultUrl: `yaseendocs://${vaultRoot}?open=today`, bundleVersion: 3, appId: secId },
      },
    ]
    const listed = (await registered(CONTRACT.vaultLauncher.listAll)(undefined)) as { ok: true; value: Array<Record<string, unknown>> }
    expect(listed.ok).toBe(true)
    expect(listed.value).toHaveLength(2)
    expect(listed.value.map((item) => [item.kind, item.appId, item.name])).toEqual([
      ['vault', 'default', 'Multi Main'],
      ['vault', secId, 'Multi Focus'],
    ])
    expect(listed.value[1].sidebarStart).toEqual(sidebarStart)

    // Updating secondary app by appId passes its previousAppPath and preserves lastBounds.
    store.setVaultLauncherBounds(vaultRoot, secId, { x: 100, y: 120, width: 900, height: 650 })
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      appId: secId,
      name: 'Multi Focus Renamed',
      pngBase64: VALID_PNG_B64,
      target: 'today',
      sidebarStart,
    })
    expect(backend.install).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appId: secId,
        previousAppPath: '/Applications/Multi Focus.app',
      }),
    )
    expect(store.get().folders[vaultRoot]?.launchers?.find((l) => l.id === secId)?.lastBounds).toEqual({
      x: 100,
      y: 120,
      width: 900,
      height: 650,
    })

    // Removing secondary app leaves primary intact and deletes only secondary icon.
    await registered(CONTRACT.vaultLauncher.remove)(undefined, vaultRoot, secId)
    expect(existsSync(vaultLauncherIconPath(dir, vaultRoot, secId))).toBe(false)
    expect(existsSync(vaultLauncherIconPath(dir, vaultRoot))).toBe(true)
    expect(store.get().folders[vaultRoot]?.launchers?.map((l) => l.id)).toEqual(['default'])
  })

  it('persists sidebarStart on workspace apps and rejects invalid sidebarStart / appId', async () => {
    const ws = store.saveVaultSet('Start Suite', ['/vaults/a', '/vaults/b'], 100)!
    const wsStart = { tab: 'favorites' as const, folderKind: 'disk' as const, folderPath: 'Specs', onlyFolder: true }

    const res = await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws.id,
      name: 'Start Suite',
      pngBase64: VALID_PNG_B64,
      sidebarStart: wsStart,
    })
    expect(res).toMatchObject({ ok: true, value: { launcher: { sidebarStart: wsStart } } })
    expect(store.get().vaultSets.find((s) => s.id === ws.id)?.launcher?.sidebarStart).toEqual(wsStart)

    // Rejects invalid sidebarStart and invalid appId.
    expect(
      await registered(CONTRACT.vaultLauncher.create)(undefined, {
        root: '/Users/yasin/Vaults/Bad',
        name: 'Bad',
        pngBase64: VALID_PNG_B64,
        sidebarStart: { tab: 'invalid-lens' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(
      await registered(CONTRACT.vaultLauncher.status)(undefined, '/Users/yasin/Vaults/Bad', '../bad'),
    ).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
  })

  it('YAZ-6743: syncs multiple Vault Apps + per-app icons + portable sidebarStart in settings.json and workspace sidebarStart in settings', async () => {
    const vaultRoot = path.join(dir, 'sync-multi-vault')
    await mkdir(vaultRoot, { recursive: true })

    // 1st app (badge + disk Start View with machine-local folderRoot stripped in settings.json)
    await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Work Main',
      pngBase64: VALID_PNG_B64,
      badge: { kind: 'emoji', value: '💼', color: '#2563eb' },
      sidebarStart: { tab: 'files', folderKind: 'disk', folderPath: 'Projects', folderRoot: vaultRoot, onlyFolder: true },
    })

    // 2nd app (custom PNG + focus Start View)
    const second = (await registered(CONTRACT.vaultLauncher.create)(undefined, {
      root: vaultRoot,
      name: 'Work Daily',
      pngBase64: VALID_PNG_B64,
      target: 'today',
      sidebarStart: { tab: 'focus', folderKind: 'collection', folderId: 'focus-2', onlyFolder: true },
    })) as { ok: true; value: { launcher: { id: string } } }
    const secId = second.value.launcher.id

    const settingsDoc = JSON.parse(await readFile(path.join(vaultRoot, '.yaseendocs', 'settings.json'), 'utf8')) as {
      launcher?: Record<string, unknown>
      vaultApps?: Array<Record<string, unknown>>
    }
    expect(settingsDoc.launcher).toMatchObject({
      name: 'Work Main',
      sidebarStart: { tab: 'files', folderKind: 'disk', folderPath: 'Projects', onlyFolder: true },
    })
    expect((settingsDoc.launcher?.sidebarStart as Record<string, unknown>)?.folderRoot).toBeUndefined()
    expect(settingsDoc.vaultApps).toHaveLength(2)
    expect(settingsDoc.vaultApps?.[1]).toEqual({
      id: secId,
      name: 'Work Daily',
      target: 'today',
      iconFile: `vault-icon-${secId}.png`,
      sidebarStart: { tab: 'focus', folderKind: 'collection', folderId: 'focus-2', onlyFolder: true },
    })
    expect(existsSync(path.join(vaultRoot, '.yaseendocs', `vault-icon-${secId}.png`))).toBe(true)

    // Remove local apps (simulate Mac #2 with 0 installed apps) -> status returns BOTH in syncedApps with previews.
    await registered(CONTRACT.vaultLauncher.remove)(undefined, vaultRoot, 'default')
    await registered(CONTRACT.vaultLauncher.remove)(undefined, vaultRoot, secId)
    const mac2Status = (await registered(CONTRACT.vaultLauncher.status)(undefined, vaultRoot)) as {
      ok: true
      value: { syncedApps?: Array<{ preset: { id?: string; name: string; sidebarStart?: unknown }; iconDataUrl: string | null }> }
    }
    expect(mac2Status.value.syncedApps).toHaveLength(2)
    expect(mac2Status.value.syncedApps?.[0].iconDataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(mac2Status.value.syncedApps?.[1].iconDataUrl).toBe(`data:image/png;base64,${VALID_PNG_B64}`)

    // clearSynced(root, secId) removes ONLY the 2nd app and its custom PNG, keeping Work Main.
    await registered(CONTRACT.vaultLauncher.clearSynced)(undefined, vaultRoot, secId)
    expect(existsSync(path.join(vaultRoot, '.yaseendocs', `vault-icon-${secId}.png`))).toBe(false)
    const afterSingleClear = (await registered(CONTRACT.vaultLauncher.status)(undefined, vaultRoot)) as {
      ok: true
      value: { syncedApps?: Array<{ preset: { name: string } }> }
    }
    expect(afterSingleClear.value.syncedApps?.map((x) => x.preset.name)).toEqual(['Work Main'])

    // Workspace badge + sidebarStart syncs in SettingsState.workspaceLaunchers.
    const ws = store.saveVaultSet('Synced WS', ['/vaults/a', '/vaults/b'], 100)!
    const wsStart = { tab: 'favorites' as const, folderKind: 'collection' as const, folderId: 'fav-1', onlyFolder: true }
    await registered(CONTRACT.vaultLauncher.createWorkspace)(undefined, {
      workspaceId: ws.id,
      name: 'Synced WS',
      pngBase64: VALID_PNG_B64,
      badge: { kind: 'letters', value: 'SW', color: '#0D9488' },
      sidebarStart: wsStart,
    })
    expect(store.get().settings.workspaceLaunchers['synced ws']).toEqual({
      name: 'Synced WS',
      badge: { kind: 'letters', value: 'SW', color: '#0D9488' },
      sidebarStart: wsStart,
    })
  })
})
