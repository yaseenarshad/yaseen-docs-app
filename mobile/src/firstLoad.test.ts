/**
 * YAZ-5377: the size guard of the first load. The whole phone app is built (the real Vite build), as the publish
 * builds it. The test fails when:
 *
 * 1. the first load's JavaScript (the app's entry chunk and every chunk it imports statically) is over
 *    `FIRST_LOAD_JS_MAX` (`publish/checkBuild.ts`, which `npm run mobile:build` also checks);
 * 2. a heavy module that only a lazy screen needs is in the first load (it names the module and its import chain);
 * 3. a dev-only or test-only module is in ANY chunk of the build.
 */
import { fileURLToPath } from 'node:url'
import type { OutputChunk, RollupOutput } from 'rollup'
import { build, type Plugin } from 'vite'
import { describe, expect, it } from 'vitest'
import { FIRST_LOAD_JS_MAX, NEVER_BUNDLED, NOT_FIRST_LOAD } from '../publish/checkBuild'
import { phoneStylesheets } from '../publish/stylesheets'

const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const short = (id: string) => id.replace(ROOT, '').replace(/^.*\/node_modules\//, 'node_modules/')

/** The static import chain from `main.tsx` to each module, read from Rollup's module graph. */
function chainsPlugin(chains: Map<string, string[]>, css: Set<string>): Plugin {
  return {
    name: 'first-load-chains',
    buildEnd() {
      const ids = [...this.getModuleIds()]
      for (const id of ids) if (/\.css$/.test(id)) css.add(id)
      const main = ids.find((i) => i.endsWith('mobile/src/main.tsx'))
      if (!main) return
      const prev = new Map<string, string | null>([[main, null]])
      const queue = [main]
      while (queue.length > 0) {
        const id = queue.shift()!
        for (const next of this.getModuleInfo(id)?.importedIds ?? []) if (!prev.has(next)) (prev.set(next, id), queue.push(next))
      }
      for (const id of prev.keys()) {
        const chain: string[] = []
        for (let c: string | null | undefined = id; c; c = prev.get(c)) chain.unshift(short(c))
        chains.set(short(id), chain)
      }
    },
  }
}

async function buildPhone() {
  const chains = new Map<string, string[]>()
  const css = new Set<string>()
  // The real build's React and minifier: Vitest sets NODE_ENV to "test", and React then bundles its dev build.
  const before = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const out = (await build({ configFile: CONFIG, logLevel: 'silent', mode: 'production', build: { write: false }, plugins: [chainsPlugin(chains, css)] })) as RollupOutput
    return { out, chains, css }
  } finally {
    process.env.NODE_ENV = before
  }
}

describe('the first load stays small (YAZ-5377, YAZ-5362)', () => {
  it('is under its ceiling, holds no lazy-only module, and no chunk holds a dev or test module', async () => {
    const { out, chains, css } = await buildPhone()
    // YAZ-5358: the stylesheets that the contrast test reads from the imports are the ones the build bundles.
    expect([...css].map(short).sort()).toEqual(phoneStylesheets().map(short).sort())
    const chunks = out.output.filter((o): o is OutputChunk => o.type === 'chunk')
    const byName = new Map(chunks.map((c) => [c.fileName, c]))
    const entry = chunks.find((c) => c.isEntry && /\/index\.html$/.test(c.facadeModuleId ?? ''))!
    // The first load: the entry and every chunk it reaches through static imports.
    const first = new Set<string>()
    const walk = (name: string) => {
      if (first.has(name)) return
      first.add(name)
      for (const n of byName.get(name)?.imports ?? []) walk(n)
    }
    walk(entry.fileName)
    const eager = chunks.filter((c) => first.has(c.fileName))
    const bytes = eager.reduce((n, c) => n + Buffer.byteLength(c.code), 0)
    const eagerModules = eager.flatMap((c) => Object.keys(c.modules)).map(short)

    // 2. Each heavy module that came into the first load, with the import chain that brought it.
    // One line for each package (its entry module), not one for each of its files.
    const pkg = (m: string) => /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(m)?.[1]
    const seen = new Set<string>()
    const heavy = eagerModules
      .filter((m) => NOT_FIRST_LOAD.some((r) => r.test(m)))
      .map((m) => chains.get(m) ?? [m])
      .map((chain) => chain.slice(0, chain.findIndex((m) => pkg(m) !== undefined) + 1 || chain.length))
      .filter((chain) => !seen.has(chain.at(-1)!) && seen.add(chain.at(-1)!))
      .map((chain) => chain.join(' -> '))
    expect(heavy).toEqual([])
    // 1. The ceiling.
    expect(bytes, `first-load JS is ${bytes} bytes (${eager.map((c) => c.fileName).join(', ')})`).toBeLessThanOrEqual(FIRST_LOAD_JS_MAX)
    // 3. No dev-only or test-only module in any production chunk.
    const all = chunks.flatMap((c) => Object.keys(c.modules).map((m) => `${c.fileName}: ${short(m)}`))
    expect(all.filter((line) => NEVER_BUNDLED.some((r) => r.test(line.split(': ')[1])))).toEqual([])
  }, 180_000)
})
