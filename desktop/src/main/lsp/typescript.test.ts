import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TYPESCRIPT_PINS } from './pins'
import { resolveTypescriptServer, typescriptServerCommand } from './typescript'

/** Where the TypeScript 7 binary is (YAZ-3453; YAZ-3500: downloaded, then a dev build's node_modules). */
describe('resolveTypescriptServer (YAZ-3453, YAZ-3500)', () => {
  const lspRoot = path.resolve('/data/lsp')
  const base = { lspRoot, appPath: '/repo/desktop', platform: 'darwin' as const, arch: 'arm64' }
  const downloaded = path.join(lspRoot, `typescript-darwin-arm64-${TYPESCRIPT_PINS['darwin-arm64'].version}`, 'lib', 'tsc')
  const hoisted = path.join('/repo', 'node_modules', '@typescript', 'typescript-darwin-arm64', 'lib', 'tsc')

  it('the downloaded copy of the pinned version first: <userData>/lsp/typescript-<platform>-<arch>-<version>/lib/tsc (tsc.exe on Windows)', () => {
    expect(resolveTypescriptServer({ ...base, devCopies: true, exists: (p) => p === downloaded || p === hoisted })).toBe(downloaded)
    expect(resolveTypescriptServer({ ...base, devCopies: false, exists: (p) => p === downloaded })).toBe(downloaded)
    const win = path.join(lspRoot, `typescript-win32-x64-${TYPESCRIPT_PINS['win32-x64'].version}`, 'lib', 'tsc.exe')
    expect(resolveTypescriptServer({ ...base, platform: 'win32', arch: 'x64', devCopies: false, exists: (p) => p === win })).toBe(win)
    // Another version's folder is not the pinned one.
    expect(resolveTypescriptServer({ ...base, devCopies: false, exists: (p) => p === path.join(lspRoot, 'typescript-darwin-arm64-6.9.9', 'lib', 'tsc') })).toBeNull()
  })

  it("dev: then the nearest node_modules copy of this platform's package, from desktop/ upward", () => {
    expect(resolveTypescriptServer({ ...base, devCopies: true, exists: (p) => p === hoisted })).toBe(hoisted)
    const local = path.join('/repo/desktop', 'node_modules', '@typescript', 'typescript-darwin-arm64', 'lib', 'tsc')
    expect(resolveTypescriptServer({ ...base, devCopies: true, exists: (p) => p === local || p === hoisted })).toBe(local)
    expect(resolveTypescriptServer({ ...base, devCopies: true, exists: () => false })).toBeNull()
  })

  it('packaged (no dev copies): only the download; none, no helper', () => {
    expect(resolveTypescriptServer({ ...base, devCopies: false, exists: (p) => p === hoisted })).toBeNull()
    // A platform with no pinned package: no helper.
    expect(resolveTypescriptServer({ ...base, platform: 'linux', arch: 'x64', devCopies: false, exists: () => true })).toBeNull()
  })

  it('starts the binary with --lsp --stdio in the project folder', () => {
    expect(typescriptServerCommand('/bin/tsc', '/vault/project')).toEqual({ name: 'typescript', command: '/bin/tsc', args: ['--lsp', '--stdio'], cwd: '/vault/project' })
  })
})
