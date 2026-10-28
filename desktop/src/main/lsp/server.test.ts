import { describe, expect, it } from 'vitest'
import { runningLanguageServers, startLanguageServer } from './server'

/**
 * The launcher's process handling (YAZ-3453) with a fake server on Node: the same shape as the
 * Python helper of 4C (a Node script, a command + args + cwd). This one answers `initialize` and
 * then ignores everything, `shutdown`, `exit` and a closed stdin included.
 */
const STUBBORN = `
let buf = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const end = buf.indexOf('\\r\\n\\r\\n')
    if (end === -1) return
    const len = Number(/Content-Length: (\\d+)/.exec(buf.subarray(0, end).toString())[1])
    if (buf.length < end + 4 + len) return
    const msg = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString())
    buf = buf.subarray(end + 4 + len)
    if (msg.method === 'initialize') {
      const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { definitionProvider: true } } })
      process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body)
    }
  }
})
process.stdin.on('end', () => {})
setInterval(() => {}, 1000)
`

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('startLanguageServer process handling (YAZ-3453)', () => {
  it('kills a server that ignores shutdown and exit, once the stop timeout passes', async () => {
    const server = await startLanguageServer({ name: 'stubborn', command: process.execPath, args: ['-e', STUBBORN], cwd: process.cwd() }, { rootPath: process.cwd() })
    expect(server.capabilities).toEqual({ definitionProvider: true })
    expect(runningLanguageServers().has(server)).toBe(true)
    const started = Date.now()
    await server.stop(300)
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    expect((await server.exited).signal).toBe(process.platform === 'win32' ? null : 'SIGKILL')
    expect(alive(server.pid)).toBe(false)
    expect(runningLanguageServers().has(server)).toBe(false)
  })

  it('rejects, with the command in the message, when the binary is missing', async () => {
    await expect(startLanguageServer({ name: 'missing', command: '/no/such/language-server', args: [], cwd: process.cwd() }, { rootPath: process.cwd() })).rejects.toThrow(
      'missing: could not start /no/such/language-server',
    )
    expect(runningLanguageServers().size).toBe(0)
  })

  it('rejects and leaves no process when initialize gets no answer in time', async () => {
    let pid = -1
    const start = startLanguageServer({ name: 'silent', command: process.execPath, args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], cwd: process.cwd() }, { rootPath: process.cwd(), initializeTimeoutMs: 200 })
    pid = [...runningLanguageServers()].find((s) => s.name === 'silent')?.pid ?? -1
    await expect(start).rejects.toThrow('initialize: no answer in 200 ms')
    expect(pid).toBeGreaterThan(0)
    expect(alive(pid)).toBe(false)
    expect(runningLanguageServers().size).toBe(0)
  })
})
