import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GithubError, REQUEST_TIMEOUT_MS, UPLOAD_FLOOR_BYTES_PER_S, githubClient, uploadAllowanceMs } from './client'

// YAZ-5199: a request with a body. `fetch` gives no upload progress, so until GitHub's answer comes the limit is the
// silence limit PLUS the time the body needs at a floor speed. A dead request with a body still stops.

let server: Server
let port = 0
beforeAll(async () => {
  // Reads the body, then never answers.
  server = createServer((req) => void req.resume())
  server.listen(0, '127.0.0.1')
  await new Promise<void>((r) => server.once('listening', () => r()))
  port = (server.address() as { port: number }).port
})
afterAll(() => {
  server.closeAllConnections()
  return new Promise<void>((r) => server.close(() => r()))
})

describe('YAZ-5199: the time before the answer of a request with a body', () => {
  it('the allowance grows with the body: 1 s for each 10 KB (a floor of 10 KB/s), on top of the silence limit', () => {
    expect(UPLOAD_FLOOR_BYTES_PER_S).toBe(10_000)
    expect(uploadAllowanceMs(0)).toBe(0)
    expect(uploadAllowanceMs(10_000)).toBe(1_000)
    expect(uploadAllowanceMs(2_000_000)).toBe(200_000)
    expect(REQUEST_TIMEOUT_MS).toBe(30_000)
  })

  it('a dead request with a small body still stops: OFFLINE after the limit and its small allowance', async () => {
    const client = githubClient('t0ken', { fetch: (url, init) => globalThis.fetch(url.replace('https://api.github.com', `http://127.0.0.1:${port}`), init), timeoutMs: 300 })
    const started = Date.now()
    const got = await client.request('/repos/o/r/git/trees', { method: 'POST', body: { content: 'x'.repeat(1_000) } }).then(
      () => 'answered',
      (e: unknown) => (e instanceof GithubError ? e.code : String(e)),
    )
    const ms = Date.now() - started
    expect(got).toBe('OFFLINE')
    expect(ms).toBeGreaterThanOrEqual(250)
    expect(ms).toBeLessThan(5_000)
  })
})
