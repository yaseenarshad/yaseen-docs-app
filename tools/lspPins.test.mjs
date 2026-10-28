import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lockEntry, lspPins, pinsSource } from './lib/lspPins.mjs'

/**
 * The language helpers' pins (YAZ-3500): `desktop/src/main/lsp/pins.ts` is what the root lockfile gives, so a
 * version bump cannot ship old pins. Main downloads from these URLs and checks these sha512s.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const SHA = `sha512-${'A'.repeat(86)}==`

describe('lspPins (YAZ-3500)', () => {
  it('pins.ts is up to date with package-lock.json (run node tools/lspPins.mjs after a helper version change)', () => {
    expect(readFileSync(join(root, 'desktop', 'src', 'main', 'lsp', 'pins.ts'), 'utf8')).toBe(pinsSource(lock))
  })

  it('pins TypeScript 7 of every shipped platform at one version, and pyright, all on the npm registry', () => {
    const pins = lspPins(lock)
    expect(Object.keys(pins.typescript)).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64'])
    expect(new Set(Object.values(pins.typescript).map((p) => p.version)).size).toBe(1)
    expect(pins.python.package).toBe('pyright')
    for (const p of [...Object.values(pins.typescript), pins.python]) expect(p.url.startsWith('https://registry.npmjs.org/')).toBe(true)
    // The root package.json pins the same versions a dev build runs.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pins.python.version).toBe(pkg.devDependencies.pyright)
    expect(pins.typescript['darwin-arm64'].version).toBe(pkg.optionalDependencies['@typescript/typescript-darwin-arm64'])
  })

  it('refuses a package the lockfile lacks, a tarball off the registry, and an integrity that is not sha512', () => {
    const at = (entry) => ({ packages: { 'node_modules/x': entry } })
    expect(() => lockEntry({ packages: {} }, 'x')).toThrow('not in package-lock.json')
    expect(() => lockEntry(at({ version: '1.0.0', resolved: 'https://evil.example/x.tgz', integrity: SHA }), 'x')).toThrow('not on https://registry.npmjs.org/')
    expect(() => lockEntry(at({ version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz', integrity: 'sha1-abc' }), 'x')).toThrow('not one sha512')
    expect(lockEntry(at({ version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz', integrity: SHA }), 'x')).toEqual({ version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz', integrity: SHA })
  })
})
