import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { helperFolder, typescriptPin } from './download'
import { TYPESCRIPT_PINS } from './pins'
import { findProjectRoot, isInside } from './projectRoot'
import { typescriptSpec } from './typescript'

/** The project of a file (YAZ-3454): the nearest marker folder, never the home folder. */

const H = path.resolve('/home/me')
const disk = (...files: string[]) => (f: string) => files.map((x) => path.resolve(x)).includes(path.resolve(f))

describe('findProjectRoot (YAZ-3454)', () => {
  it('takes the nearest folder with a marker', () => {
    const exists = disk(path.join(H, 'repo', 'package.json'), path.join(H, 'repo', 'client', 'tsconfig.json'))
    expect(findProjectRoot(path.join(H, 'repo', 'client', 'src', 'a.ts'), ['tsconfig.json', 'package.json'], exists, [H])).toBe(path.join(H, 'repo', 'client'))
    expect(findProjectRoot(path.join(H, 'repo', 'tools', 'x.mjs'), ['tsconfig.json', 'package.json'], exists, [H])).toBe(path.join(H, 'repo'))
  })

  it('a stray package.json in the home folder makes no project (S7: one-file help)', () => {
    const exists = disk(path.join(H, 'package.json'))
    expect(findProjectRoot(path.join(H, 'notes', 'a.ts'), ['package.json'], exists, [H])).toBeNull()
  })

  it('isInside: the folder itself and what is under it, nothing beside it', () => {
    expect(isInside(path.join(H, 'v', 'a.py'), path.join(H, 'v'))).toBe(true)
    expect(isInside(path.join(H, 'v'), path.join(H, 'v'))).toBe(true)
    expect(isInside(path.join(H, 'v2', 'a.py'), path.join(H, 'v'))).toBe(false)
  })

  it('the TypeScript spec: no binary, no helper; the lib folder beside the binary is its own', () => {
    const lspRoot = path.resolve('/data/lsp')
    const bin = path.join(helperFolder(lspRoot, typescriptPin(process.platform, process.arch) ?? TYPESCRIPT_PINS['darwin-arm64']), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
    const spec = typescriptSpec({ lspRoot, devCopies: false, appPath: '' }, disk(bin, '/w/p/tsconfig.json'))
    expect(spec.projectRoot(path.resolve('/w/p/src/a.ts'), '/w')).toBe(path.resolve('/w/p'))
    if (process.platform !== 'win32' && typescriptPin(process.platform, process.arch) !== null) {
      expect(spec.command('/w/p')).toMatchObject({ command: bin, args: ['--lsp', '--stdio'], cwd: '/w/p' })
      expect(spec.ownFolder?.()).toBe(path.dirname(bin))
    }
    expect(typescriptSpec({ lspRoot, devCopies: false, appPath: '' }, disk()).command('/w/p')).toBeNull()
  })
})
