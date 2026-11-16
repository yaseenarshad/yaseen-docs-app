import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { forbiddenImport, forbiddenUse, mayImportEngine } from './importRules'
import { commitOf, notecardsPwa } from './publish/pwaPlugin'
import { drawioPhone } from './publish/drawioPhone'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = fileURLToPath(new URL('../shared', import.meta.url))
const clientSrc = fileURLToPath(new URL('../client/src', import.meta.url))
const engineFonts = fileURLToPath(new URL('../engine/packages/excalidraw/fonts', import.meta.url))
const materialIcons = fileURLToPath(new URL('../client/public/material-icons', import.meta.url))

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
    // The engine's packages take React as a namespace (`import * as React from "react"`), which builds a merged copy of
    // React's exports in the first load. React's default export is the same object (`defaultIsModuleExports` below), so
    // a package of the drawing chunk takes that instead and the first load stays as it was.
    transform(code, id) {
      if (!/\/node_modules\/|(^|\/)engine\/packages\//.test(id) || !/\.m?js$/.test(id.split('?')[0])) return null
      const next = code.replace(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])(react|react-dom)\2/g, 'import $1 from $2$3$2')
      return next === code ? null : { code: next, map: null }
    },
  }
}

/**
 * YAZ-5488: MATERIAL'S ICON FILES (the Mac's `client/public/material-icons/`) at `/material-icons/`, for a vault's own
 * icons in the Search tree (`search/rowIcon.tsx`). Copied into the build as plain files: no chunk, nothing in the first
 * load, and not in the worker's shell (`shellFiles` keeps `assets/` and the icons only), so a row fetches only the icon
 * it shows. The dev server serves them from the Mac's folder.
 */
export function materialIconFiles(from: string = materialIcons): Plugin {
  let outDir = ''
  return {
    name: 'notecards-material-icons',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/material-icons/', (req, res, next) => {
        const name = normalize(decodeURIComponent((req.url ?? '').split('?')[0])).replace(/^\/+/, '')
        const file = join(from, name)
        if (name.includes('..') || !/^[\w.-]+\.svg$/.test(name) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'image/svg+xml')
        res.end(readFileSync(file))
      })
    },
    closeBundle() {
      if (outDir !== '' && existsSync(from)) cpSync(from, join(outDir, 'material-icons'), { recursive: true })
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

/**
 * YAZ-5446: what Settings › Version shows, set at build time: the version of `mobile/package.json`, the time of the
 * build (ISO, UTC; the phone shows it in its own time), and the short commit. A few bytes in the first load.
 */
export function buildDefine(now: Date = new Date()): Record<string, string> {
  const version = (JSON.parse(readFileSync(`${here}package.json`, 'utf8')) as { version: string }).version
  return {
    __NOTECARDS_VERSION__: JSON.stringify(version),
    __NOTECARDS_BUILT__: JSON.stringify(now.toISOString()),
    __NOTECARDS_COMMIT__: JSON.stringify(commitOf()),
  }
}

/**
 * YAZ-5645 (decision D8): on a computer, the dev server (http://localhost:5173) answers the Worker's routes
 * (`/api/github/*`) with the Worker's own code (`worker/index.ts`), so "Sign in with GitHub" works there too. The client
 * secret comes from `mobile/.dev.vars` (`GITHUB_CLIENT_SECRET=…`, git-ignored), read at each call, never logged.
 * Without the file the routes answer 503 `not_set_up`. Dev only: the build has no such route.
 */
export function githubWorkerDev(): Plugin {
  const readVars = (): Record<string, string> => {
    const file = join(here, '.dev.vars')
    if (!existsSync(file)) return {}
    const vars: Record<string, string> = {}
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/.exec(line)
      if (m) vars[m[1]] = m[2]
    }
    return vars
  }
  return {
    name: 'notecards-github-worker-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/github/', (req, res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const url = `http://${req.headers.host ?? 'localhost:5173'}${req.originalUrl ?? req.url ?? '/'}`
          const headers = new Headers()
          for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value)
          const request = new Request(url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks) })
          const worker = (await server.ssrLoadModule('/worker/index.ts')) as typeof import('./worker/index')
          const answer = await worker.handle(request, { GITHUB_CLIENT_SECRET: readVars().GITHUB_CLIENT_SECRET })
          res.statusCode = answer.status
          answer.headers.forEach((value, name) => res.setHeader(name, value))
          res.end(Buffer.from(await answer.arrayBuffer()))
        })().catch(() => {
          res.statusCode = 500
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  root: here,
  define: buildDefine(),
  // The guard is for what the phone bundles. `vitest.config.ts` leaves it out on purpose (YAZ-5160).
  // YAZ-5087: `notecardsPwa` writes the service worker (`dist/sw.js`) with this build's shell list.
  // YAZ-5533: `drawioPhone` puts draw.io's viewer and its files in `dist/drawio/<hash>/`, outside that list.
  plugins: [drawingChunkTrim(), phoneImportGuard(), react(), notecardsPwa(), materialIconFiles(), drawioPhone(), githubWorkerDev()],
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
    // YAZ-5440: React's default export IS its `module.exports` (React sets no `__esModule`). Said so, the shared React of
    // the first load needs no CommonJS default helper for the drawing engine, which imports React's default export.
    commonjsOptions: { defaultIsModuleExports: (id: string) => (/node_modules\/(react|react-dom)\//.test(id) ? true : 'auto') },
    // Two pages: the app, and the friend landing page (`/friend`, round 10 item 7).
    rollupOptions: { input: { index: `${here}index.html`, friend: `${here}friend.html` } },
  },
})
