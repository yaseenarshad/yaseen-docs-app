import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Rollup } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dropMonacoTsWorkerUrl, friendsOffInMain, renderSourcemapsAside } from './electron.vite.config'

describe('renderSourcemapsAside (YAZ-2183)', () => {
  let root = ''
  beforeEach(async () => void (root = await mkdtemp(path.join(tmpdir(), 'yaz-2183-maps-'))))
  afterEach(async () => rm(root, { recursive: true, force: true }))
  const out = () => path.join(root, 'out', 'renderer')
  const maps = () => path.join(root, '.maps', '0.9.27')
  const files = async (dir: string) => (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort()
  /** Writes a bundle the way Vite would, then runs the plugin's hook on it. */
  const build = async (names: string[]) => {
    for (const name of names) {
      await mkdir(path.dirname(path.join(out(), name)), { recursive: true })
      await writeFile(path.join(out(), name), name)
    }
    const hook = renderSourcemapsAside(out(), maps()).writeBundle as (options: unknown, bundle: Rollup.OutputBundle) => Promise<void>
    await hook({}, Object.fromEntries(names.map((n) => [n, {}])) as Rollup.OutputBundle)
  }

  it("moves every map out of the renderer output, keeping each one's path, and leaves the code where it was", async () => {
    await build(['index.html', 'assets/index-a1.js', 'assets/index-a1.js.map', 'assets/percentages-b2.js', 'assets/percentages-b2.js.map', 'assets/index-c3.css'])
    expect(await files(out())).toEqual(['assets/index-a1.js', 'assets/index-c3.css', 'assets/percentages-b2.js', 'index.html'])
    expect(await files(maps())).toEqual(['assets/index-a1.js.map', 'assets/percentages-b2.js.map'])
  })

  it("replaces the version's maps whole, so a rebuild keeps only its own", async () => {
    await build(['assets/index-a1.js', 'assets/index-a1.js.map'])
    await build(['assets/index-d4.js', 'assets/index-d4.js.map'])
    expect(await files(maps())).toEqual(['assets/index-d4.js.map'])
  })

  it('keeps sibling main and renderer sourcemap directories disjoint across sequential builds (YAZ-6026)', async () => {
    const mainOut = path.join(root, 'out', 'main')
    const mainMaps = path.join(maps(), 'main')
    const rendererMaps = path.join(maps(), 'renderer')
    await mkdir(mainOut, { recursive: true })
    await writeFile(path.join(mainOut, 'index.js'), 'main')
    await writeFile(path.join(mainOut, 'index.js.map'), 'main-map')
    const mainHook = renderSourcemapsAside(mainOut, mainMaps).writeBundle as (options: unknown, bundle: Rollup.OutputBundle) => Promise<void>
    await mainHook({}, Object.fromEntries(['index.js', 'index.js.map'].map((n) => [n, {}])) as Rollup.OutputBundle)

    await mkdir(path.join(out(), 'assets'), { recursive: true })
    await writeFile(path.join(out(), 'assets', 'index-a1.js'), 'renderer')
    await writeFile(path.join(out(), 'assets', 'index-a1.js.map'), 'renderer-map')
    const rendererHook = renderSourcemapsAside(out(), rendererMaps).writeBundle as (options: unknown, bundle: Rollup.OutputBundle) => Promise<void>
    await rendererHook({}, Object.fromEntries(['assets/index-a1.js', 'assets/index-a1.js.map'].map((n) => [n, {}])) as Rollup.OutputBundle)

    expect(await files(mainMaps)).toEqual(['index.js.map'])
    expect(await files(rendererMaps)).toEqual(['assets/index-a1.js.map'])
  })
})

describe('dropMonacoTsWorkerUrl (YAZ-3501)', () => {
  const transform = dropMonacoTsWorkerUrl().transform as (code: string, id: string) => { code: string } | null
  const file = createRequire(path.join(__dirname, '..', 'client', 'package.json')).resolve('monaco-editor/languages/features/typescript/workerManager.js')

  it("removes the dead `new Worker(new URL('ts.worker.js'))` from Monaco's real workerManager.js, and nothing else", () => {
    const code = readFileSync(file, 'utf8')
    const out = transform(code, file)!.code
    expect(out).not.toContain("new URL('ts.worker.js'")
    expect(out).toContain('createWorker: () => (() => {')
    expect(out.replace(/createWorker: [^\n]*/, '')).toBe(code.replace(/createWorker: [^\n]*/, ''))
  })

  it('leaves every other file alone, and fails the build when the call moved', () => {
    expect(transform("new Worker(new URL('ts.worker.js', import.meta.url), { type: \"module\" })", '/x/other.js')).toBeNull()
    expect(() => transform('export {}', file)).toThrow(/YAZ-3501/)
  })
})

describe('friendsOffInMain (YAZ-5652)', () => {
  const resolve = (on: boolean, source: string, importer?: string) => (friendsOffInMain(on).resolveId as (s: string, i?: string) => string | null)(source, importer)
  const INDEX = '/repo/desktop/src/main/index.ts'

  it("off: main's `./friends` is an empty module, so the sender and its count worker are not built", () => {
    const stub = resolve(false, './friends', INDEX)
    expect(stub).toBe('\0friends-off')
    const load = friendsOffInMain(false).load as (id: string) => string | null
    expect(load(stub!)).toContain('export function startFriendsSend')
  })

  it('on, or any other import: left to Vite', () => {
    expect(resolve(true, './friends', INDEX)).toBeNull()
    expect(resolve(false, './friends', '/repo/desktop/src/main/other.ts')).toBeNull()
    expect(resolve(false, './ipc/friends', INDEX)).toBeNull()
  })
})
