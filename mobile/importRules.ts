import { isBuiltin } from 'node:module'

/**
 * Why the phone bundle must not take in this module, or `null` when it may. `id` is an import as written
 * (`'node:fs'`, `'@excalidraw/excalidraw'`) or a path the bundler resolved it to.
 *
 * The phone is a plain web page (YAZ-5071, decision 1): no Electron and no Node, so it can run in Safari.
 * It does not carry the desktop app, or the drawing engine and the code editor, which are megabytes the
 * phone never shows (decision 1: "the drawing component is not in the phone bundle"). YAZ-5440 (Yaseen: draw drawings
 * on the phone with the Mac's own code): the engine may be imported from the drawing chunk only (`importer`).
 */
export function forbiddenImport(id: string, importer?: string): string | null {
  const path = id.split('?')[0].replaceAll('\\', '/')
  if (path === 'electron' || path.startsWith('electron/')) return 'Electron'
  if (!path.startsWith('/') && !path.startsWith('.') && isBuiltin(path)) return 'a Node built-in'
  if (isEngine(path) && !mayImportEngine(importer)) return 'the drawing engine'
  if (/(^|\/)monaco-editor(\/|$)/.test(path)) return 'the code editor'
  if (/(^|\/)desktop\/src\//.test(path)) return 'the desktop app'
  // YAZ-5158: the desktop bridge and the app's storage wrapper are repo files, so they are named by path. A client
  // file that imports either one is then stopped too, because the build checks every import of every bundled file.
  if (/(^|\/)(@client|client\/src)\/api(\.tsx?)?$/.test(path)) return 'the desktop bridge (client/src/api)'
  if (/(^|\/)(@client|client\/src)\/lib\/storage(\.tsx?)?$/.test(path)) return "the app's storage wrapper (client/src/lib/storage)"
  return null
}

/** The drawing engine, by name or by path. */
const isEngine = (path: string): boolean => /(^|\/)@excalidraw\//.test(path) || /(^|\/)engine\/packages\//.test(path)

/**
 * THE DRAWING CHUNK (YAZ-5440): `mobile/src/drawing/engine/` is the one place of the phone that may import the engine
 * (and its font files), and the engine's own files may import each other. Everything else still may not: the first
 * load, the reader's chunk, Review. `src/drawingWall.test.ts` proves in the build that the engine is in its own lazy
 * chunk only.
 */
export const DRAWING_CHUNK_DIR = /(^|\/)mobile\/src\/drawing\/engine\//
export function mayImportEngine(importer: string | undefined): boolean {
  if (importer === undefined) return false
  const from = importer.split('?')[0].replaceAll('\\', '/')
  return DRAWING_CHUNK_DIR.test(from) || isEngine(from)
}

/** The repo's own sources: what `forbiddenUse` reads. Packages in node_modules are not read. */
const REPO_SOURCE = /(^|\/)(client\/src|shared|mobile\/src)\//
const STORE = /(^|\/)mobile\/src\/store\//

/**
 * A read of the bridge global, in any form: `window.yaseenDocs`, `(window as any).yaseenDocs`, `window['yaseenDocs']`,
 * `const { yaseenDocs } = window`. No other code has a property of that name. Its type (`interface Window { yaseenDocs: … }`)
 * is not a read.
 */
const BRIDGE = [/\.\s*yaseenDocs\b/, /\[\s*['"`]yaseenDocs['"`]\s*\]/, /\{[^}]*\byaseenDocs\b[^}]*\}\s*=\s*(window|globalThis|self)\b/]

/** The code with its comments taken out (roughly: a `//` after `:` stays, so a URL is kept). */
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

/**
 * Why the phone must not bundle this source file, from what its CODE uses, or `null`. A use is not an import, so
 * `forbiddenImport` cannot see it (YAZ-5158):
 * - the desktop bridge, the global `window.yaseenDocs` (`shared/ipc.ts`): it is undefined on a phone;
 * - browser storage (`localStorage`, `sessionStorage`, `indexedDB`) outside `mobile/src/store/`, the one place
 *   that owns the phone's storage.
 * Only the repo's own sources are read (`client/src`, `shared`, `mobile/src`). It runs on what the phone bundles (the
 * build) and on what the app reaches (`src/rules.test.ts`), never on the tests themselves (YAZ-5160).
 */
export function forbiddenUse(file: string, code: string): string | null {
  const path = file.split('?')[0].replaceAll('\\', '/')
  if (!REPO_SOURCE.test(path) || path.includes('/node_modules/')) return null
  const text = withoutComments(code)
  if (BRIDGE.some((use) => use.test(text))) return 'the desktop bridge (window.yaseenDocs)'
  if (!STORE.test(path) && /\b(localStorage|sessionStorage|indexedDB)\b/.test(text)) return 'browser storage outside mobile/src/store'
  return null
}
