import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // On macOS libuv starts the FSEvents stream asynchronously after fs.watch() returns, so a
    // write that lands right after chokidar's `ready` can be missed (verified: raw fs.watch drops
    // ~3% of immediate changes under CPU load). The watch tests write immediately after `ready`;
    // stat-polling is registered synchronously and makes them deterministic. Our code is
    // backend-agnostic — only chokidar's event source changes.
    env: { CHOKIDAR_USEPOLLING: '1' },
  },
})
