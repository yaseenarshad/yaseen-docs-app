import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { forbiddenImport, forbiddenUse } from './importRules'
import { notecardsPwa } from './publish/pwaPlugin'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = fileURLToPath(new URL('../shared', import.meta.url))
const clientSrc = fileURLToPath(new URL('../client/src', import.meta.url))

/**
 * Fails the build (and the dev server's load) on any module the phone must not carry: Electron, Node,
 * the desktop app and its bridge, the app's storage wrapper, the drawing engine, the code editor, and any repo
 * source file that uses `window.yaseenDocs` or browser storage outside `mobile/src/store/` (`importRules.ts`). It sees every import of every
 * bundled file, so a `client/` file that pulls the editor in is caught here, not on the phone.
 */
export function phoneImportGuard(): Plugin {
  return {
    name: 'notecards-import-guard',
    enforce: 'pre',
    resolveId(source, importer) {
      const why = forbiddenImport(source)
      if (why) this.error(`mobile/ never imports ${why}: "${source}"${importer ? ` from ${importer}` : ''} (mobile/README.md)`)
      return null
    },
    load(id) {
      const why = forbiddenImport(id)
      if (why) this.error(`mobile/ never imports ${why}: ${id} (mobile/README.md)`)
      return null
    },
    // YAZ-5158: a use is not an import. Each repo source file the bundle takes in is read for the bridge and storage.
    transform(code, id) {
      const why = forbiddenUse(id, code)
      if (why) this.error(`mobile/ never uses ${why}: ${id} (mobile/README.md)`)
      return null
    },
  }
}

/**
 * The phone web app (YAZ-5071, decision 1): a plain Vite build of `mobile/`, with the same `@shared` alias
 * as the desktop renderer (`desktop/electron.vite.config.ts`), and `@client` for the pure parts of `client/src`
 * that later units reuse.
 */
/** The aliases and the one React: the build, the dev server and the tests all resolve modules the same way. */
export const phoneResolve = {
  alias: { '@shared': shared, '@client': clientSrc },
  // ONE React in the bundle: a file from client/src would otherwise find client/node_modules/react, a second copy.
  dedupe: ['react', 'react-dom'],
}

export default defineConfig({
  root: here,
  // The guard is for what the phone bundles. `vitest.config.ts` leaves it out on purpose (YAZ-5160).
  // YAZ-5087: `notecardsPwa` writes the service worker (`dist/sw.js`) with this build's shell list.
  plugins: [phoneImportGuard(), react(), notecardsPwa()],
  resolve: phoneResolve,
  server: { fs: { allow: [here, shared, clientSrc] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // No modulepreload polyfill: Safari has `modulepreload` since 17, and the polyfill FETCHES the chunks, which the CSP's
    // `connect-src` (GitHub only) refuses. Without it the chunks load as scripts (`script-src 'self'`).
    modulePreload: { polyfill: false },
    // Two pages: the app, and the friend landing page (`/friend`, round 10 item 7).
    rollupOptions: { input: { index: `${here}index.html`, friend: `${here}friend.html` } },
  },
})
