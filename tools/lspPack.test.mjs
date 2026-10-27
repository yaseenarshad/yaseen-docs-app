import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lockEntry, lspTargets, pyrightStagedDir, stagePyright, stageTypescript, stagedDir, typescriptPackage, verifyIntegrity } from './lib/lspPack.mjs'

/**
 * Staging the TypeScript 7 language server for the packaged app (YAZ-3453): from `node_modules`
 * when the lockfile's version is installed, else the lockfile's tarball, checked by its sha512.
 * A fake repo in a temp folder; no network.
 */

const integrity = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

let repo = ''
beforeEach(() => void (repo = mkdtempSync(join(tmpdir(), 'yaz-3453-lsppack-'))))
afterEach(() => rmSync(repo, { recursive: true, force: true }))

/** A package folder with `lib/<exe>`, a lib file, and the legal files. */
function writePackage(dir, exe, version) {
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(dir, 'lib', exe), `binary ${version}`)
  writeFileSync(join(dir, 'lib', 'lib.es5.d.ts'), 'declare var NaN: number')
  writeFileSync(join(dir, 'LICENSE'), 'Apache-2.0')
  writeFileSync(join(dir, 'NOTICE.txt'), 'notices')
}

/** An npm tarball (`package/…`) of a package, as bytes. */
function tarball(exe, version) {
  const src = mkdtempSync(join(tmpdir(), 'yaz-3453-tgz-'))
  try {
    writePackage(join(src, 'package'), exe, version)
    execFileSync('tar', ['-czf', join(src, 'p.tgz'), '-C', src, 'package'])
    return readFileSync(join(src, 'p.tgz'))
  } finally {
    rmSync(src, { recursive: true, force: true })
  }
}

function writeLock(entries) {
  const packages = Object.fromEntries(Object.entries(entries).map(([pkg, e]) => [`node_modules/${pkg}`, { optional: true, ...e }]))
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }))
}

describe('lspPack (YAZ-3453)', () => {
  it("names the package by Node's platform, from electron-builder's os", () => {
    expect(typescriptPackage('mac', 'arm64')).toBe('@typescript/typescript-darwin-arm64')
    expect(typescriptPackage('win', 'x64')).toBe('@typescript/typescript-win32-x64')
    expect(() => typescriptPackage('beos', 'x64')).toThrow('unknown target os')
  })

  it('takes the targets from the build config of the platforms asked for', () => {
    const build = { mac: { target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'dir', arch: ['arm64'] }] }, win: { target: [{ target: 'nsis', arch: ['x64'] }] } }
    expect(lspTargets(build, ['--mac'])).toEqual([{ os: 'mac', arch: 'arm64' }])
    expect(lspTargets(build, ['--win'])).toEqual([{ os: 'win', arch: 'x64' }])
    expect(lspTargets({ mac: { target: [{ target: 'dmg', arch: ['arm64', 'x64'] }] } }, ['--mac'])).toEqual([
      { os: 'mac', arch: 'arm64' },
      { os: 'mac', arch: 'x64' },
    ])
  })

  it('the real lockfile pins every shipped target, at one version', () => {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
    const build = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')).build
    const versions = lspTargets(build, ['--mac', '--win']).map(({ os, arch }) => lockEntry(lock, typescriptPackage(os, arch)).version)
    expect(versions.length).toBeGreaterThanOrEqual(2)
    expect(new Set(versions).size).toBe(1)
    expect(build.extraResources).toContainEqual({ from: '.cache/lsp/typescript/${os}-${arch}', to: 'lsp/typescript' })
  })

  it('refuses a package the lockfile lacks, and bytes that do not match the integrity', () => {
    expect(() => lockEntry({ packages: {} }, '@typescript/typescript-win32-x64')).toThrow('add it to the root optionalDependencies')
    expect(() => verifyIntegrity(Buffer.from('a'), integrity(Buffer.from('b')))).toThrow('integrity mismatch')
    expect(() => verifyIntegrity(Buffer.from('a'), integrity(Buffer.from('a')))).not.toThrow()
  })

  it("copies the installed package's lib and legal files when its version is the lockfile's, then skips a second run", async () => {
    const pkg = '@typescript/typescript-darwin-arm64'
    writeLock({ [pkg]: { version: '7.0.2', resolved: 'https://registry.invalid/x.tgz', integrity: integrity(Buffer.from('unused')) } })
    writePackage(join(repo, 'node_modules', pkg), 'tsc', '7.0.2')
    const noFetch = () => {
      throw new Error('no download expected')
    }
    const first = await stageTypescript({ repo, os: 'mac', arch: 'arm64', fetchImpl: noFetch })
    expect(first).toEqual({ dir: stagedDir(repo, 'mac', 'arm64'), from: 'node_modules' })
    expect(readFileSync(join(first.dir, 'tsc'), 'utf8')).toBe('binary 7.0.2')
    expect(statSync(join(first.dir, 'tsc')).mode & 0o111).toBeTruthy()
    for (const f of ['lib.es5.d.ts', 'LICENSE', 'NOTICE.txt']) expect(existsSync(join(first.dir, f))).toBe(true)
    expect((await stageTypescript({ repo, os: 'mac', arch: 'arm64', fetchImpl: noFetch })).from).toBe('cache')
  })

  it('downloads and checks the tarball when the package is not installed (the Windows binary on a Mac)', async () => {
    const pkg = '@typescript/typescript-win32-x64'
    const bytes = tarball('tsc.exe', '7.0.2')
    writeLock({ [pkg]: { version: '7.0.2', resolved: 'https://registry.invalid/win.tgz', integrity: integrity(bytes) } })
    const fetched = []
    const fetchImpl = async (url) => (fetched.push(url), { ok: true, status: 200, arrayBuffer: async () => bytes })
    const result = await stageTypescript({ repo, os: 'win', arch: 'x64', fetchImpl })
    expect(result.from).toBe('download')
    expect(fetched).toEqual(['https://registry.invalid/win.tgz'])
    expect(readFileSync(join(result.dir, 'tsc.exe'), 'utf8')).toBe('binary 7.0.2')

    // A tampered tarball under the same lockfile entry is refused, and the staged copy is not replaced by it.
    rmSync(`${result.dir}.json`)
    const bad = async () => ({ ok: true, status: 200, arrayBuffer: async () => tarball('tsc.exe', '6.6.6') })
    await expect(stageTypescript({ repo, os: 'win', arch: 'x64', fetchImpl: bad })).rejects.toThrow('integrity mismatch')
    expect(readFileSync(join(result.dir, 'tsc.exe'), 'utf8')).toBe('binary 7.0.2')
  })
})

/** A `pyright` package folder: the entry, `dist/` with a source map, the legal file. */
function writePyright(dir, version) {
  mkdirSync(join(dir, 'dist', 'typeshed-fallback', 'stdlib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pyright', version }))
  writeFileSync(join(dir, 'LICENSE.txt'), 'MIT')
  writeFileSync(join(dir, 'langserver.index.js'), "require('./dist/pyright-langserver')")
  writeFileSync(join(dir, 'dist', 'pyright-langserver.js'), `server ${version}`)
  writeFileSync(join(dir, 'dist', 'pyright-langserver.js.map'), '{}')
  writeFileSync(join(dir, 'dist', 'typeshed-fallback', 'stdlib', 'builtins.pyi'), 'class int: ...')
  writeFileSync(join(dir, 'README.md'), 'readme')
}

describe('stagePyright (YAZ-3455)', () => {
  it('the real lockfile pins pyright, and the build copies the staged folder', () => {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
    const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const build = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')).build
    expect(root.devDependencies.pyright).toMatch(/^\d+\.\d+\.\d+$/)
    expect(lockEntry(lock, 'pyright').version).toBe(root.devDependencies.pyright)
    expect(build.extraResources).toContainEqual({ from: '.cache/lsp/pyright', to: 'lsp/pyright' })
  })

  it('copies the entry, dist without source maps and the license from node_modules, then skips a second run', async () => {
    writeLock({ pyright: { version: '1.1.414', resolved: 'https://registry.invalid/p.tgz', integrity: integrity(Buffer.from('unused')) } })
    writePyright(join(repo, 'node_modules', 'pyright'), '1.1.414')
    const noFetch = () => {
      throw new Error('no download expected')
    }
    const first = await stagePyright({ repo, fetchImpl: noFetch })
    expect(first).toEqual({ dir: pyrightStagedDir(repo), from: 'node_modules' })
    for (const f of ['langserver.index.js', 'LICENSE.txt', 'package.json', 'dist/pyright-langserver.js', 'dist/typeshed-fallback/stdlib/builtins.pyi']) expect(existsSync(join(first.dir, f)), f).toBe(true)
    expect(existsSync(join(first.dir, 'dist', 'pyright-langserver.js.map'))).toBe(false)
    expect(existsSync(join(first.dir, 'README.md'))).toBe(false)
    expect((await stagePyright({ repo, fetchImpl: noFetch })).from).toBe('cache')
  })

  it('downloads and checks the tarball when the installed version is not the lockfile\'s', async () => {
    const src = mkdtempSync(join(tmpdir(), 'yaz-3455-tgz-'))
    writePyright(join(src, 'package'), '1.1.414')
    execFileSync('tar', ['-czf', join(src, 'p.tgz'), '-C', src, 'package'])
    const bytes = readFileSync(join(src, 'p.tgz'))
    rmSync(src, { recursive: true, force: true })
    writeLock({ pyright: { version: '1.1.414', resolved: 'https://registry.invalid/p.tgz', integrity: integrity(bytes) } })
    writePyright(join(repo, 'node_modules', 'pyright'), '1.1.400')
    const result = await stagePyright({ repo, fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }) })
    expect(result.from).toBe('download')
    expect(readFileSync(join(result.dir, 'dist', 'pyright-langserver.js'), 'utf8')).toBe('server 1.1.414')
  })
})
