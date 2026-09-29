#!/usr/bin/env node
/**
 * USAGE: npm run perf:budget [-- --json] [-- --app <.app> --dmg <.dmg> --out <desktop/out>]
 *        npm run perf:budget:ci   (= --out-only)
 *
 * The size and integrity gate (YAZ-2131 1B, 🔒 D8). Measures the build against `budget.json` and
 * checks what no unit test sees (the packaged bundle); exits 1 on an integrity failure or a metric
 * over its ceiling.
 *   default     after `npm run desktop:build`: desktop/out + the packaged .app and .dmg (macOS)
 *   --out-only  after `npm run build`: desktop/out alone (CI; no packaging needed)
 * THE RATCHET: a change that shrinks a metric lowers its ceiling in budget.json in the same PR;
 * raising a ceiling needs Yasin's OK in the PR description. Read-only: never writes anywhere.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Bytes of a file or a directory tree (symlinks not followed: the framework is full of them); null when absent. */
function bytes(p) {
  const s = statSync(p, { throwIfNoEntry: false })
  if (!s) return null
  if (!s.isDirectory()) return s.size
  let n = 0
  for (const e of readdirSync(p, { withFileTypes: true })) if (!e.isSymbolicLink()) n += bytes(join(p, e.name)) ?? 0
  return n
}

/** Every file path in `app.asar`, read from its header `[u32 4][u32 pickle][u32 payload][u32 jsonLen][json]`. */
function asarFiles(file) {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const json = Buffer.alloc(head.readUInt32LE(12))
    readSync(fd, json, 0, json.length, 16)
    const files = []
    const visit = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        if (child.files) visit(child, `${prefix}${name}/`)
        else files.push(`${prefix}${name}`)
      }
    }
    visit(JSON.parse(json.toString('utf8')), '')
    return files
  } finally {
    closeSync(fd)
  }
}

/**
 * The renderer's chunk graph from index.html. `eager` is what parses before first paint (the entry's
 * static-import closure); `missing` is every `./x.js|css` a shipped chunk names that is not shipped:
 * a lazy path (a Mermaid diagram, a CodeMirror language) that would only fail when first used.
 * The quoted-`./` scan covers `from`, `import()` and Vite's `__vite__mapDeps` preload list alike.
 */
function rendererGraph(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  const entries = [...html.matchAll(/<script[^>]+src="\.\/([^"]+)"/g)].map((m) => m[1])
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.\/([^"]+)"/g)].map((m) => m[1])
  const eager = new Set()
  const seen = new Set()
  const missing = []
  const visit = (file, isEager) => {
    if (isEager ? eager.has(file) : seen.has(file)) return
    if (isEager) eager.add(file)
    seen.add(file)
    if (!existsSync(join(dir, file))) return void (missing.includes(file) || missing.push(file))
    if (!file.endsWith('.js')) return
    const src = readFileSync(join(dir, file), 'utf8')
    const at = (s) => posix.normalize(posix.join(posix.dirname(file), s))
    const statics = new Set([...src.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]))
    for (const s of statics) visit(at(s), isEager)
    for (const m of src.matchAll(/["'](\.{1,2}\/[\w.-]+\.(?:js|css))["']/g)) if (!statics.has(m[1])) visit(at(m[1]), false)
  }
  for (const f of [...entries, ...css]) visit(f, true)
  return { eager: [...eager], missing }
}

/** Every file under `root`, as `/`-joined relative paths. */
function walk(root, rel = '') {
  return readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(root, `${rel}${e.name}/`) : [`${rel}${e.name}`],
  )
}

/** The drawing component's font folder (YAZ-878). Reported on its own row, never gated (YAZ-2131: out of scope). */
const DRAWING_ASSETS = 'excalidraw-assets'

/** Metrics of `out` (desktop/out) and, when given, the packaged `app` and `dmg`. */
export function measure({ out, app, dmg }) {
  const m = {}
  if (app) {
    const res = join(app, 'Contents/Resources')
    const fwRes = join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources')
    const chromiumLproj = readdirSync(fwRes).filter((n) => n.endsWith('.lproj'))
    m.appBytes = bytes(app)
    m.frameworksBytes = bytes(join(app, 'Contents/Frameworks'))
    m.asarBytes = bytes(join(res, 'app.asar'))
    m.dmgBytes = dmg ? bytes(dmg) : null
    // Chromium's own UI strings (one locale.pak per language), apart from the app-level .lproj
    // markers that make Open/Save panels follow the OS language (those must stay 55).
    m.chromiumLocaleCount = chromiumLproj.length
    m.chromiumLocaleBytes = chromiumLproj.reduce((n, d) => n + (bytes(join(fwRes, d, 'locale.pak')) ?? 0), 0)
    m.lprojCount = readdirSync(res).filter((n) => n.endsWith('.lproj')).length
    m.asarNodeModulesFiles = asarFiles(join(res, 'app.asar')).filter((f) => f.startsWith('node_modules/')).length
  }
  const r = join(out, 'renderer')
  const files = walk(r)
  const { eager } = rendererGraph(r)
  const sum = (list) => list.reduce((n, f) => n + statSync(join(r, f)).size, 0)
  m.rendererEagerJsBytes = sum(eager.filter((f) => f.endsWith('.js')))
  m.rendererEagerCssBytes = sum(eager.filter((f) => f.endsWith('.css')))
  m.rendererTotalBytes = sum(files.filter((f) => !f.startsWith(`${DRAWING_ASSETS}/`)))
  m.rendererMapBytes = sum(files.filter((f) => f.endsWith('.map')))
  m.mainBundleBytes = bytes(join(out, 'main'))
  m.drawingAssetBytes = bytes(join(r, DRAWING_ASSETS))
  return m
}

/** Files every build ships under `out/`: the app, the `yaseendocs` command (YAZ-1617), the preload and the renderer. */
const REQUIRED_OUT = ['main/index.js', 'main/cli.js', 'preload/index.js', 'renderer/index.html']

/** Integrity of `desktop/out`: what CI can check after `npm run build`. */
function checkOut(out) {
  const fails = REQUIRED_OUT.filter((p) => !existsSync(join(out, p))).map((p) => `out: missing ${p}`)
  const r = join(out, 'renderer')
  if (!existsSync(join(r, 'index.html'))) return fails
  for (const f of rendererGraph(r).missing) fails.push(`renderer: ${f} is imported but not shipped`)
  if (!readdirSync(join(r, 'assets')).some((f) => /^KaTeX_Main-Regular-.*\.woff2$/.test(f))) fails.push("renderer: KaTeX fonts missing (the drawing Mermaid dialog's $$ labels lose their font)")
  // Keep-working only (the drawing is out of scope): without them drawing text falls back to the esm.sh CDN.
  if (!existsSync(join(r, DRAWING_ASSETS, 'fonts')) || walk(join(r, DRAWING_ASSETS, 'fonts')).length === 0) fails.push(`renderer: ${DRAWING_ASSETS}/fonts is empty (drawing text falls back to a CDN)`)
  return fails
}

/** Integrity of the packaged `.app`: Info.plist, the ad-hoc seal, the CLI shim, the asar payload. macOS only. */
function checkApp(app) {
  if (!existsSync(app)) return [`no app at ${app} (run npm run desktop:build, or use --out-only)`]
  const fails = []
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]).toString())
  if (!(plist.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? []).includes('yaseendocs')) fails.push('Info.plist: CFBundleURLSchemes lacks yaseendocs (deep links, GRO-2171)')
  const md = (plist.CFBundleDocumentTypes ?? []).find((d) => (d.CFBundleTypeExtensions ?? []).includes('md'))
  if (md?.CFBundleTypeRole !== 'Editor' || md?.LSHandlerRank !== 'Alternate') fails.push('Info.plist: .md is not an Editor/Alternate document type')
  // The deep ad-hoc seal (desktop/build/adhocSign.cjs): without it Gatekeeper calls a download "damaged".
  if (!/Signature=adhoc/.test(spawnSync('codesign', ['-dv', app]).stderr.toString())) fails.push('codesign: not ad-hoc sealed')
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', app])
  if (verify.status !== 0) fails.push(`codesign --verify --deep --strict failed: ${verify.stderr.toString().slice(0, 300)}`)
  const bin = statSync(join(app, 'Contents/Resources/bin/yaseendocs'), { throwIfNoEntry: false })
  if (!bin || !(bin.mode & 0o111)) fails.push('Resources/bin/yaseendocs missing or not executable (the command Copy for Agent advertises)')
  const inAsar = new Set(asarFiles(join(app, 'Contents/Resources/app.asar')))
  for (const p of REQUIRED_OUT) if (!inAsar.has(`out/${p}`)) fails.push(`asar: missing out/${p}`)
  return fails
}

/** Rows outside their `{ max, min }`. `tolerance` absorbs build-to-build jitter (a DMG differs by tens of bytes). */
export function outOfBudget(metrics, ceilings, tolerance = 0) {
  const out = []
  for (const [k, { max, min }] of Object.entries(ceilings)) {
    const v = metrics[k]
    if (v == null) continue
    if (max != null && v - max > max * tolerance) out.push(`${k} ${v} > ceiling ${max}`)
    if (min != null && v < min) out.push(`${k} ${v} < floor ${min}`)
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = dirname(fileURLToPath(import.meta.url))
  const repo = resolve(here, '../..')
  const argv = process.argv.slice(2)
  const arg = (name, dflt) => (argv.includes(`--${name}`) ? resolve(argv[argv.indexOf(`--${name}`) + 1]) : dflt)
  const outOnly = argv.includes('--out-only')
  const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const out = arg('out', join(repo, 'desktop/out'))
  const app = outOnly ? null : arg('app', join(repo, 'desktop/dist-app/mac-arm64/Yaseen Docs.app'))
  const dmg = outOnly ? null : arg('dmg', join(repo, `desktop/dist-app/Yaseen Docs-${version}-arm64.dmg`))
  const budget = JSON.parse(readFileSync(join(here, 'budget.json'), 'utf8'))

  const fails = [...checkOut(out), ...(app ? checkApp(app) : [])]
  const metrics = fails.some((f) => f.startsWith('no app')) ? {} : measure({ out, app, dmg })
  // A packaged run gates the DMG too: an absent one would otherwise skip its row and still PASS.
  if (metrics.appBytes != null && metrics.dmgBytes == null) fails.push(`no dmg at ${dmg} (run npm run desktop:build)`)
  const over = outOfBudget(metrics, budget.size, budget.sizeTolerance)
  if (argv.includes('--json')) console.log(JSON.stringify({ version, mode: outOnly ? 'out-only' : 'packaged', metrics, over, fails }, null, 2))
  else {
    const fmt = (n) => (n == null ? '-' : n >= 1e5 ? `${(n / 1e6).toFixed(2)} MB` : String(n))
    for (const [k, v] of Object.entries(metrics)) {
      const row = budget.size[k]
      console.log(`${k.padEnd(24)} ${fmt(v).padStart(10)}   ${row ? `ceiling ${fmt(row.max)}` : 'not gated (drawing component, out of scope)'}`)
    }
    for (const f of fails) console.log('INTEGRITY FAIL:', f)
    for (const o of over) console.log('OVER BUDGET:', o)
    console.log(fails.length || over.length ? 'GATE: FAIL' : 'GATE: PASS')
  }
  process.exit(fails.length || over.length ? 1 : 0)
}
