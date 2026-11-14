import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { forbiddenImport } from './importRules'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = fileURLToPath(new URL('../shared', import.meta.url))
const clientSrc = fileURLToPath(new URL('../client/src', import.meta.url))

/**
 * Fails the build (and the dev server's load) on any module the phone must not carry: Electron, Node,
 * the desktop app, the drawing engine, the code editor (`importRules.ts`). It sees every import of every
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
  }
}

/**
 * The phone web app (YAZ-5071, decision 1): a plain Vite build of `mobile/`, with the same `@shared` alias
 * as the desktop renderer (`desktop/electron.vite.config.ts`), and `@client` for the pure parts of `client/src`
 * that later units reuse.
 */
export default defineConfig({
  root: here,
  plugins: [phoneImportGuard(), react()],
  resolve: {
    alias: { '@shared': shared, '@client': clientSrc },
    // ONE React in the bundle: a file from client/src would otherwise find client/node_modules/react, a second copy.
    dedupe: ['react', 'react-dom'],
  },
  server: { fs: { allow: [here, shared, clientSrc] } },
  build: { outDir: 'dist', emptyOutDir: true },
})
