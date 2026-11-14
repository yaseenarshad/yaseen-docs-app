import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GithubError, githubClient } from '../github/client'

// Checker round 2 of YAZ-5073, on the fix of YAZ-5184: a slow but live UPLOAD (a commit of a big page on a slow
// signal). A real fetch posts 4 MiB to a local server that reads the body slowly but steadily (64 KiB each 40 ms,
// about 2.6 s), then answers 201. The silence limit is scaled down (300 ms for the real 30 s).

let server: Server
let port = 0
let gotBytes = 0
beforeAll(async () => {
  server = createServer((req, res) => {
    gotBytes = 0
    req.on('data', (chunk: Buffer) => {
      gotBytes += chunk.length
      req.pause()
      setTimeout(() => req.resume(), 40)
    })
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ sha: 'abc' }))
    })
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((r) => server.once('listening', () => r()))
  port = (server.address() as { port: number }).port
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('checker round 2 (YAZ-5184 attack): a slow but live upload', () => {
  it('3B-G: an upload that keeps sending bytes is not cut by the silence limit (scaled: 300 ms limit, a 4 MiB body)', async () => {
    const client = githubClient('t0ken', { fetch: (url, init) => globalThis.fetch(url.replace('https://api.github.com', `http://127.0.0.1:${port}`), init), timeoutMs: 300 })
    const started = Date.now()
    const got = await client.request('/repos/o/r/git/trees', { method: 'POST', body: { content: 'x'.repeat(4 * 1024 * 1024) } }).then(
      (r) => `status ${r.status}`,
      (e: unknown) => (e instanceof GithubError ? e.code : String(e)),
    )
    console.log('slow upload:', got, 'after', Date.now() - started, 'ms; the server had read', gotBytes, 'bytes')
    // Expected: GitHub's answer. The bytes kept going up, so the signal is live.
    expect(got).toBe('status 201')
  })
})
