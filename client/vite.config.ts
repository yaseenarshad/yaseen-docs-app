import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  // Crepe ships Vue (esm-bundler build) for its list-item / block views; without these
  // compile-time flags Vue warns on every page load and cannot tree-shake.
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3737',
        // http-proxy leaves the browser's SSE response open when the backend goes away
        // (e.g. tsx restart); end it so EventSource reconnects and gets a fresh `ready`.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => proxyRes.on('close', () => res.end()))
        },
      },
    },
  },
})
