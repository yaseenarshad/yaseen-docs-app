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
    // Timing budgets live in the `perf` project (vitest.perf.config.ts), which runs AFTER this
    // one on an idle pool. They flaked here under parallel load, and widening them to cope would
    // have hidden a real 4-6x regression — see YAZ-740.
    exclude: ['**/node_modules/**', 'src/**/*.perf.test.{ts,tsx}'],
    testTimeout: 30_000,
    // The engine's dist imports `roughjs/bin/rough` without an extension, which Node's ESM loader
    // refuses; inlining lets Vite resolve it, so a test can run the REAL engine (Draw's config, ported
    // by YAZ-3028 for `boardAppState.test.ts` and `canvasPrefsEngine.test.ts`). Suites that mock the
    // surface or the engine never load it.
    server: { deps: { inline: [/@excalidraw\//] } },
  },
})
