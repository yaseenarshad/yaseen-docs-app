import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * The `tools/` project: plain-ESM suites for the repo's node tools (packaging steps, the perf
 * gate and harness), on real files and processes — no jsdom. One alias, `@shared`: the draw.io overlay
 * suite reads the client's `drawioProtocol.ts`, which imports from it (YAZ-3028).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    name: 'tools',
    environment: 'node',
    include: ['*.test.mjs', 'perf/*.test.mjs'],
    // Packaging cases run real tools.
    testTimeout: 60_000,
  },
})
