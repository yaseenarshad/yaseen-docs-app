import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['src/**/*.test.ts', '*.test.ts'],
    // Real git and file-watcher suites: the CI macOS runner is ~5x slower than a dev Mac, and a
    // cold git spawn there overran the 5s default, as client/tools already allow for.
    testTimeout: 30_000,
  },
})
