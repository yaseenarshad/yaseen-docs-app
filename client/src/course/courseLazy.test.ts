/**
 * The course is a lazy chunk (YAZ-5120): nothing the window loads at start imports the course itself. The test walks
 * the static import graph from the renderer's entry (`main.tsx`), as the build does: `import … from`, `export … from`
 * and side-effect imports; never `import type` or `import()`. The only course files it may reach are the small
 * eager ones: the facts, the door, and the Settings row.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')
const SHARED = resolve(__dirname, '../../../shared')
const COURSE_DIR = resolve(__dirname)
const EAGER_OK = new Set(['courseFacts.ts', 'openCourse.ts', 'courseSettings.tsx'])

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@shared/') ? join(SHARED, spec.slice('@shared/'.length)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && !candidate.endsWith('/') && /\.(tsx?|css)$/.test(candidate)) return candidate
  }
  return null
}

/** The static imports of a module: the ones the build puts in the same chunk. */
function staticImports(file: string): string[] {
  if (file.endsWith('.css')) return []
  const text = readFileSync(file, 'utf8')
  const specs = [
    ...[...text.matchAll(/^\s*import\s+(?!type[\s{])[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*export\s+(?!type[\s{])[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
  ]
  return specs.map((spec) => resolveImport(file, spec)).filter((f): f is string => f !== null)
}

function eagerGraph(entry: string): Set<string> {
  const seen = new Set<string>()
  const todo = [entry]
  while (todo.length > 0) {
    const file = todo.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    todo.push(...staticImports(file))
  }
  return seen
}

describe('the course loads only when it opens (YAZ-5120)', () => {
  const eager = eagerGraph(join(SRC, 'main.tsx'))

  it('walks a real graph: App and Settings are in it', () => {
    expect(eager.size).toBeGreaterThan(300)
    expect(eager.has(join(SRC, 'App.tsx'))).toBe(true)
    expect(eager.has(join(SRC, 'settings/registry.tsx'))).toBe(true)
    expect(eager.has(join(COURSE_DIR, 'courseSettings.tsx'))).toBe(true)
  })

  it('reaches no course file but the facts, the door and the Settings row: not the script, the player, the layer or its CSS', () => {
    const course = [...eager].filter((f) => f.startsWith(`${COURSE_DIR}/`)).map((f) => relative(COURSE_DIR, f))
    expect(course.filter((f) => !EAGER_OK.has(f))).toEqual([])
    for (const lazy of ['script.ts', 'player.ts', 'CardCourse.tsx', 'course.css', 'CourseOffer.tsx']) expect(eager.has(join(COURSE_DIR, lazy))).toBe(false)
  })

  it('App loads the layer with import() only', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8')
    expect(app).toContain("import('./course/CardCourse')")
  })
})
