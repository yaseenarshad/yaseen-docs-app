/**
 * Enforceable architectural guardrails (YAZ-6008 D11/D12, YAZ-6029).
 *
 * Uses TypeScript's own parser (already a devDependency; zero new runtime deps) to enforce:
 *  1. Strict layer import boundaries (`shared/`, `client/src/`, `desktop/src/main/`).
 *  2. Zero production imports of test-only helpers (`*TestKit`, `*Fixture`, `*.test.*`, `*.testing.*`).
 *  3. Shrink-only allowlist of blocking `fs.*Sync` calls in `desktop/src/main/` (preserving documented `reconcile.ts` GRO-2229).
 *  4. Shrink-only allowlist of no-dependency `useEffect`/`useLayoutEffect` calls in `client/src/` and `mobile/src/`.
 *  5. God-file line-count ratchet so the 5 largest files cannot silently bloat.
 *  6. Negative self-tests proving every rule detects synthetic violations.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TEST_FILE_RE = /(?:^|\/)(?:watchConformance\.ts|.*(?:\.test|\.spec|\.testing|\.research|Fixture|TestKit)\.[jt]sx?)$|^mobile\/src\/(?:dev\/|friends\/check\d+\/)/
const SYNC_FS_RE = /^(?:readFileSync|writeFileSync|readdirSync|statSync|lstatSync|existsSync|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync)$/

function walkSourceFiles(relDir, out = []) {
  const absDir = path.join(ROOT, relDir)
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name)
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out' || entry.name === 'dist-app') continue
      walkSourceFiles(rel, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !TEST_FILE_RE.test(rel)) {
      out.push({ abs, rel })
    }
  }
  return out
}

function parseFile(rel, sourceText) {
  return ts.createSourceFile(rel, sourceText, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** Collects static `import ... from`, `export ... from`, and dynamic `import('...')` specifiers. */
export function extractImportSpecifiers(sourceText, rel = 'sample.ts') {
  const sf = parseFile(rel, sourceText)
  const specs = []
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return specs
}

/** Finds calls to blocking `fs.*Sync(...)` functions in a TS source file. */
export function findSyncFsCalls(sourceText, rel = 'sample.ts') {
  const sf = parseFile(rel, sourceText)
  const hits = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : ''
      if (SYNC_FS_RE.test(name)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        hits.push({ name, line: line + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** Finds `useEffect(fn)` / `useLayoutEffect(fn)` calls with no dependency array. */
export function findNoDepsEffects(sourceText, rel = 'sample.tsx') {
  const sf = parseFile(rel, sourceText)
  const hits = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : ''
      if ((name === 'useEffect' || name === 'useLayoutEffect') && node.arguments.length === 1) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        hits.push({ name, line: line + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

const LAYER_RULES = [
  {
    name: 'shared/ stays platform-neutral (no React, Electron, Node builtins, or app layers)',
    dir: 'shared',
    isForbidden: (spec) => /^(react|react-dom|electron|node:|@client|@desktop|@mobile)/.test(spec) || /(^|\/)(client|desktop|mobile)\//.test(spec),
  },
  {
    name: 'client/src/ stays renderer-safe (no Electron, Node builtins, main process, or mobile)',
    dir: 'client/src',
    isForbidden: (spec) => /^(electron|node:|@desktop|@mobile)/.test(spec) || /(^|\/)(desktop\/src\/main|mobile\/src)\//.test(spec),
  },
  {
    name: 'desktop/src/main/ stays UI-free (no React, client renderer, or mobile)',
    dir: 'desktop/src/main',
    isForbidden: (spec) => /^(react|react-dom|@client|@mobile)/.test(spec) || /(^|\/)(client\/src|mobile\/src)\//.test(spec),
  },
]

const TEST_ONLY_IMPORT_RE = /(?:TestKit|Fixture|\.test|\.testing)(?:\.[jt]sx?)?$/

/**
 * Shrink-only allowlist of main-process files that call `fs.*Sync`.
 * NOTE: `desktop/src/main/vaultIndex/reconcile.ts` intentionally uses `statSync` per GRO-2229 benchmark
 * (async `stat` regresses warm 10k-page vault open from ~27 ms to ~660 ms due to libuv threadpool contention).
 */
const ALLOWED_MAIN_SYNC_FS_FILES = new Set([
  'desktop/src/main/fs/treeWatcher.ts',
  'desktop/src/main/git/resolve.ts',
  'desktop/src/main/index.ts',
  'desktop/src/main/ipc/cardFormats.ts',
  'desktop/src/main/ipc/window.ts',
  'desktop/src/main/library/copyLibrary.ts',
  'desktop/src/main/lsp/download.ts',
  'desktop/src/main/lsp/python.ts',
  'desktop/src/main/store.ts',
  'desktop/src/main/updater.ts',
  'desktop/src/main/vaultConfig.ts',
  'desktop/src/main/vaultIndex/reconcile.ts',
  'desktop/src/main/watchedFolder.ts',
])

/** Shrink-only ceiling on no-deps `useEffect` / `useLayoutEffect` across `client/src` + `mobile/src`. */
const MAX_NO_DEPS_EFFECTS = 16

/** God-file line-count ceilings (current + ~2% headroom so large files cannot quietly double). */
const GOD_FILE_MAX_LINES = {
  'client/src/App.tsx': 4850,
  'client/src/sidebar/Sidebar.tsx': 2850,
  'client/src/views/view/TableView.tsx': 2500,
  'client/src/editor/Editor.tsx': 1850,
  'client/src/editor/createCrepe.ts': 1400,
}

describe('enforceable architectural guardrails (YAZ-6029)', () => {
  for (const rule of LAYER_RULES) {
    it(`layer boundary: ${rule.name}`, () => {
      const violations = []
      for (const { abs, rel } of walkSourceFiles(rule.dir)) {
        for (const spec of extractImportSpecifiers(readFileSync(abs, 'utf8'), rel)) {
          if (rule.isForbidden(spec)) violations.push(`${rel} -> ${spec}`)
        }
      }
      expect(violations).toEqual([])
    })
  }

  it('production source files never import test-only kits or fixtures', () => {
    const violations = []
    for (const dir of ['shared', 'client/src', 'desktop/src/main', 'mobile/src']) {
      for (const { abs, rel } of walkSourceFiles(dir)) {
        for (const spec of extractImportSpecifiers(readFileSync(abs, 'utf8'), rel)) {
          if (TEST_ONLY_IMPORT_RE.test(spec)) violations.push(`${rel} -> ${spec}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('desktop/src/main/ adds no new blocking fs.*Sync files beyond the documented allowlist', () => {
    const unexpected = []
    for (const { abs, rel } of walkSourceFiles('desktop/src/main')) {
      if (ALLOWED_MAIN_SYNC_FS_FILES.has(rel)) continue
      const hits = findSyncFsCalls(readFileSync(abs, 'utf8'), rel)
      if (hits.length > 0) unexpected.push(`${rel}: ${hits.map((h) => `${h.name}@L${h.line}`).join(', ')}`)
    }
    expect(unexpected).toEqual([])
  })

  it(`no-dependency useEffect/useLayoutEffect count stays <= ${MAX_NO_DEPS_EFFECTS}`, () => {
    const hits = []
    for (const dir of ['client/src', 'mobile/src']) {
      for (const { abs, rel } of walkSourceFiles(dir)) {
        const text = readFileSync(abs, 'utf8')
        if (!text.includes('useEffect') && !text.includes('useLayoutEffect')) continue
        for (const h of findNoDepsEffects(text, rel)) hits.push(`${rel}:${h.line} (${h.name})`)
      }
    }
    expect(hits.length, `No-deps effects (${hits.length} > ${MAX_NO_DEPS_EFFECTS}):\n${hits.join('\n')}`).toBeLessThanOrEqual(MAX_NO_DEPS_EFFECTS)
  })

  it('largest files stay under their line-count ratchet', () => {
    const over = []
    for (const [rel, maxLines] of Object.entries(GOD_FILE_MAX_LINES)) {
      const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n').length
      if (lines > maxLines) over.push(`${rel}: ${lines} lines > max ${maxLines}`)
    }
    expect(over).toEqual([])
  })

  describe('negative self-tests (rules fail when violated)', () => {
    it('detects forbidden cross-layer imports (static and dynamic)', () => {
      const badClient = `import { app } from 'electron'\nconst x = () => import('node:fs')\n`
      const specs = extractImportSpecifiers(badClient, 'client/src/bad.ts')
      expect(specs.filter((s) => LAYER_RULES[1].isForbidden(s))).toEqual(['electron', 'node:fs'])
    })

    it('detects test-only fixture/kit imports', () => {
      const badProd = `import { helper } from './headingFoldTestKit'\nimport { make } from './gitFixture'\n`
      const specs = extractImportSpecifiers(badProd, 'client/src/prod.ts')
      expect(specs.filter((s) => TEST_ONLY_IMPORT_RE.test(s))).toEqual(['./headingFoldTestKit', './gitFixture'])
    })

    it('detects blocking fs.*Sync calls', () => {
      const badMain = `import { readFileSync } from 'node:fs'\nexport const x = () => readFileSync('/tmp/a', 'utf8')\n`
      expect(findSyncFsCalls(badMain, 'desktop/src/main/newFile.ts')).toEqual([{ name: 'readFileSync', line: 2 }])
    })

    it('detects no-dependency useEffect calls while allowing dependency arrays', () => {
      const sample = `useEffect(() => { run() })\nuseEffect(() => { run() }, [a])\nuseLayoutEffect(() => { measure() })\n`
      expect(findNoDepsEffects(sample, 'client/src/Sample.tsx')).toEqual([
        { name: 'useEffect', line: 1 },
        { name: 'useLayoutEffect', line: 3 },
      ])
    })
  })
})
