import { execFile as nodeExecFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_SHIM_EXECUTABLE,
  APP_SHIM_HOST_ARG,
  APP_SHIM_HOST_BUNDLE_ID,
  appShimLoaderPath,
  buildLauncherPlist,
  encodeIcnsFromPng,
  hostBundlePathFromExecPath,
  installVaultLauncher,
  LAUNCHER_BUNDLE_ID_PREFIX,
  LAUNCHER_BUNDLE_VERSION,
  launcherBundleId,
  LSREGISTER_PATH,
  MAX_BUNDLE_NAME_LENGTH,
  pickApplicationsDir,
  readLauncherPlist,
  refreshOutdatedLaunchers,
  removeOrphanLauncher,
  removeVaultLauncher,
  resolveLauncherAppDirs,
  sanitizeBundleName,
  scanInstalledLaunchers,
} from './vaultLauncher'

const execFileAsync = promisify(nodeExecFile)

const requireFromHere = createRequire(import.meta.url)
const REAL_APP_SHIM_LOADER = join(
  dirname(requireFromHere.resolve('electron/package.json')),
  'dist',
  'Electron.app',
  'Contents',
  'Frameworks',
  'Electron Framework.framework',
  'Helpers',
  APP_SHIM_EXECUTABLE,
)

/** Minimal valid PNG header + IHDR-like payload for unit tests. */
const FAKE_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-512x512-body'),
])

describe('encodeIcnsFromPng', () => {
  it('writes a valid icns container header and ic09 chunk wrapping the PNG bytes', () => {
    const icns = encodeIcnsFromPng(FAKE_PNG)
    expect(icns.length).toBe(16 + FAKE_PNG.length)
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    expect(icns.subarray(8, 12).toString('ascii')).toBe('ic09')
    expect(icns.readUInt32BE(12)).toBe(8 + FAKE_PNG.length)
    expect(icns.subarray(16).equals(FAKE_PNG)).toBe(true)
  })

  it('rejects non-PNG or empty buffers', () => {
    expect(() => encodeIcnsFromPng(Buffer.alloc(0))).toThrow(/valid PNG/)
    expect(() => encodeIcnsFromPng(Buffer.from('not a png'))).toThrow(/valid PNG/)
  })
})

describe('appShimLoaderPath, hostBundlePathFromExecPath, resolveLauncherAppDirs', () => {
  it('resolves app_shim_loader and host bundle root from both packaged and dev execPaths', () => {
    const packagedExec = '/Applications/Yaseen Docs.app/Contents/MacOS/Yaseen Docs'
    expect(appShimLoaderPath(packagedExec)).toBe(
      '/Applications/Yaseen Docs.app/Contents/Frameworks/Electron Framework.framework/Helpers/app_shim_loader',
    )
    expect(hostBundlePathFromExecPath(packagedExec)).toBe('/Applications/Yaseen Docs.app')

    const devExec = '/repo/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    expect(appShimLoaderPath(devExec)).toBe(
      '/repo/desktop/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Helpers/app_shim_loader',
    )
    expect(hostBundlePathFromExecPath(devExec)).toBe('/repo/desktop/node_modules/electron/dist/Electron.app')
  })

  it('resolves default Applications dirs and honors colon-separated YASEEN_DOCS_APP_SHIM_DIRS', () => {
    expect(resolveLauncherAppDirs({})).toEqual(['/Applications', join(homedir(), 'Applications')])
    expect(resolveLauncherAppDirs({ YASEEN_DOCS_APP_SHIM_DIRS: '' })).toEqual(['/Applications', join(homedir(), 'Applications')])
    expect(resolveLauncherAppDirs({ YASEEN_DOCS_APP_SHIM_DIRS: ' :  : ' })).toEqual(['/Applications', join(homedir(), 'Applications')])
    expect(resolveLauncherAppDirs({ YASEEN_DOCS_APP_SHIM_DIRS: '/tmp/shims-a: /tmp/shims-b ::/tmp/shims-c ' })).toEqual([
      '/tmp/shims-a',
      '/tmp/shims-b',
      '/tmp/shims-c',
    ])
  })

  it('uses resolveLauncherAppDirs() by default in pickApplicationsDir and scanInstalledLaunchers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yd-env-dirs-'))
    const envDir = join(root, 'IsolatedApps')
    const prev = process.env.YASEEN_DOCS_APP_SHIM_DIRS
    process.env.YASEEN_DOCS_APP_SHIM_DIRS = envDir
    try {
      expect(await pickApplicationsDir()).toBe(envDir)

      const fakeBin = join(root, APP_SHIM_EXECUTABLE)
      await writeFile(fakeBin, '#!/bin/sh\nexit 0\n', 'utf8')
      const res = await installVaultLauncher(
        { name: 'EnvVault', vaultPath: '/Users/me/EnvVault', iconPng: FAKE_PNG, binaryPath: fakeBin },
        { trashItem: async () => {}, execFile: async () => {} },
      )
      expect(res.appPath).toBe(join(envDir, 'EnvVault.app'))

      const scanned = await scanInstalledLaunchers()
      expect(scanned.map((s) => s.appPath)).toEqual([res.appPath])
    } finally {
      if (prev === undefined) delete process.env.YASEEN_DOCS_APP_SHIM_DIRS
      else process.env.YASEEN_DOCS_APP_SHIM_DIRS = prev
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('sanitizeBundleName', () => {
  it('preserves normal names with spaces and unicode', () => {
    expect(sanitizeBundleName('  Work Vault 📓  ')).toBe('Work Vault 📓')
  })

  it('strips slashes, colons, control chars, leading dots, and trailing .app', () => {
    expect(sanitizeBundleName('foo/bar:baz')).toBe('foo bar baz')
    expect(sanitizeBundleName('...hidden')).toBe('hidden')
    expect(sanitizeBundleName('../etc/passwd')).toBe('etc passwd')
    expect(sanitizeBundleName('My Notes.app')).toBe('My Notes')
    expect(sanitizeBundleName('a\x00b\nc')).toBe('a b c')
  })

  it('truncates to MAX_BUNDLE_NAME_LENGTH characters', () => {
    const long = 'A'.repeat(120)
    expect(sanitizeBundleName(long)).toHaveLength(MAX_BUNDLE_NAME_LENGTH)
  })

  it('throws on empty, whitespace-only, or dots-only names', () => {
    expect(() => sanitizeBundleName('')).toThrow(/cannot be empty/)
    expect(() => sanitizeBundleName('   ')).toThrow(/cannot be empty/)
    expect(() => sanitizeBundleName('...')).toThrow(/cannot be empty/)
    expect(() => sanitizeBundleName('/::/')).toThrow(/cannot be empty/)
    expect(() => sanitizeBundleName('.app')).toThrow(/cannot be empty/)
  })
})

describe('launcherBundleId & buildLauncherPlist (v3 App Shim)', () => {
  it('writes v3 App Shim keys without LSUIElement, omits empty serverName, and round-trips XML special chars', async () => {
    expect(LAUNCHER_BUNDLE_VERSION).toBe(3)
    const id1 = launcherBundleId('/Users/me/Vault/', 'Work & Play')
    const id2 = launcherBundleId('/Users/me/Vault', 'Work & Play')
    expect(id1).toBe(id2)
    expect(id1.startsWith(LAUNCHER_BUNDLE_ID_PREFIX)).toBe(true)
    expect(id1).toMatch(/^com\.yasinarshad\.yaseendocs\.launcher\.[a-z0-9-]+$/)

    const tmp = await mkdtemp(join(tmpdir(), 'yd-plist-'))
    try {
      const appPath = join(tmp, 'Test.app')
      await mkdir(join(appPath, 'Contents'), { recursive: true })
      const xml = buildLauncherPlist({
        name: 'A & B <Vault>',
        bundleId: id1,
        vaultUrl: 'yaseendocs:///Users/me/A%20%26%20B?open=today',
        vaultPath: '/Users/me/A & B',
      })
      expect(xml).not.toContain('LSUIElement')
      expect(xml).toContain(`<key>CFBundleExecutable</key>\n  <string>${APP_SHIM_EXECUTABLE}</string>`)
      expect(xml).toContain('<key>CFBundleIconFile</key>\n  <string>AppIcon</string>')
      expect(xml).toContain(`<key>CFBundleVersion</key>\n  <string>${LAUNCHER_BUNDLE_VERSION}</string>`)
      expect(xml).toContain('<key>NSHighResolutionCapable</key>\n  <true/>')
      expect(xml).toContain('<key>ElectronAppShimHostPath</key>\n  <string>/Applications/Yaseen Docs.app</string>')
      expect(xml).toContain(`<key>ElectronAppShimHostBundleIdentifier</key>\n  <string>${APP_SHIM_HOST_BUNDLE_ID}</string>`)
      expect(xml).toContain(
        `<key>ElectronAppShimHostArguments</key>\n  <array>\n    <string>${APP_SHIM_HOST_ARG}</string>\n  </array>`,
      )
      expect(xml).not.toContain('ElectronAppShimServerName')

      await writeFile(join(appPath, 'Contents', 'Info.plist'), xml, 'utf8')
      expect(await readLauncherPlist(appPath)).toEqual({
        bundleId: id1,
        vaultPath: '/Users/me/A & B',
        vaultUrl: 'yaseendocs:///Users/me/A%20%26%20B?open=today',
        bundleVersion: LAUNCHER_BUNDLE_VERSION,
        displayName: 'A & B <Vault>',
        hostPath: '/Applications/Yaseen Docs.app',
        hostBundleId: APP_SHIM_HOST_BUNDLE_ID,
        serverName: null,
      })

      // Custom hostBundlePath, hostBundleId, and serverName.
      const customXml = buildLauncherPlist({
        name: 'Dev Vault',
        bundleId: id1,
        vaultUrl: 'yaseendocs:///Users/me/Dev',
        vaultPath: '/Users/me/Dev',
        hostBundlePath: '/tmp/Dev & Test/Electron.app',
        hostBundleId: 'com.github.Electron',
        serverName: 'isolated-demo-1',
      })
      expect(customXml).toContain('<key>ElectronAppShimServerName</key>\n  <string>isolated-demo-1</string>')
      await writeFile(join(appPath, 'Contents', 'Info.plist'), customXml, 'utf8')
      expect(await readLauncherPlist(appPath)).toEqual({
        bundleId: id1,
        vaultPath: '/Users/me/Dev',
        vaultUrl: 'yaseendocs:///Users/me/Dev',
        bundleVersion: LAUNCHER_BUNDLE_VERSION,
        displayName: 'Dev Vault',
        hostPath: '/tmp/Dev & Test/Electron.app',
        hostBundleId: 'com.github.Electron',
        serverName: 'isolated-demo-1',
      })

      // Empty serverName string is omitted.
      const emptyServerXml = buildLauncherPlist({
        name: 'EmptyServer',
        bundleId: id1,
        vaultUrl: 'yaseendocs:///Users/me/Empty',
        vaultPath: '/Users/me/Empty',
        serverName: '',
      })
      expect(emptyServerXml).not.toContain('ElectronAppShimServerName')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('installVaultLauncher & removeVaultLauncher', () => {
  let root: string
  let primaryApps: string
  let fallbackApps: string
  let fakeBinary: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'yd-launcher-'))
    primaryApps = join(root, 'Applications')
    fallbackApps = join(root, 'UserApplications')
    await mkdir(primaryApps, { recursive: true })
    fakeBinary = join(root, APP_SHIM_EXECUTABLE)
    await writeFile(fakeBinary, '#!/bin/sh\nexit 0\n', 'utf8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('installs a complete v3 .app bundle with app_shim_loader, signs it, and runs lsregister', async () => {
    const execCalls: Array<[string, readonly string[]]> = []
    const trashItem = vi.fn(async () => {})

    const res = await installVaultLauncher(
      {
        name: 'Personal',
        vaultPath: '/Users/me/Personal/',
        iconPng: FAKE_PNG,
        openTarget: 'inbox',
        binaryPath: fakeBinary,
        hostBundlePath: '/Applications/Yaseen Docs.app',
        serverName: 'test-srv',
      },
      {
        appDirs: [primaryApps, fallbackApps],
        trashItem,
        signIdentity: 'Yaseen Local Signing',
        execFile: async (file, args) => {
          execCalls.push([file, args])
        },
      },
    )

    expect(res.appPath).toBe(join(primaryApps, 'Personal.app'))
    expect(res.name).toBe('Personal')
    expect(res.bundleId.startsWith(LAUNCHER_BUNDLE_ID_PREFIX)).toBe(true)
    expect(res.vaultUrl).toBe('yaseendocs:///Users/me/Personal?open=inbox')

    // Binary is copied as app_shim_loader and executable.
    expect(await readdir(join(res.appPath, 'Contents', 'MacOS'))).toEqual([APP_SHIM_EXECUTABLE])
    const binStat = await stat(join(res.appPath, 'Contents', 'MacOS', APP_SHIM_EXECUTABLE))
    expect(binStat.mode & 0o111).toBeGreaterThan(0)

    // AppIcon.icns is valid.
    const icns = await readFile(join(res.appPath, 'Contents', 'Resources', 'AppIcon.icns'))
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.subarray(8, 12).toString('ascii')).toBe('ic09')

    // Info.plist has expected v3 App Shim fields and no LSUIElement.
    const rawPlist = await readFile(join(res.appPath, 'Contents', 'Info.plist'), 'utf8')
    expect(rawPlist).not.toContain('LSUIElement')
    expect(await readLauncherPlist(res.appPath)).toEqual({
      bundleId: res.bundleId,
      vaultPath: '/Users/me/Personal',
      vaultUrl: 'yaseendocs:///Users/me/Personal?open=inbox',
      bundleVersion: LAUNCHER_BUNDLE_VERSION,
      displayName: 'Personal',
      hostPath: '/Applications/Yaseen Docs.app',
      hostBundleId: APP_SHIM_HOST_BUNDLE_ID,
      serverName: 'test-srv',
    })

    // codesign ran with custom signIdentity on staged temp bundle, lsregister ran on final target.
    expect(execCalls).toHaveLength(2)
    expect(execCalls[0][0]).toBe('codesign')
    expect(execCalls[0][1].slice(0, 3)).toEqual(['--force', '--sign', 'Yaseen Local Signing'])
    expect(execCalls[0][1][3]).toContain('.yaseen-launcher-tmp-')
    expect(execCalls[1]).toEqual([LSREGISTER_PATH, ['-f', res.appPath]])

    // No temp staging dirs left behind.
    expect(await readdir(primaryApps)).toEqual(['Personal.app'])
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('defaults codesign identity to ad-hoc "-" when signIdentity is omitted', async () => {
    const execCalls: Array<[string, readonly string[]]> = []
    await installVaultLauncher(
      { name: 'DefaultSign', vaultPath: '/Users/me/DefaultSign', iconPng: FAKE_PNG, binaryPath: fakeBinary },
      {
        appDirs: [primaryApps],
        trashItem: async () => {},
        execFile: async (file, args) => {
          execCalls.push([file, args])
        },
      },
    )
    expect(execCalls[0][0]).toBe('codesign')
    expect(execCalls[0][1].slice(0, 3)).toEqual(['--force', '--sign', '-'])
  })

  it('falls back to ~/Applications (creating it if missing) when primary dir is not writable', async () => {
    const res = await installVaultLauncher(
      {
        name: 'Work',
        vaultPath: '/Users/me/Work',
        iconPng: FAKE_PNG,
        binaryPath: fakeBinary,
      },
      {
        appDirs: [primaryApps, fallbackApps],
        isWritable: async (dir) => dir === fallbackApps,
        trashItem: async () => {},
        execFile: async () => {},
      },
    )
    expect(res.appPath).toBe(join(fallbackApps, 'Work.app'))
    expect(await readdir(fallbackApps)).toEqual(['Work.app'])
  })

  it('throws when no Applications directory is writable', async () => {
    await expect(pickApplicationsDir([primaryApps, fallbackApps], async () => false)).rejects.toThrow(/No writable Applications folder/)
  })

  it('replaces an existing launcher for the same vault atomically without leaving backups', async () => {
    const deps = {
      appDirs: [primaryApps],
      trashItem: vi.fn(async () => {}),
      execFile: async () => {},
    }
    const first = await installVaultLauncher({ name: 'Notes', vaultPath: '/Users/me/Notes', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps)
    const second = await installVaultLauncher(
      { name: 'Notes', vaultPath: '/Users/me/Notes', iconPng: FAKE_PNG, openTarget: 'today', binaryPath: fakeBinary },
      deps,
    )
    expect(second.appPath).toBe(first.appPath)
    expect(await readLauncherPlist(second.appPath)).toMatchObject({ vaultUrl: 'yaseendocs:///Users/me/Notes?open=today' })
    expect(await readdir(primaryApps)).toEqual(['Notes.app'])
    expect(deps.trashItem).not.toHaveBeenCalled()
  })

  it('collision guard refuses to overwrite a third-party app or another vault launcher', async () => {
    const deps = {
      appDirs: [primaryApps],
      trashItem: vi.fn(async () => {}),
      execFile: async () => {},
    }

    // Third-party app (different CFBundleIdentifier).
    const thirdParty = join(primaryApps, 'Safari.app')
    await mkdir(join(thirdParty, 'Contents'), { recursive: true })
    await writeFile(
      join(thirdParty, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.Safari</string></dict></plist>',
      'utf8',
    )
    await expect(
      installVaultLauncher({ name: 'Safari', vaultPath: '/Users/me/VaultA', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps),
    ).rejects.toThrow(/Cannot overwrite/)

    // Another vault's launcher.
    await installVaultLauncher({ name: 'SharedName', vaultPath: '/Users/me/VaultA', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps)
    await expect(
      installVaultLauncher({ name: 'SharedName', vaultPath: '/Users/me/VaultB', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps),
    ).rejects.toThrow(/Cannot overwrite/)
  })

  it('rename cleanup trashes the old .app after writing the new one, and ignores unrelated previousAppPath', async () => {
    const trashItem = vi.fn(async () => {})
    const deps = { appDirs: [primaryApps], trashItem, execFile: async () => {} }

    const first = await installVaultLauncher({ name: 'OldName', vaultPath: '/Users/me/VaultA', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps)
    const renamed = await installVaultLauncher(
      { name: 'NewName', vaultPath: '/Users/me/VaultA', iconPng: FAKE_PNG, previousAppPath: first.appPath, binaryPath: fakeBinary },
      deps,
    )
    expect(renamed.appPath).toBe(join(primaryApps, 'NewName.app'))
    expect(trashItem).toHaveBeenCalledTimes(1)
    expect(trashItem).toHaveBeenCalledWith(first.appPath)

    // Unrelated third-party app passed as previousAppPath must never be trashed.
    const thirdParty = join(primaryApps, 'Other.app')
    await mkdir(join(thirdParty, 'Contents'), { recursive: true })
    await writeFile(
      join(thirdParty, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.other.app</string></dict></plist>',
      'utf8',
    )
    trashItem.mockClear()
    await installVaultLauncher(
      { name: 'NewName2', vaultPath: '/Users/me/VaultA', iconPng: FAKE_PNG, previousAppPath: thirdParty, binaryPath: fakeBinary },
      deps,
    )
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('does NOT trash the new bundle on a case-only rename on macOS, while still trashing on real rename (YAZ-6447 D2)', async () => {
    const trashItem = vi.fn(async () => {})
    const deps = { appDirs: [primaryApps], trashItem, execFile: async () => {}, platform: 'darwin' as const }

    const first = await installVaultLauncher(
      { name: 'all folders', vaultPath: 'workspace:ws-1', vaultUrl: 'yaseendocs://workspace/ws-1', iconPng: FAKE_PNG, binaryPath: fakeBinary },
      deps,
    )
    expect(first.appPath).toBe(join(primaryApps, 'all folders.app'))

    // Case-only rename: `all folders.app` -> `All Folders.app` must NOT call trashItem.
    const recased = await installVaultLauncher(
      {
        name: 'All Folders',
        vaultPath: 'workspace:ws-1',
        vaultUrl: 'yaseendocs://workspace/ws-1',
        iconPng: FAKE_PNG,
        previousAppPath: first.appPath,
        binaryPath: fakeBinary,
      },
      deps,
    )
    expect(recased.appPath).toBe(join(primaryApps, 'All Folders.app'))
    expect(trashItem).not.toHaveBeenCalled()
    expect(await readLauncherPlist(recased.appPath)).toMatchObject({ vaultPath: 'workspace:ws-1' })

    // Real rename: `All Folders.app` -> `Every Folder.app` still trashes the old bundle.
    const renamed = await installVaultLauncher(
      {
        name: 'Every Folder',
        vaultPath: 'workspace:ws-1',
        vaultUrl: 'yaseendocs://workspace/ws-1',
        iconPng: FAKE_PNG,
        previousAppPath: recased.appPath,
        binaryPath: fakeBinary,
      },
      deps,
    )
    expect(renamed.appPath).toBe(join(primaryApps, 'Every Folder.app'))
    expect(trashItem).toHaveBeenCalledTimes(1)
    expect(trashItem).toHaveBeenCalledWith(recased.appPath)
  })

  it('scanInstalledLaunchers finds Yaseen Docs launchers and ignores third-party apps and hidden staging dirs', async () => {
    const deps = { appDirs: [primaryApps], trashItem: async () => {}, execFile: async () => {} }
    await mkdir(fallbackApps, { recursive: true })

    // Install one vault launcher in primaryApps and one workspace launcher in fallbackApps.
    const vaultRes = await installVaultLauncher({ name: 'Daily', vaultPath: '/Users/me/Daily', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps)
    const wsRes = await installVaultLauncher(
      { name: 'Work Suite', vaultPath: 'workspace:ws-7', vaultUrl: 'yaseendocs://workspace/ws-7', iconPng: FAKE_PNG, binaryPath: fakeBinary },
      { ...deps, appDirs: [fallbackApps] },
    )

    // Add a third-party app, a hidden temp bundle, and a non-app file.
    const thirdParty = join(primaryApps, 'Safari.app')
    await mkdir(join(thirdParty, 'Contents'), { recursive: true })
    await writeFile(
      join(thirdParty, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.Safari</string></dict></plist>',
      'utf8',
    )
    const hiddenTmp = join(primaryApps, '.yaseen-launcher-tmp-123.app')
    await mkdir(join(hiddenTmp, 'Contents'), { recursive: true })
    await writeFile(
      join(hiddenTmp, 'Contents', 'Info.plist'),
      buildLauncherPlist({ name: 'Tmp', bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}tmp`, vaultUrl: 'yaseendocs:///tmp', vaultPath: '/tmp' }),
      'utf8',
    )
    await writeFile(join(primaryApps, 'README.txt'), 'not an app', 'utf8')

    const missingDir = join(root, 'DoesNotExist')
    const found = await scanInstalledLaunchers([primaryApps, fallbackApps, missingDir])
    expect(found).toEqual([
      {
        appPath: vaultRes.appPath,
        name: 'Daily',
        info: {
          bundleId: vaultRes.bundleId,
          vaultPath: '/Users/me/Daily',
          vaultUrl: 'yaseendocs:///Users/me/Daily',
          bundleVersion: LAUNCHER_BUNDLE_VERSION,
          displayName: 'Daily',
          hostPath: '/Applications/Yaseen Docs.app',
          hostBundleId: APP_SHIM_HOST_BUNDLE_ID,
          serverName: null,
        },
      },
      {
        appPath: wsRes.appPath,
        name: 'Work Suite',
        info: {
          bundleId: wsRes.bundleId,
          vaultPath: 'workspace:ws-7',
          vaultUrl: 'yaseendocs://workspace/ws-7',
          bundleVersion: LAUNCHER_BUNDLE_VERSION,
          displayName: 'Work Suite',
          hostPath: '/Applications/Yaseen Docs.app',
          hostBundleId: APP_SHIM_HOST_BUNDLE_ID,
          serverName: null,
        },
      },
    ])
  })

  it('removeOrphanLauncher trashes valid Yaseen Docs launchers, returns false when gone, and fails closed on third-party apps', async () => {
    const trashItem = vi.fn(async () => {})
    const deps = { appDirs: [primaryApps], trashItem, execFile: async () => {} }
    const orphan = await installVaultLauncher({ name: 'Orphan', vaultPath: '/Users/me/Old', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps)

    await expect(removeOrphanLauncher(orphan.appPath, { trashItem })).resolves.toBe(true)
    expect(trashItem).toHaveBeenCalledWith(orphan.appPath)

    // Missing bundle -> false.
    await expect(removeOrphanLauncher(join(primaryApps, 'Missing.app'), { trashItem })).resolves.toBe(false)

    // Third-party app -> refused (fails closed).
    const thirdParty = join(primaryApps, 'Calendar.app')
    await mkdir(join(thirdParty, 'Contents'), { recursive: true })
    await writeFile(
      join(thirdParty, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.iCal</string></dict></plist>',
      'utf8',
    )
    trashItem.mockClear()
    await expect(removeOrphanLauncher(thirdParty, { trashItem })).rejects.toThrow(/Refusing to remove/)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('cleans up temp staging dir and preserves existing bundle if codesign fails', async () => {
    const deps = { appDirs: [primaryApps], trashItem: vi.fn(async () => {}), execFile: async () => {} }
    const first = await installVaultLauncher({ name: 'Stable', vaultPath: '/Users/me/Stable', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps)

    await expect(
      installVaultLauncher(
        { name: 'Stable', vaultPath: '/Users/me/Stable', iconPng: FAKE_PNG, openTarget: 'inbox', binaryPath: fakeBinary },
        {
          ...deps,
          execFile: async (file) => {
            if (file === 'codesign') throw new Error('codesign failed')
          },
        },
      ),
    ).rejects.toThrow(/codesign failed/)

    // Old bundle untouched and no temp dirs left.
    expect(await readdir(primaryApps)).toEqual(['Stable.app'])
    expect(await readLauncherPlist(first.appPath)).toMatchObject({ vaultUrl: 'yaseendocs:///Users/me/Stable' })
  })

  it('ignores lsregister failures (best-effort)', async () => {
    const res = await installVaultLauncher(
      { name: 'BestEffort', vaultPath: '/Users/me/BestEffort', iconPng: FAKE_PNG, binaryPath: fakeBinary },
      {
        appDirs: [primaryApps],
        trashItem: async () => {},
        execFile: async (file) => {
          if (file === LSREGISTER_PATH) throw new Error('lsregister unavailable')
        },
      },
    )
    expect(res.appPath).toBe(join(primaryApps, 'BestEffort.app'))
  })

  it('removeVaultLauncher verifies bundle id and vault path before trashing', async () => {
    const trashItem = vi.fn(async () => {})
    const deps = { appDirs: [primaryApps], trashItem, execFile: async () => {} }
    const installed = await installVaultLauncher({ name: 'Removable', vaultPath: '/Users/me/VaultA', iconPng: FAKE_PNG, binaryPath: fakeBinary }, deps)

    // Wrong vault path -> refused.
    await expect(removeVaultLauncher(installed.appPath, '/Users/me/VaultB', { trashItem })).rejects.toThrow(/Refusing to remove/)
    expect(trashItem).not.toHaveBeenCalled()

    // Right vault path -> trashed.
    await expect(removeVaultLauncher(installed.appPath, '/Users/me/VaultA/', { trashItem })).resolves.toBe(true)
    expect(trashItem).toHaveBeenCalledWith(installed.appPath)

    // Missing path -> false.
    await expect(removeVaultLauncher(join(primaryApps, 'Gone.app'), '/Users/me/VaultA', { trashItem })).resolves.toBe(false)

    // Third-party app -> refused.
    const thirdParty = join(primaryApps, 'Notes.app')
    await mkdir(join(thirdParty, 'Contents'), { recursive: true })
    await writeFile(
      join(thirdParty, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.Notes</string></dict></plist>',
      'utf8',
    )
    await expect(removeVaultLauncher(thirdParty, '/Users/me/VaultA', { trashItem })).rejects.toThrow(/Refusing to remove/)
  })

  it('supports optional vaultUrl override (for workspace launchers) while preserving vaultPath guards', async () => {
    const trashItem = vi.fn(async () => {})
    const deps = { appDirs: [primaryApps], trashItem, execFile: async () => {} }
    const res = await installVaultLauncher(
      {
        name: 'Work Suite',
        vaultPath: 'workspace:ws-42',
        vaultUrl: 'yaseendocs://workspace/ws-42',
        iconPng: FAKE_PNG,
        binaryPath: fakeBinary,
      },
      deps,
    )
    expect(res.vaultUrl).toBe('yaseendocs://workspace/ws-42')
    expect(await readLauncherPlist(res.appPath)).toEqual({
      bundleId: res.bundleId,
      vaultPath: 'workspace:ws-42',
      vaultUrl: 'yaseendocs://workspace/ws-42',
      bundleVersion: LAUNCHER_BUNDLE_VERSION,
      displayName: 'Work Suite',
      hostPath: '/Applications/Yaseen Docs.app',
      hostBundleId: APP_SHIM_HOST_BUNDLE_ID,
      serverName: null,
    })
    // Collision guard blocks another workspace with the same name.
    await expect(
      installVaultLauncher(
        { name: 'Work Suite', vaultPath: 'workspace:ws-99', vaultUrl: 'yaseendocs://workspace/ws-99', iconPng: FAKE_PNG, binaryPath: fakeBinary },
        deps,
      ),
    ).rejects.toThrow(/Cannot overwrite/)
    // Remove guard enforces matching workspace vaultPath.
    await expect(removeVaultLauncher(res.appPath, 'workspace:ws-99', { trashItem })).rejects.toThrow(/Refusing to remove/)
    await expect(removeVaultLauncher(res.appPath, 'workspace:ws-42', { trashItem })).resolves.toBe(true)
    expect(trashItem).toHaveBeenCalledWith(res.appPath)
  })

  it.skipIf(process.platform !== 'darwin' || !existsSync(REAL_APP_SHIM_LOADER))(
    'produces a codesign-verified, plutil-valid v3 .app bundle with real Electron app_shim_loader on macOS',
    async () => {
      const res = await installVaultLauncher(
        {
          name: 'RealBundleTest',
          vaultPath: '/Users/me/RealVault',
          iconPng: FAKE_PNG,
          openTarget: 'today',
          binaryPath: REAL_APP_SHIM_LOADER,
        },
        {
          appDirs: [primaryApps],
          trashItem: async () => {},
          execFile: async (file, args) => {
            // Run real codesign; skip lsregister so test doesn't pollute LaunchServices DB.
            if (file === LSREGISTER_PATH) return
            await execFileAsync(file, [...args])
          },
        },
      )
      await expect(execFileAsync('plutil', ['-lint', join(res.appPath, 'Contents', 'Info.plist')])).resolves.toBeDefined()
      await expect(execFileAsync('codesign', ['--verify', '--strict', res.appPath])).resolves.toBeDefined()
    },
  )
})

describe('refreshOutdatedLaunchers (YAZ-6605, YAZ-6624 v1/v2 -> v3)', () => {
  let root: string
  let appsDir: string
  let newBinary: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'yd-refresh-'))
    appsDir = join(root, 'Applications')
    await mkdir(appsDir, { recursive: true })
    newBinary = join(root, APP_SHIM_EXECUTABLE)
    await writeFile(newBinary, '#!/bin/sh\n# v3 app_shim_loader\nexit 0\n', 'utf8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** Write a legacy Swift v1/v2 bundle (`vault-launcher` executable + `LSUIElement: true`). */
  async function writeLegacySwiftBundle(opts: {
    name: string
    displayName?: string
    bundleId: string
    vaultPath: string | null
    vaultUrl: string | null
    version?: string | null
    binaryContent?: string
    iconBytes?: Buffer
  }): Promise<string> {
    const appPath = join(appsDir, `${opts.name}.app`)
    await mkdir(join(appPath, 'Contents', 'MacOS'), { recursive: true })
    await mkdir(join(appPath, 'Contents', 'Resources'), { recursive: true })
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>CFBundleDevelopmentRegion</key>',
      '  <string>en</string>',
      `  <key>CFBundleDisplayName</key>`,
      `  <string>${opts.displayName ?? opts.name}</string>`,
      '  <key>CFBundleExecutable</key>',
      '  <string>vault-launcher</string>',
      '  <key>CFBundleIconFile</key>',
      '  <string>AppIcon</string>',
      '  <key>CFBundleIdentifier</key>',
      `  <string>${opts.bundleId}</string>`,
      '  <key>CFBundleName</key>',
      `  <string>${opts.displayName ?? opts.name}</string>`,
      '  <key>CFBundlePackageType</key>',
      '  <string>APPL</string>',
      ...(opts.version !== null && opts.version !== undefined
        ? ['  <key>CFBundleVersion</key>', `  <string>${opts.version}</string>`]
        : []),
      '  <key>LSMinimumSystemVersion</key>',
      '  <string>12.0</string>',
      '  <key>LSUIElement</key>',
      '  <true/>',
      ...(opts.vaultUrl !== null ? ['  <key>YaseenDocsVaultURL</key>', `  <string>${opts.vaultUrl}</string>`] : []),
      ...(opts.vaultPath !== null ? ['  <key>YaseenDocsVaultPath</key>', `  <string>${opts.vaultPath}</string>`] : []),
      '</dict>',
      '</plist>',
      '',
    ]
    await writeFile(join(appPath, 'Contents', 'Info.plist'), lines.join('\n'), 'utf8')
    await writeFile(join(appPath, 'Contents', 'MacOS', 'vault-launcher'), opts.binaryContent ?? '#!/bin/sh\n# legacy swift\nexit 0\n', 'utf8')
    await writeFile(join(appPath, 'Contents', 'Resources', 'AppIcon.icns'), opts.iconBytes ?? encodeIcnsFromPng(FAKE_PNG))
    return appPath
  }

  /** Write a v3 App Shim bundle (`app_shim_loader` executable). */
  async function writeV3ShimBundle(opts: {
    name: string
    bundleId: string
    vaultPath: string
    vaultUrl: string
    version?: string
    hostBundlePath?: string
    hostBundleId?: string
    serverName?: string
    binaryContent?: string
    iconBytes?: Buffer
  }): Promise<string> {
    const appPath = join(appsDir, `${opts.name}.app`)
    await mkdir(join(appPath, 'Contents', 'MacOS'), { recursive: true })
    await mkdir(join(appPath, 'Contents', 'Resources'), { recursive: true })
    let xml = buildLauncherPlist({
      name: opts.name,
      bundleId: opts.bundleId,
      vaultUrl: opts.vaultUrl,
      vaultPath: opts.vaultPath,
      hostBundlePath: opts.hostBundlePath,
      hostBundleId: opts.hostBundleId,
      serverName: opts.serverName,
    })
    if (opts.version !== undefined) {
      xml = xml.replace(/(<key>CFBundleVersion<\/key>\s*<string>)[\s\S]*?(<\/string>)/, `$1${opts.version}$2`)
    }
    await writeFile(join(appPath, 'Contents', 'Info.plist'), xml, 'utf8')
    await writeFile(join(appPath, 'Contents', 'MacOS', APP_SHIM_EXECUTABLE), opts.binaryContent ?? '#!/bin/sh\n# keep v3\n', 'utf8')
    await writeFile(join(appPath, 'Contents', 'Resources', 'AppIcon.icns'), opts.iconBytes ?? encodeIcnsFromPng(FAKE_PNG))
    return appPath
  }

  it('readLauncherPlist parses numeric CFBundleVersion and returns null when missing or non-numeric', async () => {
    const v1 = await writeLegacySwiftBundle({
      name: 'V1',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}v1`,
      vaultPath: '/Users/me/V1',
      vaultUrl: 'yaseendocs:///Users/me/V1',
      version: '1',
    })
    const missing = await writeLegacySwiftBundle({
      name: 'MissingVer',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}missing`,
      vaultPath: '/Users/me/Missing',
      vaultUrl: 'yaseendocs:///Users/me/Missing',
      version: null,
    })
    const bad = await writeLegacySwiftBundle({
      name: 'NonNumeric',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}bad`,
      vaultPath: '/Users/me/Bad',
      vaultUrl: 'yaseendocs:///Users/me/Bad',
      version: '1.2.3',
    })

    expect((await readLauncherPlist(v1))?.bundleVersion).toBe(1)
    expect((await readLauncherPlist(missing))?.bundleVersion).toBeNull()
    expect((await readLauncherPlist(bad))?.bundleVersion).toBeNull()
  })

  it('upgrades v1 and v2 Swift bundles to v3 App Shims: replaces binary, drops LSUIElement, preserves icon & metadata, signs, and runs lsregister', async () => {
    const customIcon = encodeIcnsFromPng(
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('custom-preserved-icon')]),
    )
    const idV1 = launcherBundleId('/Users/me/Daily', 'Daily Notes')
    const v1Path = await writeLegacySwiftBundle({
      name: 'Daily Notes',
      displayName: 'Daily Notes & Tasks',
      bundleId: idV1,
      vaultPath: '/Users/me/Daily',
      vaultUrl: 'yaseendocs:///Users/me/Daily?open=today',
      version: '1',
      iconBytes: customIcon,
    })
    const idV2 = launcherBundleId('/Users/me/Work', 'Work')
    const v2Path = await writeLegacySwiftBundle({
      name: 'Work',
      bundleId: idV2,
      vaultPath: '/Users/me/Work',
      vaultUrl: 'yaseendocs:///Users/me/Work',
      version: '2',
      iconBytes: customIcon,
    })

    const execCalls: Array<[string, readonly string[]]> = []
    const upgraded = await refreshOutdatedLaunchers(newBinary, {
      appDirs: [appsDir],
      hostBundlePath: '/Applications/Yaseen Docs.app',
      signIdentity: 'Yaseen Local Signing',
      execFile: async (file, args) => {
        execCalls.push([file, args])
      },
    })

    expect(upgraded.sort()).toEqual([v1Path, v2Path].sort())
    // For each bundle: codesign on staged temp bundle first, then lsregister -f on final appPath.
    expect(execCalls).toHaveLength(4)
    expect(execCalls[0][0]).toBe('codesign')
    expect(execCalls[0][1].slice(0, 3)).toEqual(['--force', '--sign', 'Yaseen Local Signing'])
    expect(execCalls[0][1][3]).toMatch(/\.yaseen-launcher-upgrade-.*\.app$/)
    expect(execCalls[1][0]).toBe(LSREGISTER_PATH)
    expect(execCalls[1][1][0]).toBe('-f')

    for (const [appPath, bundleId, displayName, vaultPath, vaultUrl] of [
      [v1Path, idV1, 'Daily Notes & Tasks', '/Users/me/Daily', 'yaseendocs:///Users/me/Daily?open=today'],
      [v2Path, idV2, 'Work', '/Users/me/Work', 'yaseendocs:///Users/me/Work'],
    ] as const) {
      // Old vault-launcher is gone; only app_shim_loader exists and is 0o755.
      expect(await readdir(join(appPath, 'Contents', 'MacOS'))).toEqual([APP_SHIM_EXECUTABLE])
      const binPath = join(appPath, 'Contents', 'MacOS', APP_SHIM_EXECUTABLE)
      expect(await readFile(binPath, 'utf8')).toBe('#!/bin/sh\n# v3 app_shim_loader\nexit 0\n')
      expect((await stat(binPath)).mode & 0o777).toBe(0o755)

      // Fresh v3 Info.plist: no LSUIElement, ElectronAppShimHost* present, version 3, metadata preserved.
      const plistXml = await readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8')
      expect(plistXml).not.toContain('LSUIElement')
      expect(plistXml).toContain('<key>NSHighResolutionCapable</key>\n  <true/>')
      expect(plistXml).toContain(`<key>CFBundleExecutable</key>\n  <string>${APP_SHIM_EXECUTABLE}</string>`)
      expect(plistXml).toContain(
        `<key>ElectronAppShimHostArguments</key>\n  <array>\n    <string>${APP_SHIM_HOST_ARG}</string>\n  </array>`,
      )
      expect(await readLauncherPlist(appPath)).toEqual({
        bundleId,
        vaultPath,
        vaultUrl,
        bundleVersion: LAUNCHER_BUNDLE_VERSION,
        displayName,
        hostPath: '/Applications/Yaseen Docs.app',
        hostBundleId: APP_SHIM_HOST_BUNDLE_ID,
        serverName: null,
      })

      // AppIcon.icns preserved byte-for-byte.
      expect(await readFile(join(appPath, 'Contents', 'Resources', 'AppIcon.icns'))).toEqual(customIcon)
      expect((await readdir(join(appPath, 'Contents'))).sort()).toEqual(['Info.plist', 'MacOS', 'Resources'])
    }

    // No stray temp bundles left in appsDir.
    expect((await readdir(appsDir)).sort()).toEqual(['Daily Notes.app', 'Work.app'])
  })

  it('upgrades an outdated own launcher when CFBundleVersion is missing', async () => {
    const appPath = await writeLegacySwiftBundle({
      name: 'LegacyNoVer',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}legacy`,
      vaultPath: '/Users/me/Legacy',
      vaultUrl: 'yaseendocs:///Users/me/Legacy',
      version: null,
    })

    const upgraded = await refreshOutdatedLaunchers(newBinary, {
      appDirs: [appsDir],
      execFile: async () => {},
    })

    expect(upgraded).toEqual([appPath])
    expect((await readLauncherPlist(appPath))?.bundleVersion).toBe(LAUNCHER_BUNDLE_VERSION)
    expect(await readdir(join(appPath, 'Contents', 'MacOS'))).toEqual([APP_SHIM_EXECUTABLE])
  })

  it('skips v3+ bundles when hostBundlePath is omitted or already matches', async () => {
    const v3 = await writeV3ShimBundle({
      name: 'CurrentV3',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}v3`,
      vaultPath: '/Users/me/V3',
      vaultUrl: 'yaseendocs:///Users/me/V3',
      hostBundlePath: '/Applications/Yaseen Docs.app',
      binaryContent: '#!/bin/sh\n# keep v3\n',
    })
    const v4 = await writeV3ShimBundle({
      name: 'FutureV4',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}v4`,
      vaultPath: '/Users/me/V4',
      vaultUrl: 'yaseendocs:///Users/me/V4',
      version: String(LAUNCHER_BUNDLE_VERSION + 1),
      hostBundlePath: '/Applications/Yaseen Docs.app',
      binaryContent: '#!/bin/sh\n# keep v4\n',
    })

    const execFile = vi.fn(async () => {})
    expect(await refreshOutdatedLaunchers(newBinary, { appDirs: [appsDir], execFile })).toEqual([])
    expect(
      await refreshOutdatedLaunchers(newBinary, {
        appDirs: [appsDir],
        hostBundlePath: '/Applications/Yaseen Docs.app',
        execFile,
      }),
    ).toEqual([])
    expect(execFile).not.toHaveBeenCalled()
    expect(await readFile(join(v3, 'Contents', 'MacOS', APP_SHIM_EXECUTABLE), 'utf8')).toBe('#!/bin/sh\n# keep v3\n')
    expect(await readFile(join(v4, 'Contents', 'MacOS', APP_SHIM_EXECUTABLE), 'utf8')).toBe('#!/bin/sh\n# keep v4\n')
  })

  it('updates v3 bundle when hostBundlePath changes for matching serverName, and ignores mismatched serverName', async () => {
    const prodMoved = await writeV3ShimBundle({
      name: 'ProdMoved',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}prod-moved`,
      vaultPath: '/Users/me/Prod',
      vaultUrl: 'yaseendocs:///Users/me/Prod',
      hostBundlePath: '/Users/me/Downloads/Yaseen Docs.app',
      binaryContent: '#!/bin/sh\n# old prod\n',
    })
    const demoShim = await writeV3ShimBundle({
      name: 'DemoShim',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}demo`,
      vaultPath: '/Users/me/Demo',
      vaultUrl: 'yaseendocs:///Users/me/Demo',
      hostBundlePath: '/tmp/old/Electron.app',
      serverName: 'isolated-demo',
      binaryContent: '#!/bin/sh\n# old demo\n',
    })

    // Prod refresh (serverName omitted -> null) updates ProdMoved, skips DemoShim.
    const prodUpgraded = await refreshOutdatedLaunchers(newBinary, {
      appDirs: [appsDir],
      hostBundlePath: '/Applications/Yaseen Docs.app',
      execFile: async () => {},
    })
    expect(prodUpgraded).toEqual([prodMoved])
    expect((await readLauncherPlist(prodMoved))?.hostPath).toBe('/Applications/Yaseen Docs.app')
    expect((await readLauncherPlist(demoShim))?.hostPath).toBe('/tmp/old/Electron.app')

    // Demo refresh (serverName: 'isolated-demo') updates DemoShim, skips ProdMoved.
    const demoUpgraded = await refreshOutdatedLaunchers(newBinary, {
      appDirs: [appsDir],
      hostBundlePath: '/tmp/new/Electron.app',
      hostBundleId: 'com.github.Electron',
      serverName: 'isolated-demo',
      execFile: async () => {},
    })
    expect(demoUpgraded).toEqual([demoShim])
    expect(await readLauncherPlist(demoShim)).toMatchObject({
      hostPath: '/tmp/new/Electron.app',
      hostBundleId: 'com.github.Electron',
      serverName: 'isolated-demo',
    })
    expect((await readLauncherPlist(prodMoved))?.hostPath).toBe('/Applications/Yaseen Docs.app')
  })

  it('ignores third-party .app bundles even when their CFBundleVersion is 1', async () => {
    const thirdParty = join(appsDir, 'Safari.app')
    await mkdir(join(thirdParty, 'Contents', 'MacOS'), { recursive: true })
    const thirdPartyPlist =
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.Safari</string><key>CFBundleVersion</key><string>1</string></dict></plist>'
    await writeFile(join(thirdParty, 'Contents', 'Info.plist'), thirdPartyPlist, 'utf8')
    await writeFile(join(thirdParty, 'Contents', 'MacOS', 'vault-launcher'), 'do-not-touch', 'utf8')

    const execFile = vi.fn(async () => {})
    const upgraded = await refreshOutdatedLaunchers(newBinary, { appDirs: [appsDir], execFile })

    expect(upgraded).toEqual([])
    expect(execFile).not.toHaveBeenCalled()
    expect(await readFile(join(thirdParty, 'Contents', 'Info.plist'), 'utf8')).toBe(thirdPartyPlist)
    expect(await readFile(join(thirdParty, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('do-not-touch')
  })

  it('returns [] cleanly when binaryPath does not exist without modifying legacy bundles', async () => {
    const v1 = await writeLegacySwiftBundle({
      name: 'Untouched',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}untouched`,
      vaultPath: '/Users/me/Untouched',
      vaultUrl: 'yaseendocs:///Users/me/Untouched',
      version: '1',
      binaryContent: '#!/bin/sh\n# original\n',
    })

    const execFile = vi.fn(async () => {})
    const upgraded = await refreshOutdatedLaunchers(join(root, 'missing-binary'), { appDirs: [appsDir], execFile })

    expect(upgraded).toEqual([])
    expect(execFile).not.toHaveBeenCalled()
    expect((await readLauncherPlist(v1))?.bundleVersion).toBe(1)
    expect(await readFile(join(v1, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# original\n')
  })

  it('skips bundles with missing or malformed vaultUrl/vaultPath with a warning without touching them', async () => {
    const missingUrl = await writeLegacySwiftBundle({
      name: 'MissingUrl',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}missing-url`,
      vaultPath: '/Users/me/MissingUrl',
      vaultUrl: null,
      version: '2',
      binaryContent: '#!/bin/sh\n# missing url\n',
    })
    const badUrl = await writeLegacySwiftBundle({
      name: 'BadUrl',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}bad-url`,
      vaultPath: '/Users/me/BadUrl',
      vaultUrl: 'https://example.com/not-a-vault',
      version: '2',
      binaryContent: '#!/bin/sh\n# bad url\n',
    })
    const missingPath = await writeLegacySwiftBundle({
      name: 'MissingPath',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}missing-path`,
      vaultPath: null,
      vaultUrl: 'yaseendocs:///Users/me/MissingPath',
      version: '2',
      binaryContent: '#!/bin/sh\n# missing path\n',
    })
    const valid = await writeLegacySwiftBundle({
      name: 'ValidPass',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}valid`,
      vaultPath: '/Users/me/Valid',
      vaultUrl: 'yaseendocs:///Users/me/Valid',
      version: '2',
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const upgraded = await refreshOutdatedLaunchers(newBinary, {
        appDirs: [appsDir],
        execFile: async () => {},
      })

      expect(upgraded).toEqual([valid])
      expect(warnSpy).toHaveBeenCalledTimes(3)
      // All 3 malformed bundles remained untouched.
      expect(await readFile(join(missingUrl, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# missing url\n')
      expect(await readFile(join(badUrl, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# bad url\n')
      expect(await readFile(join(missingPath, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# missing path\n')
      // Valid bundle upgraded cleanly to v3.
      expect((await readLauncherPlist(valid))?.bundleVersion).toBe(LAUNCHER_BUNDLE_VERSION)
      expect(await readdir(join(valid, 'Contents', 'MacOS'))).toEqual([APP_SHIM_EXECUTABLE])
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('cleans up temp files, rolls back a bundle whose codesign fails, ignores lsregister failure, and upgrades other valid bundles', async () => {
    const failing = await writeLegacySwiftBundle({
      name: 'AlphaFail',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}alpha`,
      vaultPath: '/Users/me/Alpha',
      vaultUrl: 'yaseendocs:///Users/me/Alpha',
      version: '1',
      binaryContent: '#!/bin/sh\n# alpha v1\n',
    })
    const succeeding = await writeLegacySwiftBundle({
      name: 'BetaPass',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}beta`,
      vaultPath: '/Users/me/Beta',
      vaultUrl: 'yaseendocs:///Users/me/Beta',
      version: '2',
      binaryContent: '#!/bin/sh\n# beta v2\n',
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const upgraded = await refreshOutdatedLaunchers(newBinary, {
        appDirs: [appsDir],
        execFile: async (file, args) => {
          if (file === LSREGISTER_PATH) throw new Error('lsregister unavailable')
          const stagedPlist = await readFile(join(args[3], 'Contents', 'Info.plist'), 'utf8')
          if (stagedPlist.includes('AlphaFail')) throw new Error('codesign failed for AlphaFail')
        },
      })

      expect(upgraded).toEqual([succeeding])
      // Failed bundle stayed untouched (never swapped) and zero temp bundles remain.
      expect((await readdir(appsDir)).sort()).toEqual(['AlphaFail.app', 'BetaPass.app'])
      expect((await readLauncherPlist(failing))?.bundleVersion).toBe(1)
      expect(await readFile(join(failing, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# alpha v1\n')
      expect((await readdir(join(failing, 'Contents'))).sort()).toEqual(['Info.plist', 'MacOS', 'Resources'])
      expect(await readdir(join(failing, 'Contents', 'MacOS'))).toEqual(['vault-launcher'])

      // Other valid bundle upgraded cleanly despite lsregister failure.
      expect((await readLauncherPlist(succeeding))?.bundleVersion).toBe(LAUNCHER_BUNDLE_VERSION)
      expect(await readFile(join(succeeding, 'Contents', 'MacOS', APP_SHIM_EXECUTABLE), 'utf8')).toBe(
        '#!/bin/sh\n# v3 app_shim_loader\nexit 0\n',
      )
      expect((await readdir(join(succeeding, 'Contents'))).sort()).toEqual(['Info.plist', 'MacOS', 'Resources'])
      expect(await readdir(join(succeeding, 'Contents', 'MacOS'))).toEqual([APP_SHIM_EXECUTABLE])
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it.skipIf(process.platform !== 'darwin' || !existsSync(REAL_APP_SHIM_LOADER))(
    'upgraded v2 Swift bundle passes plutil and strict codesign verification with real Electron app_shim_loader on macOS',
    async () => {
      const appPath = await writeLegacySwiftBundle({
        name: 'RealUpgradeTest',
        bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}real-upgrade`,
        vaultPath: '/Users/me/RealUpgrade',
        vaultUrl: 'yaseendocs:///Users/me/RealUpgrade',
        version: '2',
      })

      const upgraded = await refreshOutdatedLaunchers(REAL_APP_SHIM_LOADER, {
        appDirs: [appsDir],
        execFile: async (file, args) => {
          if (file === LSREGISTER_PATH) return
          await execFileAsync(file, [...args])
        },
      })
      expect(upgraded).toEqual([appPath])
      expect((await readLauncherPlist(appPath))?.bundleVersion).toBe(LAUNCHER_BUNDLE_VERSION)
      expect(await readdir(join(appPath, 'Contents', 'MacOS'))).toEqual([APP_SHIM_EXECUTABLE])
      await expect(execFileAsync('plutil', ['-lint', join(appPath, 'Contents', 'Info.plist')])).resolves.toBeDefined()
      await expect(execFileAsync('codesign', ['--verify', '--strict', appPath])).resolves.toBeDefined()
    },
  )
})
