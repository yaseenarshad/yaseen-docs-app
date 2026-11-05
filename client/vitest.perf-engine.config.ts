import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * The timing budget that types in a REAL engine (`textBoxTyping.perf.test.ts`, YAZ-4312). It loads and inlines the
 * whole engine, so it runs in a group of its own AFTER the other timing budgets (`vitest.perf.config.ts`, group 1):
 * sharing their group made their medians fail on the CI runner (YAZ-4277, PR #247: a different budget failed on 4 of 5
 * runs, none on our code). Same environment and alias as `client`; files one at a time.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
    // As the client project (YAZ-3574): the engine's imports resolve from the app's node_modules.
    preserveSymlinks: true,
  },
  test: {
    name: 'perf-engine',
    environment: 'jsdom',
    css: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/drawings/textBoxTyping.perf.test.ts'],
    testTimeout: 30_000,
    sequence: { groupOrder: 2 },
    fileParallelism: false,
    // as the client project: the REAL engine's dist inlined
    server: { deps: { inline: [/@excalidraw\//] } },
  },
})
