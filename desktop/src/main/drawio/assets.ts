/**
 * Where the draw.io webapp lives and how `app://drawio/…` serves it (Draw's 🔒 YAZ-1802 D4 / D5, ported
 * by YAZ-3028 D5): its own origin, apart from the renderer, so the iframe cannot reach `window.yaseenDocs`; every answer
 * carries `DRAWIO_CSP`, so nothing leaves that origin. Dev serves the pack cache, a build its copy in
 * `out/drawio`. Our app name in the user agent keeps draw.io out of its drawio-desktop mode
 * (`assets.test.ts` pins it). Pure, so every rule tests without Electron. Long form:
 * docs/CONTRACTS.md › Editor rules, rule 37.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DRAWIO_ORIGIN, DRAWIO_TAG } from '@shared/drawio'

/**
 * 🔒 YAZ-1802 D4: the strict policy on every drawio-host response. Network is closed: `connect-src`,
 * `img-src`, `font-src` and `frame-src` admit this origin (spelled out beside `'self'`, which a
 * custom scheme does not always match) plus inline `data:` / `blob:` where draw.io builds pictures
 * and fonts in memory. `script-src` is as wide as draw.io's own code needs, verified against
 * v31.5.2: `eval` (7 uses, the style/stencil evaluator) and `new Function` in `app.min.js`,
 * inline `onclick` in two built-in dialogs, and WebAssembly in the bundled libavoid router.
 */
export const DRAWIO_CSP = [
  `default-src 'self' ${DRAWIO_ORIGIN}`,
  `script-src 'self' ${DRAWIO_ORIGIN} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`,
  `style-src 'self' ${DRAWIO_ORIGIN} 'unsafe-inline'`,
  `img-src 'self' ${DRAWIO_ORIGIN} data: blob:`,
  `font-src 'self' ${DRAWIO_ORIGIN} data:`,
  `connect-src 'self' ${DRAWIO_ORIGIN}`,
  `media-src 'self' ${DRAWIO_ORIGIN} data: blob:`,
  `frame-src 'self' ${DRAWIO_ORIGIN}`,
  `worker-src 'self' ${DRAWIO_ORIGIN} blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'none'`,
].join('; ')

/**
 * The webapp folder. Dev (not packaged) prefers the pack cache — `<desktop>/.cache/drawio/<tag>`,
 * `app.getAppPath()` being `desktop/` there — so the overlay is always the current one; a build
 * falls back to, and a packaged app only ever uses, `out/drawio` beside the main bundle.
 */
export function resolveDrawioDir(opts: { mainDir: string; appPath: string; isPackaged: boolean; exists: (p: string) => boolean }): string {
  const built = path.resolve(opts.mainDir, '..', 'drawio')
  if (opts.isPackaged) return built
  const cache = path.join(opts.appPath, '.cache', 'drawio', DRAWIO_TAG)
  return opts.exists(path.join(cache, 'index.html')) ? cache : built
}

/**
 * The file a drawio-host URL path names, or null when it would leave the folder (🔒 YAZ-1802 D4 —
 * the traversal guard) or cannot be decoded. `/` is the webapp's `index.html`.
 */
export function drawioFilePath(dir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const file = path.resolve(dir, rel)
  return file.startsWith(dir + path.sep) ? file : null
}

/**
 * One `app://drawio/…` request (🔒 YAZ-1802 D4): the file inside `dir` or a 404 — never a path
 * outside it — and every answer, a 404 included, carries `DRAWIO_CSP` on top of the file's own
 * headers. `noStore` is dev's (🔒 D17): the pack cache changes under a running app
 * (`npm run drawio:pack`), so Chromium must never hand an iframe yesterday's `PostConfig.js`; a
 * packaged app's copy is immutable and caches normally.
 *
 * `onNotFound` is dev's too (🔒 YAZ-1802 D5, YAZ-1973): every 404 is logged, because the pack is
 * PRUNED to what draw.io loads (`tools/lib/drawioPack.mjs`) — after a draw.io bump, opening the
 * seeded diagrams with the terminal in view is how a file the prune should have kept shows up.
 */
export async function serveDrawio(dir: string, pathname: string, opts: { fetchFile: (url: string) => Promise<Response>; noStore: boolean; onNotFound?: (pathname: string) => void }): Promise<Response> {
  const notFound = () => {
    opts.onNotFound?.(pathname)
    return new Response('Not found', { status: 404, headers: { 'Content-Security-Policy': DRAWIO_CSP } })
  }
  const file = drawioFilePath(dir, pathname)
  if (file === null) return notFound()
  let res: Response
  try {
    res = await opts.fetchFile(pathToFileURL(file).toString())
  } catch {
    return notFound()
  }
  if (res.status === 404) return notFound()
  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', DRAWIO_CSP)
  if (opts.noStore) headers.set('Cache-Control', 'no-store')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
