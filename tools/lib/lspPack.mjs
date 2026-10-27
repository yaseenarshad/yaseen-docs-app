/**
 * The TypeScript 7 language server for the packaged app (YAZ-3453, 4A of the code tab's D9).
 *
 * TypeScript 7 is a native binary, one npm package for each platform
 * (`@typescript/typescript-<platform>-<arch>`, root `optionalDependencies`). npm installs only the
 * package of the machine it runs on, but `npm run desktop:build:win` packs Windows on a Mac. So
 * this step stages each target's files into the gitignored `desktop/.cache/lsp/typescript/<os>-<arch>/`,
 * and electron-builder copies that folder to `Resources/lsp/typescript/` (`extraResources`, with
 * electron-builder's `${os}-${arch}`: `${platform}` would be the BUILD machine's).
 *
 * Source of each target: the installed package when its version is the lockfile's, else the
 * lockfile's `resolved` tarball, checked against the lockfile's `integrity` (sha512). Staged: the
 * package's `lib/` (the binary reads the `lib.*.d.ts` beside it) plus its `LICENSE` and `NOTICE.txt`.
 * Idempotent: a stamp beside the folder names the staged version and hash, and a match skips the copy.
 *
 * `stagePyright` (end of file) does the same for the Python helper (YAZ-3455).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** electron-builder's `${os}` → Node's `process.platform`, which names the npm package. */
const NODE_PLATFORM = { mac: 'darwin', win: 'win32', linux: 'linux' }

export function typescriptPackage(os, arch) {
  const platform = NODE_PLATFORM[os]
  if (!platform) throw new Error(`unknown target os "${os}"`)
  return `@typescript/typescript-${platform}-${arch}`
}

export function binaryName(os) {
  return os === 'win' ? 'tsc.exe' : 'tsc'
}

/** The staged folder of one target, and its stamp file. */
export function stagedDir(repo, os, arch) {
  return join(repo, 'desktop', '.cache', 'lsp', 'typescript', `${os}-${arch}`)
}
const stampPath = (dir) => `${dir}.json`

/** The lockfile's record of `pkg`: `{ version, resolved, integrity }`. Throws when the lockfile lacks it. */
export function lockEntry(lock, pkg) {
  const entry = lock.packages?.[`node_modules/${pkg}`]
  if (!entry?.version || !entry.resolved || !entry.integrity) {
    throw new Error(`${pkg} is not in package-lock.json: add it to the root optionalDependencies (same version as the other @typescript/typescript-* packages) and run npm install`)
  }
  return { version: entry.version, resolved: entry.resolved, integrity: entry.integrity }
}

/** Throws unless `bytes` match an npm `integrity` string (`sha512-<base64>`). */
export function verifyIntegrity(bytes, integrity) {
  const [algo, expected] = integrity.split('-', 2)
  if (algo !== 'sha512') throw new Error(`unsupported integrity algorithm "${algo}"`)
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (actual !== expected) throw new Error(`integrity mismatch: expected sha512-${expected}, got sha512-${actual}`)
}

/** The electron-builder targets of `args` (`--mac`, `--win`): `[{ os, arch }]`, archs from `build.<os>.target`. */
export function lspTargets(build, args) {
  const targets = []
  for (const os of ['mac', 'win']) {
    if (!args.includes(`--${os}`)) continue
    const archs = new Set((build[os]?.target ?? []).flatMap((t) => (typeof t === 'string' ? ['x64'] : (t.arch ?? ['x64']))))
    for (const arch of archs) targets.push({ os, arch })
  }
  return targets
}

/**
 * The folder of `pkg` at the lockfile's version: the installed one when its version matches, else
 * the lockfile's tarball, checked against its `integrity` and unpacked into `work`.
 */
async function packageSource({ repo, pkg, entry, work, fetchImpl }) {
  const installedDir = join(repo, 'node_modules', ...pkg.split('/'))
  const installed = existsSync(join(installedDir, 'package.json')) ? JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8')).version : null
  if (installed === entry.version) return { pkgDir: installedDir, from: 'node_modules' }
  console.log(`[lsp] downloading ${entry.resolved}`)
  const res = await fetchImpl(entry.resolved)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${entry.resolved}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  verifyIntegrity(bytes, entry.integrity)
  const tgz = join(work, 'package.tgz')
  writeFileSync(tgz, bytes)
  // bsdtar on macOS and Windows 10+, GNU tar on Linux: all read .tgz.
  execFileSync('tar', ['-xzf', tgz, '-C', work])
  return { pkgDir: join(work, 'package'), from: 'download' }
}

/**
 * Stages one target's files (see top of file). Returns `{ dir, from }`, `from` being `cache`,
 * `node_modules` or `download`. `fetchImpl` is for tests.
 */
export async function stageTypescript({ repo, os, arch, fetchImpl = globalThis.fetch }) {
  const pkg = typescriptPackage(os, arch)
  const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'))
  const entry = lockEntry(lock, pkg)
  const dir = stagedDir(repo, os, arch)
  const stamp = JSON.stringify({ package: pkg, version: entry.version, integrity: entry.integrity })
  if (existsSync(join(dir, binaryName(os))) && existsSync(stampPath(dir)) && readFileSync(stampPath(dir), 'utf8') === stamp) return { dir, from: 'cache' }

  // The work folder sits beside the result, so the last step is a rename on one disk.
  mkdirSync(join(dir, '..'), { recursive: true })
  const work = mkdtempSync(join(dir, '..', '.staging-'))
  try {
    const { pkgDir, from } = await packageSource({ repo, pkg, entry, work, fetchImpl })
    const out = join(work, 'staged')
    cpSync(join(pkgDir, 'lib'), out, { recursive: true })
    for (const legal of ['LICENSE', 'NOTICE.txt']) if (existsSync(join(pkgDir, legal))) cpSync(join(pkgDir, legal), join(out, legal))
    const exe = join(out, binaryName(os))
    if (!existsSync(exe)) throw new Error(`${pkg}@${entry.version} has no lib/${binaryName(os)}`)
    if (os !== 'win') chmodSync(exe, 0o755)
    rmSync(dir, { recursive: true, force: true })
    renameSync(out, dir)
    writeFileSync(stampPath(dir), stamp)
    return { dir, from }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * THE PYTHON HELPER (YAZ-3455 4C): `pyright`, pinned in the root `devDependencies`. It is a Node
 * program, the same for every target, so one folder: `desktop/.cache/lsp/pyright/`, which
 * electron-builder copies to `Resources/lsp/pyright/`. Staged: `package.json`, `LICENSE.txt`, the
 * `langserver.index.js` entry and `dist/` without its source maps (`*.map`, 2.7 MB nobody reads).
 * Same source rule and the same stamp as TypeScript.
 */
export const PYRIGHT_PACKAGE = 'pyright'
export const PYRIGHT_ENTRY = 'langserver.index.js'

export function pyrightStagedDir(repo) {
  return join(repo, 'desktop', '.cache', 'lsp', 'pyright')
}

export async function stagePyright({ repo, fetchImpl = globalThis.fetch }) {
  const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'))
  const entry = lockEntry(lock, PYRIGHT_PACKAGE)
  const dir = pyrightStagedDir(repo)
  const stamp = JSON.stringify({ package: PYRIGHT_PACKAGE, version: entry.version, integrity: entry.integrity })
  if (existsSync(join(dir, PYRIGHT_ENTRY)) && existsSync(stampPath(dir)) && readFileSync(stampPath(dir), 'utf8') === stamp) return { dir, from: 'cache' }

  mkdirSync(join(dir, '..'), { recursive: true })
  const work = mkdtempSync(join(dir, '..', '.staging-'))
  try {
    const { pkgDir, from } = await packageSource({ repo, pkg: PYRIGHT_PACKAGE, entry, work, fetchImpl })
    const out = join(work, 'staged')
    mkdirSync(out)
    for (const file of ['package.json', 'LICENSE.txt', PYRIGHT_ENTRY]) if (existsSync(join(pkgDir, file))) cpSync(join(pkgDir, file), join(out, file))
    cpSync(join(pkgDir, 'dist'), join(out, 'dist'), { recursive: true, filter: (src) => !src.endsWith('.map') })
    if (!existsSync(join(out, PYRIGHT_ENTRY)) || !existsSync(join(out, 'dist', 'pyright-langserver.js'))) throw new Error(`${PYRIGHT_PACKAGE}@${entry.version} has no ${PYRIGHT_ENTRY} or dist/pyright-langserver.js`)
    rmSync(dir, { recursive: true, force: true })
    renameSync(out, dir)
    writeFileSync(stampPath(dir), stamp)
    return { dir, from }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
