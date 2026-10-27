import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTypescriptServer, typescriptServerCommand } from './typescript'

/** Where the TypeScript 7 binary is, packaged and in dev (YAZ-3453). */
describe('resolveTypescriptServer (YAZ-3453)', () => {
  const base = { resourcesPath: '/App.app/Contents/Resources', appPath: '/repo/desktop', platform: 'darwin' as const, arch: 'arm64' }

  it('packaged: Resources/lsp/typescript/tsc (tsc.exe on Windows), or null when it is missing', () => {
    expect(resolveTypescriptServer({ ...base, isPackaged: true, exists: () => true })).toBe(path.join('/App.app/Contents/Resources', 'lsp', 'typescript', 'tsc'))
    expect(resolveTypescriptServer({ ...base, platform: 'win32', arch: 'x64', resourcesPath: 'C:\\App\\resources', isPackaged: true, exists: () => true })).toBe(path.join('C:\\App\\resources', 'lsp', 'typescript', 'tsc.exe'))
    expect(resolveTypescriptServer({ ...base, isPackaged: true, exists: () => false })).toBeNull()
  })

  it("dev: the nearest node_modules copy of this platform's package, from desktop/ upward", () => {
    const hoisted = path.join('/repo', 'node_modules', '@typescript', 'typescript-darwin-arm64', 'lib', 'tsc')
    expect(resolveTypescriptServer({ ...base, isPackaged: false, exists: (p) => p === hoisted })).toBe(hoisted)
    const local = path.join('/repo/desktop', 'node_modules', '@typescript', 'typescript-darwin-arm64', 'lib', 'tsc')
    expect(resolveTypescriptServer({ ...base, isPackaged: false, exists: (p) => p === local || p === hoisted })).toBe(local)
    expect(resolveTypescriptServer({ ...base, isPackaged: false, exists: () => false })).toBeNull()
  })

  it('starts the binary with --lsp --stdio in the project folder', () => {
    expect(typescriptServerCommand('/bin/tsc', '/vault/project')).toEqual({ name: 'typescript', command: '/bin/tsc', args: ['--lsp', '--stdio'], cwd: '/vault/project' })
  })
})
