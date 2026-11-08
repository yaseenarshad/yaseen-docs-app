import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { AutomationFailure } from '@shared/automation'
import { validateOutput } from '@shared/automationCommands'
import { makeRequest, sendRequest } from './client'
import { descriptorPath, readConnection } from './connection'
import { startAutomationServer, type AutomationServer } from './server'
import { readPacket } from './wire'
import { CLOSE_WAIT_MS } from './requests'

const profiles: string[] = [], servers: AutomationServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
  await Promise.all(profiles.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function start(run: (content: Buffer) => Promise<unknown>, stopWork?: () => Promise<unknown>) {
  const profile = await mkdtemp(join(tmpdir(), 'docs-cli-test-')); profiles.push(profile)
  const server = await startAutomationServer(profile, (_request, content) => ({ writes: ['test'], run: () => run(content) }), stopWork)
  servers.push(server)
  return { profile, server, connection: await readConnection(profile) }
}

describe('real local socket', () => {
  it('keeps profiles private, transfers large content separately, and removes its connection on shutdown', async () => {
    const { profile, server, connection } = await start(async body => ({ bytes: body.length, tail: body.subarray(-4).toString() }))
    if (process.platform !== 'win32') expect((await stat(descriptorPath(profile))).mode & 0o777).toBe(0o600)
    const content = Buffer.from('x'.repeat(128_000) + 'tail')
    expect(await sendRequest(connection, makeRequest(connection, 'file.patch', {}), content)).toEqual({ ok: true, value: { bytes: 128004, tail: 'tail' } })
    await server.close(); servers.splice(servers.indexOf(server), 1)
    await expect(readConnection(profile)).rejects.toMatchObject({ code: 'NOT_RUNNING' })
  })

  it('rejects wrong tokens and old sessions without executing the operation', async () => {
    let calls = 0
    const { connection } = await start(async () => calls++)
    const wrong = { ...makeRequest(connection, 'file.patch', {}), token: '0'.repeat(64) }
    expect(await sendRequest(connection, wrong)).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
    expect(await sendRequest(connection, { ...makeRequest(connection, 'file.patch', {}), session: 'old' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_REQUEST' } })
    expect(calls).toBe(0)
  })

  it('finishes once after a client timeout and exposes the completed receipt', async () => {
    let finish!: () => void, began!: () => void, calls = 0
    const started = new Promise<void>(resolve => { began = resolve })
    const gate = new Promise<void>(resolve => { finish = resolve })
    const { connection } = await start(async () => { calls++; began(); await gate; return { diskSaved: true } })
    const request = makeRequest(connection, 'file.patch', {})
    const pending = sendRequest(connection, request, Buffer.alloc(0), 25)
    const failed = expect(pending).rejects.toMatchObject({ code: 'WAIT_TIMEOUT' })
    await started; await failed
    finish()
    expect(await sendRequest(connection, request)).toEqual({ ok: true, value: { diskSaved: true } })
    expect(calls).toBe(1)
    const receipt = await sendRequest(connection, makeRequest(connection, 'request.status', { id: request.id })) as { value: unknown }
    expect(receipt).toMatchObject({ ok: true, value: { state: 'completed', result: { ok: true, value: { diskSaved: true } } } })
    validateOutput('request.status', receipt.value)
  })

  it('rejects oversized frame headers and redacts unexpected service errors', async () => {
    const { connection } = await start(async () => { throw new Error('provider secret=do-not-return') })
    expect(await sendRequest(connection, makeRequest(connection, 'file.patch', {}))).toEqual({ ok: false, error: { code: 'FAILED', message: 'The operation failed. Check the app diagnostics.' } })
    const socket = connect(connection.endpoint)
    const response = readPacket(socket)
    socket.once('connect', () => { const header = Buffer.alloc(8); header.writeUInt32BE(1_000_000, 0); socket.write(header) })
    const packet = await response
    expect(JSON.parse(packet.content.toString())).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
    socket.destroy()
  })

  it('does not replace a live endpoint for the same profile', async () => {
    const { profile } = await start(async () => null)
    await expect(startAutomationServer(profile, () => ({ writes: [], run: async () => null }))).rejects.toBeInstanceOf(AutomationFailure)
  })

  it('serializes a result once, for both its size check and the reply', async () => {
    let serialized = 0
    const { connection } = await start(async () => ({ toJSON: () => { serialized++; return { large: true } } }))
    expect(await sendRequest(connection, makeRequest(connection, 'file.patch', {}))).toEqual({ ok: true, value: { large: true } })
    expect(serialized).toBe(1)
  })

  it('stops long work first when it closes, so the caller still gets the result', async () => {
    let finish!: (value: unknown) => void, began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const { server, connection } = await start(() => { began(); return new Promise(resolve => { finish = resolve }) }, async () => finish({ stopped: true }))
    const pending = sendRequest(connection, makeRequest(connection, 'media.downloadPacks', {}))
    await started
    await server.close(); servers.splice(servers.indexOf(server), 1)
    expect(await pending).toEqual({ ok: true, value: { stopped: true } })
  })

  it('closes within its limit while an operation never ends, and the caller loses the connection', async () => {
    let began!: () => void
    const started = new Promise<void>(resolve => { began = resolve })
    const { server, connection } = await start(() => { began(); return new Promise(() => {}) })
    const pending = sendRequest(connection, makeRequest(connection, 'sync.now', {}))
    const lost = expect(pending).rejects.toBeInstanceOf(AutomationFailure)
    await started
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldClearNativeTimers: true })
    try {
      let closed = false
      const closing = server.close().then(() => { closed = true }); servers.splice(servers.indexOf(server), 1)
      await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS - 1)
      expect(closed).toBe(false)
      await vi.advanceTimersByTimeAsync(1); await closing
    } finally { vi.useRealTimers() }
    await lost
  })
})
