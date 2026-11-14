/**
 * The two rules of `mobile/` (README.md), read from the source:
 * 1. Only `src/store/` touches browser storage. Every other file goes through `VaultStore`.
 * 2. Nothing in `src/` imports Electron, Node, the desktop app or the drawing engine. The build checks the same for
 *    every module it bundles (`phoneImportGuard` in vite.config.ts), so an import through `client/` is caught too.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { forbiddenImport, forbiddenUse } from '../importRules'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(SRC, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}
const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }))
const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.endsWith('store/testing.ts')

const BROWSER_STORAGE = /\b(indexedDB|IDBFactory|IDBDatabase|localStorage|sessionStorage|caches\.open|navigator\.storage|document\.cookie|fake-indexeddb)\b/

describe('the rules of mobile/', () => {
  it('reads some files (the walk works)', () => {
    expect(files.some((f) => f.path === 'main.tsx')).toBe(true)
  })

  it('no code outside src/store/ touches browser storage', () => {
    const outside = files.filter((f) => !f.path.startsWith('store/') && !isTest(f.path) && BROWSER_STORAGE.test(f.text))
    expect(outside.map((f) => f.path)).toEqual([])
  })

  it('no app file imports Electron, Node, the desktop app or the drawing engine', () => {
    const bad: string[] = []
    for (const f of files.filter((f) => !isTest(f.path))) {
      for (const m of f.text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
        const why = forbiddenImport(m[1])
        if (why) bad.push(`${f.path}: ${m[1]} (${why})`)
      }
    }
    expect(bad).toEqual([])
  })
})

/** Where an import of `from` lands, for the repo's own sources; `null` for a package. */
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@client/') ? join(REPO, 'client/src', spec.slice(8)) : spec.startsWith('@shared/') ? join(REPO, 'shared', spec.slice(8)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

/** Every repo source file the app's code reaches through its imports, from each non-test file of mobile/src. */
function reachedFiles(): string[] {
  const seen = new Set<string>()
  const queue = sourceFiles(SRC).filter((p) => !isTest(relative(SRC, p)))
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
      const next = resolveImport(file, m[1])
      if (next !== null && /\.(ts|tsx)$/.test(next)) queue.push(next)
    }
  }
  return [...seen]
}

// YAZ-5158 (3A3): the rule holds for what the app REACHES, not only for mobile/src. A screen that reuses a client file
// which calls the desktop bridge or browser storage fails here (and in the build: phoneImportGuard), not on the phone.
describe('what the phone app reaches through its imports', () => {
  it('no reached file is a forbidden path, or uses the desktop bridge or browser storage outside mobile/src/store', () => {
    const bad: string[] = []
    for (const file of reachedFiles()) {
      const why = forbiddenImport(file) ?? forbiddenUse(file, readFileSync(file, 'utf8'))
      if (why) bad.push(`${relative(REPO, file)} (${why})`)
    }
    expect(bad).toEqual([])
  })

  it('the walk follows @shared imports (it reaches shared/fileKind.ts)', () => {
    expect(reachedFiles().map((f) => relative(REPO, f))).toContain('shared/fileKind.ts')
  })
})
