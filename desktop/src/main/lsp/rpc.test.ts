import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { RpcConnection } from './rpc'

/** The LSP base protocol framing (YAZ-3453), against a fake server on two in-memory pipes. */

const frame = (message: object) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
}

/** A pipe to the fake server that keeps what the client wrote. `written` splits it into messages and empties it. */
class Sink extends PassThrough {
  private bytes: Buffer[] = []
  constructor() {
    super()
    this.on('data', (chunk: Buffer) => this.bytes.push(chunk))
  }
  drain(): string {
    const text = Buffer.concat(this.bytes).toString('utf8')
    this.bytes = []
    return text
  }
}

function written(out: Sink): Record<string, unknown>[] {
  return out
    .drain()
    .split(/Content-Length: \d+\r\n\r\n/)
    .filter(Boolean)
    .map((s) => JSON.parse(s) as Record<string, unknown>)
}

const tick = () => new Promise((r) => setImmediate(r))

describe('RpcConnection (YAZ-3453)', () => {
  it('matches answers to requests, across chunks cut anywhere, with a multi-byte body', async () => {
    const fromServer = new PassThrough()
    const toServer = new Sink()
    const rpc = new RpcConnection(fromServer, toServer)
    const answer = rpc.request('textDocument/hover', { x: 1 })
    await tick()
    expect(written(toServer)).toEqual([{ jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: { x: 1 } }])
    const bytes = Buffer.concat([frame({ method: 'window/logMessage', params: { message: 'é' } }), frame({ id: 1, result: { text: 'añadir ✓' } })])
    // One byte at a time: the header, the boundary and a UTF-8 character all split.
    for (let i = 0; i < bytes.length; i++) fromServer.write(bytes.subarray(i, i + 1))
    await expect(answer).resolves.toEqual({ text: 'añadir ✓' })
  })

  it('rejects on an error answer, on a timeout, and when the server closes', async () => {
    const fromServer = new PassThrough()
    const rpc = new RpcConnection(fromServer, new PassThrough())
    const failed = rpc.request('a')
    fromServer.write(frame({ id: 1, error: { code: -32601, message: 'no such method' } }))
    await expect(failed).rejects.toMatchObject({ message: 'no such method', code: -32601 })
    await expect(rpc.request('b', undefined, 10)).rejects.toThrow('b: no answer in 10 ms')
    const open = rpc.request('c')
    fromServer.destroy()
    await expect(open).rejects.toThrow('closed its output')
    await expect(rpc.request('d')).rejects.toThrow('closed its output')
  })

  it('answers server requests: no settings for workspace/configuration, null for the rest, or the handler', async () => {
    const fromServer = new PassThrough()
    const toServer = new Sink()
    const rpc = new RpcConnection(fromServer, toServer)
    fromServer.write(frame({ id: 7, method: 'workspace/configuration', params: { items: [{ section: 'typescript' }, { section: 'editor' }] } }))
    fromServer.write(frame({ id: 'r', method: 'client/registerCapability', params: { registrations: [] } }))
    await tick()
    expect(written(toServer)).toEqual([
      { jsonrpc: '2.0', id: 7, result: [null, null] },
      { jsonrpc: '2.0', id: 'r', result: null },
    ])
    rpc.onRequest(async (method) => ({ handled: method }))
    fromServer.write(frame({ id: 8, method: 'window/showMessageRequest', params: {} }))
    await tick()
    await tick()
    expect(written(toServer)).toEqual([{ jsonrpc: '2.0', id: 8, result: { handled: 'window/showMessageRequest' } }])
  })

  it('hands notifications to every listener until it is removed', async () => {
    const fromServer = new PassThrough()
    const rpc = new RpcConnection(fromServer, new PassThrough())
    const seen: string[] = []
    const off = rpc.onNotification((method) => seen.push(method))
    fromServer.write(frame({ method: 'textDocument/publishDiagnostics', params: {} }))
    await tick()
    off()
    fromServer.write(frame({ method: 'window/logMessage', params: {} }))
    await tick()
    expect(seen).toEqual(['textDocument/publishDiagnostics'])
  })
})
