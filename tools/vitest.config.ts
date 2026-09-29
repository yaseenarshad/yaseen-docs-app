import { defineConfig } from 'vitest/config'

/**
 * The `tools/` project: plain-ESM suites for the repo's node tools (migrations, packaging steps,
 * the perf gate and harness), on real files and processes — no alias, no jsdom.
 */
export default defineConfig({
  test: {
    name: 'tools',
    environment: 'node',
    include: ['*.test.mjs', 'perf/*.test.mjs'],
    // Migration cases build and `git init` a vault; packaging cases run real tools.
    testTimeout: 60_000,
  },
})
