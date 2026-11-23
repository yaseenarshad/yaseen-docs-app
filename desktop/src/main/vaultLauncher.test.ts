import { execFile as nodeExecFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLauncherPlist,
  encodeIcnsFromPng,
  installVaultLauncher,
  LAUNCHER_BUNDLE_ID_PREFIX,
  launcherBundleId,
  LSREGISTER_PATH,
  MAX_BUNDLE_NAME_LENGTH,
  pickApplicationsDir,
  readLauncherPlist,
  removeVaultLauncher,
  sanitizeBundleName,
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
      await writeFile(join(appPath, 'Contents', 'Info.plist'), xml, 'utf8')
      expect(await readLauncherPlist(appPath)).toEqual({
        bundleId: id1,
        vaultPath: '/Users/me/A & B',
        vaultUrl: 'yaseendocs:///Users/me/A%20%26%20B?open=today',
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
