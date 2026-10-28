#!/usr/bin/env node
/**
 * USAGE: node tools/buildEngine.mjs [--force]
 *
 *   --force  build again even when the stamp says the build is current
 *
 * Builds the drawing engine (YAZ-3572 E1–E4): the app's own copy of Excalidraw in `engine/`, moved
 * there with its history from the fork repo. The app uses five of its packages, as npm workspaces
 * (root `package.json`); each one's `dist/` is what the app imports, and none is committed.
 *
 * The engine keeps its own tools: a `yarn install` in `engine/`, from the fork's own `yarn.lock`, so
 * `engine/` stays equal to the fork and an Excalidraw pull has no extra clashes (E3). Those tools must
 * never reach the app's bundle: the renderer, the share viewer, the client tests and the typecheck
 * read the engine with `preserveSymlinks` (YAZ-3574), so its imports resolve from the app's
 * `node_modules`, never from `engine/node_modules`.
 *
 * Idempotent and cheap when nothing changed: the stamp is a hash of the engine files that the build
 * reads, kept INSIDE the excalidraw `dist/`, so CI's cache restores the
 * stamp with the build (`.github/workflows/ci.yml`). `npm run build`, `dev`, `typecheck` and `test`
 * run it first; `npm run engine:build` alone.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const engine = join(repo, 'engine')

/** The five packages the app uses, in build order: each one needs only the ones before it. */
export const ENGINE_PACKAGES = ['common', 'math', 'fractional-indexing', 'element', 'excalidraw']

/** What the build reads. The same list is the cache key in `.github/workflows/ci.yml` and `release.yml`. */
export const ENGINE_INPUTS = ['engine/package.json', 'engine/yarn.lock', 'engine/scripts', 'engine/tsconfig.json', ...ENGINE_PACKAGES.map((p) => `engine/packages/${p}`)]

const STAMP = join(engine, 'packages', 'excalidraw', 'dist', '.docs-app-build')

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd} (exit ${r.status})`)
}

function git(args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

/**
 * A hash of the content of every file the build reads, tracked or new (not ignored), as it is on disk now. The
 * same files give the same stamp before and after a commit. Null outside a git checkout. About 1,100 files, about 0.2 s.
 */
export function engineStamp() {
  const listed = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...ENGINE_INPUTS])
  if (listed === null) return null
  const hash = createHash('sha256')
  for (const file of [...new Set(listed.split('\0').filter(Boolean))].sort()) {
    const abs = join(repo, file)
    if (existsSync(abs)) hash.update(file).update('\0').update(readFileSync(abs))
  }
  return hash.digest('hex')
}

/** Yarn 1, as the engine's `packageManager` names it: the one on PATH, else a pinned one through npx. */
function yarn() {
  const onPath = spawnSync('yarn', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' })
  return onPath.status === 0 && onPath.stdout.startsWith('1.') ? ['yarn'] : ['npx', '--yes', 'yarn@1.22.22']
}

export function buildEngine({ force = false } = {}) {
  const stamp = engineStamp()
  const built = ENGINE_PACKAGES.every((p) => existsSync(join(engine, 'packages', p, 'dist')))
  if (!force && built && stamp !== null && existsSync(STAMP) && readFileSync(STAMP, 'utf8') === stamp) {
    console.log('engine: up to date')
    return false
  }
  const [cmd, ...pre] = yarn()
  // Every build installs first: a changed `yarn.lock` must reach the tools, and with nothing to do yarn takes about a second.
  // `--ignore-scripts`: the fork's own `prepare` is `husky install`, which fails here (`engine/` has no `.git`) and would
  // point this repo's hooks at `engine/.husky`. The other install scripts (sharp, onnxruntime-node, @parcel/watcher) serve
  // the Excalidraw website, which never builds here; esbuild finds its binary through its platform package without one.
  run(cmd, [...pre, 'install', '--frozen-lockfile', '--ignore-scripts'], engine)
  for (const p of ENGINE_PACKAGES) run(cmd, [...pre, 'build:esm'], join(engine, 'packages', p))
  if (stamp !== null) writeFileSync(STAMP, stamp)
  console.log('engine: built')
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) buildEngine({ force: process.argv.includes('--force') })
