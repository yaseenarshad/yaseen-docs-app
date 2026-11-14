import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

/** The `mobile` project of the root vitest run: the app's own Vite config (aliases, one React, the import guard), Node by default. */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'mobile',
      // Store tests run in plain Node with fake-indexeddb; a file that draws React says `@vitest-environment jsdom`.
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', '*.test.ts'],
    },
  }),
)
