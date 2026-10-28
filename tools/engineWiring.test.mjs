import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { ENGINE_INPUTS, ENGINE_PACKAGES } from './buildEngine.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const read = (file) => readFileSync(join(repo, file), 'utf8')

/**
 * The drawing engine is the app's own source in `engine/` (YAZ-3572). Two things keep the bundle the same as
 * the packed builds were (YAZ-3574): npm links each of the five packages to `engine/`, never to npm's stock
 * copy; and the five readers of the engine keep `preserveSymlinks`, so its imports never reach the build
 * tools in `engine/node_modules` (React 19, mermaid 11.12).
 */
it('links each engine package to engine/, never to a copy from npm', () => {
  const lock = JSON.parse(read('package-lock.json')).packages
  for (const name of ENGINE_PACKAGES) {
    expect(realpathSync(join(repo, 'node_modules', '@excalidraw', name))).toBe(realpathSync(join(repo, 'engine', 'packages', name)))
    const entries = Object.entries(lock).filter(([path]) => path.endsWith(`node_modules/@excalidraw/${name}`))
    expect(entries.map(([, entry]) => entry)).toEqual([{ resolved: `engine/packages/${name}`, link: true }])
  }
})

it('reads the engine where it is linked, in the renderer, the share viewer, the client tests, the perf tests and the typecheck', () => {
  expect(read('desktop/electron.vite.config.ts')).toMatch(/^\s+preserveSymlinks: true,$/m)
  expect(read('tools/buildShareViewer.mjs')).toMatch(/^\s+preserveSymlinks: true,$/m)
  expect(read('client/vitest.config.ts')).toMatch(/^\s+preserveSymlinks: true,$/m)
  expect(read('client/vitest.perf.config.ts')).toMatch(/^\s+preserveSymlinks: true,$/m)
  expect(read('client/tsconfig.json')).toMatch(/^\s+"preserveSymlinks": true,$/m)
})

it("keys CI's engine cache on exactly the files the build reads", () => {
  const files = ENGINE_INPUTS.map((input) => (/\.[a-z]+$/.test(input) ? `'${input}'` : `'${input}/**'`)).join(', ')
  // `engine/scripts` and the packages are folders; the rest are files (`.env.production` too, by its leading dot).
  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    expect(read(workflow)).toContain(`key: engine-\${{ runner.os }}-\${{ hashFiles(${files}) }}`)
  }
})
