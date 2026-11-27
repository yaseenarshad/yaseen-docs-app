import { execFile as nodeExecFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLauncherPlist,
  encodeIcnsFromPng,
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
  sanitizeBundleName,
  scanInstalledLaunchers,
  vaultLauncherBinaryPath,
} from './vaultLauncher'

const execFileAsync = promisify(nodeExecFile)

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

describe('vaultLauncherBinaryPath', () => {
  it('resolves Resources/bin/vault-launcher when packaged and desktop/build/bin/vault-launcher in dev', () => {
    expect(vaultLauncherBinaryPath({ isPackaged: true, resourcesPath: '/App/Resources', mainDir: '/x/out/main' })).toBe(
      join('/App/Resources', 'bin', 'vault-launcher'),
    )
    expect(vaultLauncherBinaryPath({ isPackaged: false, resourcesPath: '/App/Resources', mainDir: '/repo/desktop/out/main' })).toBe(
      resolve('/repo/desktop/out/main', '..', '..', 'build', 'bin', 'vault-launcher'),
    )
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

describe('launcherBundleId & buildLauncherPlist', () => {
  it('produces a deterministic bundle id with the launcher prefix and round-trips XML special chars', async () => {
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
      expect(xml).toContain('<key>LSUIElement</key>\n  <true/>')
      expect(xml).toContain('<key>CFBundleExecutable</key>\n  <string>vault-launcher</string>')
      expect(xml).toContain('<key>CFBundleIconFile</key>\n  <string>AppIcon</string>')
      expect(xml).toContain(`<key>CFBundleVersion</key>\n  <string>${LAUNCHER_BUNDLE_VERSION}</string>`)
      await writeFile(join(appPath, 'Contents', 'Info.plist'), xml, 'utf8')
      expect(await readLauncherPlist(appPath)).toEqual({
        bundleId: id1,
        vaultPath: '/Users/me/A & B',
        vaultUrl: 'yaseendocs:///Users/me/A%20%26%20B?open=today',
        bundleVersion: LAUNCHER_BUNDLE_VERSION,
      })
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
    fakeBinary = join(root, 'vault-launcher')
    await writeFile(fakeBinary, '#!/bin/sh\nexit 0\n', 'utf8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('installs a complete .app bundle atomically, signs it, and runs lsregister', async () => {
    const execCalls: Array<[string, readonly string[]]> = []
    const trashItem = vi.fn(async () => {})

    const res = await installVaultLauncher(
      {
        name: 'Personal',
        vaultPath: '/Users/me/Personal/',
        iconPng: FAKE_PNG,
        openTarget: 'inbox',
        binaryPath: fakeBinary,
      },
      {
        appDirs: [primaryApps, fallbackApps],
        trashItem,
        execFile: async (file, args) => {
          execCalls.push([file, args])
        },
      },
    )

    expect(res.appPath).toBe(join(primaryApps, 'Personal.app'))
    expect(res.name).toBe('Personal')
    expect(res.bundleId.startsWith(LAUNCHER_BUNDLE_ID_PREFIX)).toBe(true)
    expect(res.vaultUrl).toBe('yaseendocs:///Users/me/Personal?open=inbox')

    // Binary is copied and executable.
    const binStat = await stat(join(res.appPath, 'Contents', 'MacOS', 'vault-launcher'))
    expect(binStat.mode & 0o111).toBeGreaterThan(0)

    // AppIcon.icns is valid.
    const icns = await readFile(join(res.appPath, 'Contents', 'Resources', 'AppIcon.icns'))
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.subarray(8, 12).toString('ascii')).toBe('ic09')

    // Info.plist has expected fields.
    const plist = await readLauncherPlist(res.appPath)
    expect(plist).toEqual({
      bundleId: res.bundleId,
      vaultPath: '/Users/me/Personal',
      vaultUrl: 'yaseendocs:///Users/me/Personal?open=inbox',
      bundleVersion: LAUNCHER_BUNDLE_VERSION,
    })

    // codesign ran on staged temp bundle, lsregister ran on final target.
    expect(execCalls).toHaveLength(2)
    expect(execCalls[0][0]).toBe('codesign')
    expect(execCalls[0][1].slice(0, 3)).toEqual(['--force', '--sign', '-'])
    expect(execCalls[0][1][3]).toContain('.yaseen-launcher-tmp-')
    expect(execCalls[1]).toEqual([LSREGISTER_PATH, ['-f', res.appPath]])

    // No temp staging dirs left behind.
    expect(await readdir(primaryApps)).toEqual(['Personal.app'])
    expect(trashItem).not.toHaveBeenCalled()
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

  it.skipIf(process.platform !== 'darwin')('produces a codesign-verified .app bundle with the real compiled Swift binary on macOS', async () => {
    const binPath = resolve(import.meta.dirname, '..', '..', 'build', 'bin', 'vault-launcher')
    const res = await installVaultLauncher(
      { name: 'RealBundleTest', vaultPath: '/Users/me/RealVault', iconPng: FAKE_PNG, openTarget: 'today', binaryPath: binPath },
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
    await expect(execFileAsync('codesign', ['--verify', '--strict', res.appPath])).resolves.toBeDefined()
  })
})

describe('refreshOutdatedLaunchers (YAZ-6605)', () => {
  let root: string
  let appsDir: string
  let newBinary: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'yd-refresh-'))
    appsDir = join(root, 'Applications')
    await mkdir(appsDir, { recursive: true })
    newBinary = join(root, 'vault-launcher-v2')
    await writeFile(newBinary, '#!/bin/sh\n# v2 binary\nexit 0\n', 'utf8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function writeLauncherBundle(opts: {
    name: string
    bundleId: string
    vaultPath: string
    vaultUrl: string
    version?: string | null
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
    })
    if (opts.version === null) {
      xml = xml.replace(/\s*<key>CFBundleVersion<\/key>\s*<string>[\s\S]*?<\/string>/, '')
    } else if (opts.version !== undefined) {
      xml = xml.replace(/(<key>CFBundleVersion<\/key>\s*<string>)[\s\S]*?(<\/string>)/, `$1${opts.version}$2`)
    }
    await writeFile(join(appPath, 'Contents', 'Info.plist'), xml, 'utf8')
    await writeFile(join(appPath, 'Contents', 'MacOS', 'vault-launcher'), opts.binaryContent ?? '#!/bin/sh\n# v1 binary\nexit 0\n', 'utf8')
    await writeFile(join(appPath, 'Contents', 'Resources', 'AppIcon.icns'), opts.iconBytes ?? encodeIcnsFromPng(FAKE_PNG))
    return appPath
  }

  it('readLauncherPlist parses numeric CFBundleVersion and returns null when missing or non-numeric', async () => {
    const v1 = await writeLauncherBundle({
      name: 'V1',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}v1`,
      vaultPath: '/Users/me/V1',
      vaultUrl: 'yaseendocs:///Users/me/V1',
      version: '1',
    })
    const missing = await writeLauncherBundle({
      name: 'MissingVer',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}missing`,
      vaultPath: '/Users/me/Missing',
      vaultUrl: 'yaseendocs:///Users/me/Missing',
      version: null,
    })
    const bad = await writeLauncherBundle({
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

  it('upgrades a v1 bundle atomically, bumps CFBundleVersion to 2, signs it, and preserves icon and plist metadata', async () => {
    const customIcon = encodeIcnsFromPng(
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('custom-preserved-icon')]),
    )
    const bundleId = launcherBundleId('/Users/me/Daily', 'Daily Notes')
    const appPath = await writeLauncherBundle({
      name: 'Daily Notes',
      bundleId,
      vaultPath: '/Users/me/Daily',
      vaultUrl: 'yaseendocs:///Users/me/Daily?open=today',
      version: '1',
      iconBytes: customIcon,
    })

    const execCalls: Array<[string, readonly string[]]> = []
    const upgraded = await refreshOutdatedLaunchers(newBinary, {
      appDirs: [appsDir],
      execFile: async (file, args) => {
        execCalls.push([file, args])
      },
    })

    expect(upgraded).toEqual([appPath])
    expect(execCalls).toEqual([['codesign', ['--force', '--sign', '-', appPath]]])

    // Binary replaced and executable (0o755).
    const binPath = join(appPath, 'Contents', 'MacOS', 'vault-launcher')
    expect(await readFile(binPath, 'utf8')).toBe('#!/bin/sh\n# v2 binary\nexit 0\n')
    const binStat = await stat(binPath)
    expect(binStat.mode & 0o777).toBe(0o755)

    // CFBundleVersion bumped to 2 and all metadata + display name preserved.
    expect(await readLauncherPlist(appPath)).toEqual({
      bundleId,
      vaultPath: '/Users/me/Daily',
      vaultUrl: 'yaseendocs:///Users/me/Daily?open=today',
      bundleVersion: LAUNCHER_BUNDLE_VERSION,
    })
    const plistXml = await readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8')
    expect(plistXml).toContain('<key>CFBundleDisplayName</key>\n  <string>Daily Notes</string>')

    // AppIcon.icns preserved byte-for-byte.
    expect(await readFile(join(appPath, 'Contents', 'Resources', 'AppIcon.icns'))).toEqual(customIcon)

    // No stray temp files left in Contents/ or Contents/MacOS/.
    expect((await readdir(join(appPath, 'Contents'))).sort()).toEqual(['Info.plist', 'MacOS', 'Resources'])
    expect(await readdir(join(appPath, 'Contents', 'MacOS'))).toEqual(['vault-launcher'])
  })

  it('inserts CFBundleVersion when missing on an outdated own launcher', async () => {
    const appPath = await writeLauncherBundle({
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
  })

  it('skips bundles already at CFBundleVersion >= 2 with zero codesign calls', async () => {
    const v2 = await writeLauncherBundle({
      name: 'CurrentV2',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}v2`,
      vaultPath: '/Users/me/V2',
      vaultUrl: 'yaseendocs:///Users/me/V2',
      version: String(LAUNCHER_BUNDLE_VERSION),
      binaryContent: '#!/bin/sh\n# keep v2\n',
    })
    const v3 = await writeLauncherBundle({
      name: 'FutureV3',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}v3`,
      vaultPath: '/Users/me/V3',
      vaultUrl: 'yaseendocs:///Users/me/V3',
      version: String(LAUNCHER_BUNDLE_VERSION + 1),
      binaryContent: '#!/bin/sh\n# keep v3\n',
    })

    const execFile = vi.fn(async () => {})
    const upgraded = await refreshOutdatedLaunchers(newBinary, { appDirs: [appsDir], execFile })

    expect(upgraded).toEqual([])
    expect(execFile).not.toHaveBeenCalled()
    expect(await readFile(join(v2, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# keep v2\n')
    expect(await readFile(join(v3, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# keep v3\n')
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

  it('returns [] cleanly when binaryPath does not exist without modifying v1 bundles', async () => {
    const v1 = await writeLauncherBundle({
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

  it('cleans up temp files, rolls back a bundle whose codesign fails, and still upgrades other valid bundles', async () => {
    const failing = await writeLauncherBundle({
      name: 'AlphaFail',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}alpha`,
      vaultPath: '/Users/me/Alpha',
      vaultUrl: 'yaseendocs:///Users/me/Alpha',
      version: '1',
      binaryContent: '#!/bin/sh\n# alpha v1\n',
    })
    const succeeding = await writeLauncherBundle({
      name: 'BetaPass',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}beta`,
      vaultPath: '/Users/me/Beta',
      vaultUrl: 'yaseendocs:///Users/me/Beta',
      version: '1',
      binaryContent: '#!/bin/sh\n# beta v1\n',
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const upgraded = await refreshOutdatedLaunchers(newBinary, {
        appDirs: [appsDir],
        execFile: async (_file, args) => {
          if (args.includes(failing)) throw new Error('codesign failed for AlphaFail')
        },
      })

      expect(upgraded).toEqual([succeeding])
      // Failed bundle rolled back cleanly with zero temp files left behind.
      expect((await readLauncherPlist(failing))?.bundleVersion).toBe(1)
      expect(await readFile(join(failing, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# alpha v1\n')
      expect((await readdir(join(failing, 'Contents'))).sort()).toEqual(['Info.plist', 'MacOS', 'Resources'])
      expect(await readdir(join(failing, 'Contents', 'MacOS'))).toEqual(['vault-launcher'])

      // Other valid bundle upgraded cleanly.
      expect((await readLauncherPlist(succeeding))?.bundleVersion).toBe(LAUNCHER_BUNDLE_VERSION)
      expect(await readFile(join(succeeding, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# v2 binary\nexit 0\n')
      expect((await readdir(join(succeeding, 'Contents'))).sort()).toEqual(['Info.plist', 'MacOS', 'Resources'])
      expect(await readdir(join(succeeding, 'Contents', 'MacOS'))).toEqual(['vault-launcher'])
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('cleans up temp files if staging fails on one bundle and continues upgrading other valid bundles', async () => {
    const unwritable = await writeLauncherBundle({
      name: 'LockedFail',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}locked`,
      vaultPath: '/Users/me/Locked',
      vaultUrl: 'yaseendocs:///Users/me/Locked',
      version: '1',
      binaryContent: '#!/bin/sh\n# locked v1\n',
    })
    const valid = await writeLauncherBundle({
      name: 'OpenPass',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}open`,
      vaultPath: '/Users/me/Open',
      vaultUrl: 'yaseendocs:///Users/me/Open',
      version: '1',
      binaryContent: '#!/bin/sh\n# open v1\n',
    })

    // Make Contents/MacOS read-only so copyFile into the staged temp path fails.
    const lockedMacOsDir = join(unwritable, 'Contents', 'MacOS')
    await chmod(lockedMacOsDir, 0o555)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const upgraded = await refreshOutdatedLaunchers(newBinary, {
        appDirs: [appsDir],
        execFile: async () => {},
      })

      expect(upgraded).toEqual([valid])
      expect((await readLauncherPlist(unwritable))?.bundleVersion).toBe(1)
      expect((await readdir(join(unwritable, 'Contents'))).sort()).toEqual(['Info.plist', 'MacOS', 'Resources'])
      expect(await readdir(lockedMacOsDir)).toEqual(['vault-launcher'])

      expect((await readLauncherPlist(valid))?.bundleVersion).toBe(LAUNCHER_BUNDLE_VERSION)
      expect(await readFile(join(valid, 'Contents', 'MacOS', 'vault-launcher'), 'utf8')).toBe('#!/bin/sh\n# v2 binary\nexit 0\n')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      await chmod(lockedMacOsDir, 0o755)
      warnSpy.mockRestore()
    }
  })

  it.skipIf(process.platform !== 'darwin')('upgraded v1 bundle passes strict codesign verification with the real Swift binary on macOS', async () => {
    const binPath = resolve(import.meta.dirname, '..', '..', 'build', 'bin', 'vault-launcher')
    const appPath = await writeLauncherBundle({
      name: 'RealUpgradeTest',
      bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}real-upgrade`,
      vaultPath: '/Users/me/RealUpgrade',
      vaultUrl: 'yaseendocs:///Users/me/RealUpgrade',
      version: '1',
    })

    const upgraded = await refreshOutdatedLaunchers(binPath, { appDirs: [appsDir] })
    expect(upgraded).toEqual([appPath])
    expect((await readLauncherPlist(appPath))?.bundleVersion).toBe(LAUNCHER_BUNDLE_VERSION)
    await expect(execFileAsync('codesign', ['--verify', '--strict', appPath])).resolves.toBeDefined()
  })
})
