import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GithubError, githubClient } from '../github/client'

// Checker probe for YAZ-5173 (round 2): the time limit is on the WHOLE request, not on silence. A real fetch against a
// local server that sends a body slowly but steadily (a big file on a bad signal). The time limit is scaled down
// (300 ms for the real 30 s); the body takes about 1 s and never stops for more than 100 ms.

let server: Server
let port = 0
beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    // YAZ-5184: a body that sends one part, then goes silent and never ends.
    if (req.url?.includes('stall')) return void res.write(Buffer.alloc(1024, 1))
    let sent = 0
    const step = () => {
      if (sent === 10) return res.end()
      sent++
      res.write(Buffer.alloc(1024, sent))
      setTimeout(step, 100)
    }
    step()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('checker YAZ-5072 round 2: a slow but live download', () => {
  it('3B-F: a download that keeps getting bytes is not cut by the time limit (scaled: 300 ms limit, 1 s body)', async () => {
    const client = githubClient('t0ken', { fetch: (url, init) => globalThis.fetch(url.replace('https://api.github.com', `http://127.0.0.1:${port}`), init), timeoutMs: 300 })
    const started = Date.now()
    const got = await client.request('/repos/o/r/git/blobs/abc', { raw: true }).then(
      (r) => `bytes ${(r.data as Uint8Array).byteLength}`,
      (e: unknown) => (e instanceof GithubError ? e.code : String(e)),
    )
    console.log('slow body:', got, 'after', Date.now() - started, 'ms')
    // Expected: the whole file (10 KiB). The bytes kept coming, so the signal is live.
    expect(got).toBe('bytes 10240')
  })
})

describe('YAZ-5184: the silence limit still ends a hang', () => {
  it('a body that goes silent after one part stops after the limit (OFFLINE), not later', async () => {
    const client = githubClient('t0ken', { fetch: (url, init) => globalThis.fetch(url.replace('https://api.github.com', `http://127.0.0.1:${port}`), init), timeoutMs: 300 })
    const started = Date.now()
    const got = await client.request('/repos/o/r/git/blobs/stall', { raw: true }).then(
      () => 'ended',
      (e: unknown) => (e instanceof GithubError ? e.code : String(e)),
    )
    const ms = Date.now() - started
    expect(got).toBe('OFFLINE')
    expect(ms).toBeGreaterThanOrEqual(250)
    expect(ms).toBeLessThan(5_000)
  })
})
