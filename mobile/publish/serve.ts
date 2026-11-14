import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { headersFor, parseHeaders } from './headers'

/**
 * A tiny local copy of the Cloudflare static assets host (YAZ-5087), for the headless check: it serves a build folder
 * with the rules of `wrangler.jsonc` and `_headers`:
 * - `html_handling: auto-trailing-slash`: `/` is index.html, `/friend` is friend.html; `/index.html` and `/friend.html` redirect (307);
 * - `not_found_handling: single-page-application`: ANY other address gets index.html with 200 (Cloudflare does this
 *   also for a script request; YAZ-5283), with the headers of that address;
 * - every answer gets the headers of `_headers` for its path. `_headers` itself is never served.
 * Run: `npx vite-node mobile/publish/serve.ts` (serves mobile/dist on http://localhost:8790).
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

export function serveDist(dir: string, port: number): Promise<Server> {
  const rules = parseHeaders(existsSync(join(dir, '_headers')) ? readFileSync(join(dir, '_headers'), 'utf8') : '')
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    const send = (status: number, file: string | null, extra: Record<string, string> = {}) => {
      if (process.env.NOTECARDS_LOG) console.error(`${status} ${req.method} ${path} ${req.headers['sec-fetch-mode'] ?? ''} ${req.headers['service-worker'] ?? ''}`)
      const headers = { ...headersFor(rules, path), ...extra }
      if (file) headers['content-type'] = TYPES[extname(file)] ?? 'application/octet-stream'
      res.writeHead(status, headers)
      res.end(file && req.method !== 'HEAD' ? readFileSync(file) : undefined)
    }
    if (path === '/index.html') return send(307, null, { location: '/' })
    const page = /^\/(friend|group|join)(\.html|\/)?$/.exec(path)
    if (page && page[2] === '.html') return send(307, null, { location: `/${page[1]}` })
    const want = path === '/' ? 'index.html' : page ? `${page[1]}.html` : path.slice(1)
    const file = normalize(join(dir, want))
    if (file.startsWith(normalize(dir)) && want !== '_headers' && existsSync(file) && statSync(file).isFile()) return send(200, file)
    return send(200, join(dir, 'index.html'))
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

if (process.env.NOTECARDS_SERVE !== 'no') {
  const dir = process.env.NOTECARDS_DIST ?? new URL('../dist/', import.meta.url).pathname
  const port = Number(process.env.PORT ?? 8790)
  void serveDist(dir, port).then(() => console.log(`Notecards build at http://localhost:${port} (from ${dir})`))
}
