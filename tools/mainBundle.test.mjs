import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'electron-vite'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * THE PACKAGED APP SHIPS NO node_modules (GRO-2151, YAZ-2185). electron-builder copies
 * `desktop/package.json`'s `dependencies` into `app.asar`, and electron-vite 5 externalizes exactly
 * those by default — so a runtime dependency there is `require`d from an asar `node_modules` rather
 * than bundled. This builds main (both entries, the app and the `yaseendocs` command) and preload
 * with the real `electron.vite.config.ts` and holds both halves: nothing is left to install, and the
 * bundle loads nothing but Node built-ins, electron and its own chunks.
 */
const DESKTOP = fileURLToPath(new URL('../desktop', import.meta.url))
const BUILTIN = new Set([...builtinModules, 'electron'])

let out
beforeAll(async () => {
  out = await mkdtemp(path.join(tmpdir(), 'yaseendocs-main-bundle-'))
  // electron-vite reads the `dependencies` it externalizes from the CWD's package.json, as `npm run build -w desktop` sees it.
  const cwd = process.cwd()
  process.chdir(DESKTOP)
  try {
    const { config } = await resolveConfig({ logLevel: 'silent', build: { outDir: out } }, 'build', 'production')
    await build(config.main)
    await build(config.preload)
  } finally {
    process.chdir(cwd)
  }
}, 120_000)
afterAll(() => rm(out, { recursive: true, force: true }))

/** Every module specifier a built (CommonJS) file loads, by `require('…')` or `import('…')`. */
async function specifiers(dir) {
  const found = new Set()
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?js$/.test(entry.name)) continue
    const code = await readFile(path.join(entry.parentPath, entry.name), 'utf8')
    for (const m of code.matchAll(/\b(?:require|import)\(\s*["'`]([\w@./:-]+)["'`]\s*\)/g)) found.add(m[1])
  }
  return [...found]
}

describe('the main-process bundle', () => {
  it('declares no runtime dependencies for electron-builder to pack', async () => {
    const pkg = JSON.parse(await readFile(path.join(DESKTOP, 'package.json'), 'utf8'))
    expect(pkg.dependencies ?? {}).toEqual({})
  })

  it('loads only Node built-ins, electron and its own chunks — chokidar is inside it', async () => {
    const loaded = await specifiers(out)
    expect(loaded.length).toBeGreaterThan(0)
    const bare = loaded.filter((s) => !s.startsWith('.') && !s.startsWith('node:') && !BUILTIN.has(s.split('/')[0]))
    expect(bare).toEqual([])
  })

  // YAZ-4071 7B: Settings › Storage's worker holds the walk, the shrink and the picture store only — not the vault
  // index and its `yaml` parser (a save's board ID, 4C, once pulled them in: 21 KB became 276 KB).
  it('keeps the Settings › Storage worker small: no vault index, no yaml', async () => {
    const name = (await readdir(out, { recursive: true })).find((f) => /(^|\/)storageWorker-[\w-]+\.js$/.test(f))
    expect(name).toBeDefined()
    const code = await readFile(path.join(out, name), 'utf8')
    expect(code.includes('requireDirectives')).toBe(false)
    expect(Buffer.byteLength(code)).toBeLessThan(40_000)
  })
})

// YAZ-5086 / YAZ-5277: the Mac's card count runs on a worker thread. It is built and loaded as the Settings › Storage
// worker is: a file of its own next to `index.js` in `out/main`, found by `__dirname` at run time, and packed into
// `app.asar` by `files: ["out/**"]`. So the packaged app loads it from the same place as the storage worker.
describe('the count worker of the friends send (YAZ-5086)', () => {
  it('is built next to index.js, which loads it by __dirname; the packaged file list takes it', async () => {
    const files = await readdir(path.join(out, 'main'))
    const name = files.find((f) => /^countWorker-[\w-]+\.js$/.test(f))
    expect(name).toBeDefined()
    const index = await readFile(path.join(out, 'main', 'index.js'), 'utf8')
    expect(index).toMatch(new RegExp(`\\.join\\(__dirname, "\\./${name.replace(/[.-]/g, '\\$&')}"\\)`))
    const worker = await readFile(path.join(out, 'main', name), 'utf8')
    expect(worker).toMatch(/worker_threads/)
    expect(worker).not.toMatch(/require\("electron"\)/)
    const pkg = JSON.parse(await readFile(path.join(DESKTOP, 'package.json'), 'utf8'))
    expect(pkg.build.files).toContain('out/**')
    expect(pkg.build.files.filter((f) => f.startsWith('!')).some((f) => /out\/main|countWorker/.test(f))).toBe(false)
  })
})
