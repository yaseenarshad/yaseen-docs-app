/**
 * The two rules of `mobile/` (README.md), read from the source:
 * 1. Only `src/store/` touches browser storage. Every other file goes through `VaultStore`.
 * 2. Nothing in `src/` imports Electron, Node, the desktop app or the drawing engine. The build checks the same for
 *    every module it bundles (`phoneImportGuard` in vite.config.ts), so an import through `client/` is caught too.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { forbiddenImport } from '../importRules'

const SRC = fileURLToPath(new URL('.', import.meta.url))

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
