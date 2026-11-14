import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'
import { phoneResolve } from './vite.config'

/**
 * The `mobile` project of the root vitest run: the app's aliases and its one React (`phoneResolve`), Node by default.
 *
 * NOT the import guard (`phoneImportGuard`, YAZ-5160). The guard checks what the phone BUNDLES. Vitest loads tests and
 * test helpers, which run in Node and are never bundled, and the guard stopped `src/rules.test.ts` from loading. The
 * rule is tested by `importRules.test.ts`, and by `src/rules.test.ts`, which walks every file the app reaches.
 * `testConfig.test.ts` fails if the guard comes back here.
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: phoneResolve,
  test: {
    name: 'mobile',
    // Store tests run in plain Node with fake-indexeddb; a file that draws React says `@vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'publish/**/*.test.ts', '*.test.ts'],
    // The friends model checkers' full runs take minutes: only with CHECK3_FULL=1 (src/friends/check3/run.ts,
    // src/friends/check4/run4.ts). The round 4 checker's own tools (one seed, shrink, its first attack runner) need their
    // own settings: only with CHECK4_TOOLS=1.
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.CHECK3_FULL === '1' ? [] : ['src/friends/check3/{seeds,mine}-*.test.ts', 'src/friends/check3/show.test.ts', 'src/friends/check4/{full4,mine4}-*.test.ts']),
      ...(process.env.CHECK4_TOOLS === '1' ? [] : ['src/friends/check4/{attack,classify,msgs,one,scanold,shrink}.test.ts']),
    ],
  },
})
