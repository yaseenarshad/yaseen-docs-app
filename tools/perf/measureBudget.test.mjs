/**
 * The size and integrity gate (YAZ-2131 1B) run as CI runs it, `--out-only` against a fixture
 * `desktop/out` and the REAL budget.json: it passes a small healthy build and fails the moment a
 * metric crosses its ceiling or a shipped file goes missing.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { outOfBudget } from './measureBudget.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'measureBudget.mjs')
let out

const put = (rel, body = '') => {
  mkdirSync(dirname(join(out, rel)), { recursive: true })
  writeFileSync(join(out, rel), body)
}
/** A file of `size` bytes without writing them (sparse): the gate reads sizes, never contents. */
const grow = (rel, size) => truncateSync(join(out, rel), size)
const gate = () => {
  const r = spawnSync(process.execPath, [script, '--out-only', '--out', out], { encoding: 'utf8' })
  return { code: r.status, text: r.stdout + r.stderr }
}

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'perf-budget-'))
  put('main/index.js', 'require("./chunks/file.js")')
  put('main/chunks/file.js')
  put('main/cli.js')
  put('preload/index.js')
  put('renderer/index.html', '<script type="module" crossorigin src="./assets/index.js"></script>\n<link rel="stylesheet" crossorigin href="./assets/index.css">')
  put('renderer/assets/index.js', 'import { a } from "./shared.js"; const m = () => import("./mermaid.js");')
  put('renderer/assets/shared.js')
  put('renderer/assets/mermaid.js')
  put('renderer/assets/index.css')
  put('renderer/assets/KaTeX_Main-Regular-abc.woff2')
  put('renderer/excalidraw-assets/fonts/Virgil/Virgil.woff2')
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

describe('perf:budget:ci', () => {
  it('passes a healthy build under every ceiling', () => {
    const { code, text } = gate()
    expect(text).toContain('GATE: PASS')
    expect(code).toBe(0)
  })

  it('fails when a metric is pushed over its ceiling in budget.json', () => {
    grow('main/chunks/file.js', 2_000_000) // mainBundleBytes' ceiling is v0.9.27's 411,774
    const { code, text } = gate()
    expect(text).toMatch(/OVER BUDGET: mainBundleBytes \d+ > ceiling 411774/)
    expect(text).toContain('GATE: FAIL')
    expect(code).toBe(1)
  })

  it('counts the eager closure: a statically imported chunk is eager JS', () => {
    grow('renderer/assets/shared.js', 6_000_000)
    expect(gate().text).toMatch(/OVER BUDGET: rendererEagerJsBytes/)
  })

  it('never gates the drawing component: its bytes are reported on their own row', () => {
    grow('renderer/excalidraw-assets/fonts/Virgil/Virgil.woff2', 30_000_000)
    const { code, text } = gate()
    expect(text).toMatch(/drawingAssetBytes\s+30\.00 MB\s+not gated/)
    expect(code).toBe(0)
  })

  it('fails when a lazily imported chunk is not shipped', () => {
    rmSync(join(out, 'renderer/assets/mermaid.js'))
    const { code, text } = gate()
    expect(text).toContain('INTEGRITY FAIL: renderer: assets/mermaid.js is imported but not shipped')
    expect(code).toBe(1)
  })

  it('fails when the yaseendocs command or the math fonts are not built', () => {
    rmSync(join(out, 'main/cli.js'))
    rmSync(join(out, 'renderer/assets/KaTeX_Main-Regular-abc.woff2'))
    const { code, text } = gate()
    expect(text).toContain('INTEGRITY FAIL: out: missing main/cli.js')
    expect(text).toContain('INTEGRITY FAIL: renderer: KaTeX fonts missing')
    expect(code).toBe(1)
  })
})

describe('outOfBudget', () => {
  it('holds an exact row both ways, and lets only the tolerance through', () => {
    const rows = { lprojCount: { max: 55, min: 55 }, dmgBytes: { max: 1000 } }
    expect(outOfBudget({ lprojCount: 55, dmgBytes: 1001 }, rows, 0.001)).toEqual([])
    expect(outOfBudget({ lprojCount: 54, dmgBytes: 1002 }, rows, 0.001)).toEqual(['lprojCount 54 < floor 55', 'dmgBytes 1002 > ceiling 1000'])
  })
})
