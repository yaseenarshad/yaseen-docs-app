import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    name: 'client',
    environment: 'jsdom',
    // Without this vitest stubs every CSS import to '' — the crepeTheme swap (GRO-2218)
    // bundles the frame themes via `?inline` and its test asserts the real var blocks.
    css: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
  },
})
