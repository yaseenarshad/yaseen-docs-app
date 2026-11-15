import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { forbiddenImport, forbiddenUse, mayImportEngine } from './importRules'
import { notecardsPwa } from './publish/pwaPlugin'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = fileURLToPath(new URL('../shared', import.meta.url))
const clientSrc = fileURLToPath(new URL('../client/src', import.meta.url))
const engineFonts = fileURLToPath(new URL('../engine/packages/excalidraw/fonts', import.meta.url))

/**
 * Fails the build (and the dev server's load) on any module the phone must not carry: Electron, Node,
 * the desktop app and its bridge, the app's storage wrapper, the drawing engine, the code editor, and any repo
 * source file that uses `window.yaseenDocs` or browser storage outside `mobile/src/store/` (`importRules.ts`). It sees every import of every
 * bundled file, so a `client/` file that pulls the editor in is caught here, not on the phone.
 */
/** A module id without its query and Rollup's virtual mark (`\0…?commonjs-es-import`). */
const bare = (id: string) => id.replace(/^\0/, '').split('?')[0]

export function phoneImportGuard(): Plugin {
  /** The engine's files that the drawing chunk reached (YAZ-5440): only these may load. */
  const drawingChunk = new Set<string>()
  return {
    name: 'notecards-import-guard',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const why = forbiddenImport(source, importer)
      if (why) this.error(`mobile/ never imports ${why}: "${source}"${importer ? ` from ${importer}` : ''} (mobile/README.md)`)
      if (mayImportEngine(importer)) {
        const found = await this.resolve(source, importer, { ...options, skipSelf: true })
        if (found && forbiddenImport(found.id) !== null && mayImportEngine(found.id)) drawingChunk.add(bare(found.id))
      }
      return null
    },
    load(id) {
      const why = drawingChunk.has(bare(id)) ? null : forbiddenImport(id)
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
 * THE DRAWING CHUNK'S TRIM (YAZ-5440). The engine's package loads more, lazily, for its editor: Mermaid and its diagram
 * kinds (megabytes), the font cutter (WebAssembly, 3.6 MB), the picture shrinkers, the code editor, the GIF worker, the
 * PNG scene reader and fifty languages. A picture (`exportToSvg`, with no fonts asked) needs none of them, and the
 * service worker would keep each one on the phone. So each of these lazy imports of the engine becomes a module that
 * fails at once: the engine catches it, as it does with no signal. Only the engine's own lazy imports; English stays.
 */
export const DRAWING_CHUNK_LEAVES = [
  /^@excalidraw\/mermaid-to-excalidraw$/,
  /^pako$/,
  /^pica$/,
  /^image-blob-reduce$/,
  /\/subset-(shared\.chunk|worker-[\w-]+)\.js$/,
  /\/CodeMirrorEditor-[\w-]+\.js$/,
  /\/gifShrinkWorker-[\w-]+\.js$/,
  /\/data\/image-[\w-]+\.js$/,
  /\/locales\/(?!en-)[\w-]+\.js$/,
]
export function drawingChunkTrim(): Plugin {
  const OFF = '\0notecards-drawing-off:'
  return {
    name: 'notecards-drawing-trim',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer === undefined || !/(^|\/)(@excalidraw|engine\/packages)\//.test(importer.replace(/^\0/, ''))) return null
      // One module for all of them: one tiny chunk.
      return DRAWING_CHUNK_LEAVES.some((r) => r.test(source)) ? OFF : null
    },
    load(id) {
      return id === OFF ? `throw new Error('Not on the phone: the drawing engine draws pictures only')` : null
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
  plugins: [drawingChunkTrim(), phoneImportGuard(), react(), notecardsPwa()],
  resolve: phoneResolve,
  // YAZ-5440: the dev server serves the engine's font files to the drawing chunk.
  server: { fs: { allow: [here, shared, clientSrc, engineFonts] } },
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
