/**
 * Desktop renderer first-load bundle wall (YAZ-6008 D11/D12, YAZ-6029).
 *
 * Mirrors mobile's `bundleWalls.test.ts`:
 *  1. Static source-level guard (runs in <200 ms, even without a build): verifies that `App.tsx` and
 *     `Editor.tsx` never statically import lazy-only subsystems (`FolderView`, `SettingsDialog`,
 *     `FrontmatterPanel`, `CommentsSection`, `DrawingModal`, `ImageModal`, `KeySheet`, `RecentList`,
 *     `CodeEditor`, `CardCourse`, `Excalidraw`, `Monaco`).
 *  2. Built-artifact closure check (runs whenever `desktop/out/renderer/index.html` exists): walks
 *     the real Vite entry chunk's static import graph and verifies none of the heavy lazy chunks leak
 *     into the first-load closure.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Modules that MUST stay behind dynamic `import()` / `React.lazy()` so desktop cold start stays lean. */
const LAZY_ONLY_SOURCE_SPECS = [
  { file: 'client/src/App.tsx', forbidden: [/SettingsDialog$/, /KeySheet$/, /RecentList$/, /CardCourse$/, /ImageStudio$/, /@excalidraw/, /monaco-editor/] },
  { file: 'client/src/editor/Editor.tsx', forbidden: [/FolderView$/, /FrontmatterPanel$/, /CommentsSection$/, /DrawingModal$/, /ImageModal$/, /CodeEditor$/, /CardFileView$/, /@excalidraw/, /monaco-editor/] },
]

/** Chunk name fragments that MUST NOT appear in the desktop entry static import closure. */
const NOT_FIRST_LOAD_CHUNKS = [
  /^SettingsDialog-/,
  /^KeySheet-/,
  /^FolderView-/,
  /^FrontmatterPanel-/,
  /^CommentsSection-/,
  /^DrawingModal-/,
  /^ImageModal-/,
  /^RecentList-/,
  /^CodeEditor-/,
  /^CardCourse-/,
  /^ImageStudio-/,
  /excalidraw/i,
  /monaco/i,
]

/** Static non-type imports of `file` (excludes `import type ...` which are erased at compile time). */
function runtimeStaticImports(relFile) {
  const text = readFileSync(path.join(ROOT, relFile), 'utf8')
  const sf = ts.createSourceFile(relFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const specs = []
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && !stmt.importClause?.isTypeOnly && ts.isStringLiteral(stmt.moduleSpecifier)) {
      specs.push(stmt.moduleSpecifier.text)
    }
  }
  return specs
}

/** Walks static ESM imports starting from `entryFile` inside `rendererDir`. */
function staticChunkClosure(rendererDir, entryRel) {
  const seen = new Set()
  const queue = [entryRel]
  const IMPORT_RE = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.\/[^'"]+\.js)['"]|\bimport\s*['"](\.\/[^'"]+\.js)['"]/g
  while (queue.length > 0) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    const full = path.join(rendererDir, rel)
    if (!existsSync(full)) continue
    const code = readFileSync(full, 'utf8')
    const baseDir = path.dirname(rel)
    for (const m of code.matchAll(IMPORT_RE)) {
      const target = m[1] || m[2]
      const resolved = path.posix.normalize(path.posix.join(baseDir, target))
      if (!seen.has(resolved)) queue.push(resolved)
    }
  }
  return seen
}

describe('desktop renderer first-load wall (YAZ-6029)', () => {
  for (const { file, forbidden } of LAZY_ONLY_SOURCE_SPECS) {
    it(`${file} has no static runtime imports of lazy-only subsystems`, () => {
      const specs = runtimeStaticImports(file)
      const leaked = specs.filter((spec) => forbidden.some((re) => re.test(spec)))
      expect(leaked).toEqual([])
    })
  }

  it('built desktop/out/renderer entry closure contains zero lazy-only chunks', () => {
    const rendererDir = path.join(ROOT, 'desktop', 'out', 'renderer')
    const htmlPath = path.join(rendererDir, 'index.html')
    if (!existsSync(htmlPath)) return // before build: static AST check above still enforces the wall
    const html = readFileSync(htmlPath, 'utf8')
    const entryMatch = /<script[^>]+src="\.?\/?(assets\/[^"]+\.js)"/.exec(html)
    expect(entryMatch, 'entry script tag in desktop/out/renderer/index.html').not.toBeNull()
    const closure = [...staticChunkClosure(rendererDir, entryMatch[1])]
    const basenames = closure.map((rel) => path.basename(rel))
    const leaked = basenames.filter((name) => NOT_FIRST_LOAD_CHUNKS.some((re) => re.test(name)))
    expect(leaked).toEqual([])
  })
})
