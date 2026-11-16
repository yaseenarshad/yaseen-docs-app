import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { buildDefine, phoneResolve } from './vite.config'

/**
 * The `mobile` project of the root vitest run: the app's aliases and its one React (`phoneResolve`), Node by default.
 *
 * NOT the import guard (`phoneImportGuard`, YAZ-5160). The guard checks what the phone BUNDLES. Vitest loads tests and
 * test helpers, which run in Node and are never bundled, and the guard stopped `src/rules.test.ts` from loading. The
 * rule is tested by `importRules.test.ts`, and by `src/rules.test.ts`, which walks every file the app reaches.
 * `testConfig.test.ts` fails if the guard comes back here.
 */
/**
 * YAZ-5358: each stylesheet import of the app's code becomes a tiny module that says it loaded
 * (`globalThis.__notecardsCss(file)`). The contrast test (`src/contrast.screens.test.tsx`) so learns which stylesheets
 * each screen REALLY loads, and in which order, from the imports themselves. With no listener it does nothing (Vitest
 * gave each stylesheet an empty module before, so no other test changes).
 */
export function recordStylesheets(): Plugin {
  const PREFIX = '\0notecards-css:'
  return {
    name: 'notecards-css-record',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!/\.css$/.test(source) || importer === undefined || importer.includes('/node_modules/')) return null
      const found = await this.resolve(source, importer, { ...options, skipSelf: true })
      return found ? `${PREFIX}${found.id}.js` : null
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null
      return `;(globalThis.__notecardsCss ?? (() => {}))(${JSON.stringify(id.slice(PREFIX.length, -3))})`
    },
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), recordStylesheets()],
  resolve: phoneResolve,
  // YAZ-5446: the build's version, time and commit, as the build sets them; a fixed time, so a test can read it.
  define: buildDefine(new Date('2026-11-14T10:42:00Z')),
  test: {
    name: 'mobile',
    // Store tests run in plain Node with fake-indexeddb; a file that draws React says `@vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'publish/**/*.test.ts', '*.test.ts'],
    // The friends model checkers' full runs take minutes: only with CHECK3_FULL=1 (src/friends/check3/run.ts,
    // src/friends/check4/run4.ts, src/friends/check5/run5.testing.ts: the stale-read attack, YAZ-5398; src/friends/check6/run6.testing.ts: the list file gone, YAZ-5444).
    // The checkers' research tools (one seed, shrink, replay, attack runners) are not tests: `*.research.ts`, run by
    // `npm run mobile:friends-research` (vitest.research.config.ts).
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.CHECK3_FULL === '1' ? [] : ['src/friends/check3/{seeds,mine}-*.test.ts', 'src/friends/check4/{full4,mine4}-*.test.ts', 'src/friends/check5/full5-*.test.ts', 'src/friends/check6/sample6-*.test.ts', 'src/friends/check6/sample8-*.test.ts']),
    ],
  },
})
